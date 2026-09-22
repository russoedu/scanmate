import { webcrypto } from 'node:crypto'
import type { webcrypto as WebCrypto } from 'node:crypto'

import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

/**
 * A genuinely signed PDF, made here, for the tests.
 *
 * A signature cannot be faked in a fixture: the only way to test a verifier is
 * to sign something properly, so this makes a key and a self-signed
 * certificate, writes a one-page PDF with a signature dictionary, and signs the
 * bytes its `/ByteRange` names - exactly as a signing tool does.
 *
 * It is test scaffolding, not a signing tool: one signature, no timestamp, no
 * appearance, and a certificate that vouches for nobody.
 */

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }
/** Hex characters reserved for the signature, as a signing tool reserves them. */
const ROOM = 4096

export interface SigningOptions {
  /** `/Name`: who the signing software records. */
  name?:       string
  /** `/M`, as written: `D:20260922120000Z`. */
  when?:       string
  /** The certificate's common name. */
  commonName?: string
  /** When the certificate is valid. Default: from yesterday to tomorrow. */
  validity?:   { from: Date, to: Date }
}

/** A self-signed certificate and the key that signed it. */
async function certificate (commonName: string, validity?: { from: Date, to: Date }): Promise<{ cert: pkijs.Certificate, keys: WebCrypto.CryptoKeyPair }> {
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify'])
  const cert = new pkijs.Certificate()
  cert.version = 2
  cert.serialNumber = new asn1js.Integer({ value: 1 })
  for (const name of [cert.issuer, cert.subject])
    name.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.BmpString({ value: commonName }) }))
  cert.notBefore.value = validity?.from ?? new Date(Date.now() - 86_400_000)
  cert.notAfter.value = validity?.to ?? new Date(Date.now() + 86_400_000)
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey)
  await cert.sign(keys.privateKey, 'SHA-256')

  return { cert, keys }
}

/** A detached CMS `SignedData` over `covered`. */
async function sign (covered: Uint8Array, cert: pkijs.Certificate, keys: WebCrypto.CryptoKeyPair): Promise<Uint8Array> {
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', covered))
  // The two attributes a detached CMS signature carries: what was signed, and its digest.
  const contentType = new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })
  const messageDigest = new asn1js.OctetString({ valueHex: digest.buffer })
  const attributes = [
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [contentType] }),
    new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [messageDigest] }),
  ]
  const signed = new pkijs.SignedData({
    version:          1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    signerInfos:      [new pkijs.SignerInfo({
      version:     1,
      sid:         new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      signedAttrs: new pkijs.SignedAndUnsignedAttributes({
        type: 0,
        attributes,
      }),
    })],
    certificates: [cert],
  })
  await signed.sign(keys.privateKey, 0, 'SHA-256')
  const info = new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: signed.toSchema(true) })

  return new Uint8Array(info.toSchema().toBER(false))
}

/** A one-page PDF whose signature covers everything but the signature itself. */
export async function signedPdf (options: SigningOptions = {}): Promise<Uint8Array> {
  pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: webcrypto, subtle: webcrypto.subtle }))
  const { name = 'A Person', when = 'D:20260922120000Z', commonName = 'Test Signer', validity } = options

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>',
    '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0] /P 3 0 R /V 5 0 R >>',
    '',
  ]
  const build = (signature: string): string => {
    objects[4] = signature
    let body = '%PDF-1.7\n'
    const offsets: number[] = []
    for (const [i, object] of objects.entries()) {
      offsets.push(body.length)
      body += `${i + 1} 0 obj\n${object}\nendobj\n`
    }
    const startxref = body.length
    let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) table += `${String(offset).padStart(10, '0')} 00000 n \n`

    return `${body}${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  }

  // Written once with a placeholder to find where the signature will sit, then
  // again with the ranges that name it - the same two passes a signer makes.
  const blank = '[0 0000000000 0000000000 0000000000]'
  const placeholder = `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (${name}) /M (${when}) /Reason (Agreed) /ByteRange ${blank} /Contents <${'0'.repeat(ROOM)}> >>`
  const draft = build(placeholder)
  const contentsAt = draft.indexOf('/Contents <') + '/Contents <'.length
  const range = [0, contentsAt - 1, contentsAt + ROOM + 1, draft.length - (contentsAt + ROOM + 1)]
  const padded = range.map((value, i) => (i === 0 ? String(value) : String(value).padStart(10, '0'))).join(' ')
  const ranged = `[${padded}]`
  const sized = build(placeholder.replace(blank, () => ranged))
  if (sized.length !== draft.length) throw new Error('the byte range moved between the two passes')

  const bytes = Uint8Array.from(sized, character => character.codePointAt(0) ?? 0)
  const covered = new Uint8Array(range[1] + range[3])
  covered.set(bytes.subarray(range[0], range[0] + range[1]), 0)
  covered.set(bytes.subarray(range[2], range[2] + range[3]), range[1])

  const { cert, keys } = await certificate(commonName, validity)
  const signature = await sign(covered, cert, keys)
  const hex = [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (hex.length > ROOM) throw new Error('the signature does not fit the room reserved for it')
  const filled = hex.padEnd(ROOM, '0')
  const out = new Uint8Array(bytes)
  for (let i = 0; i < ROOM; i++) out[contentsAt + i] = filled.codePointAt(i) ?? 0

  return out
}
