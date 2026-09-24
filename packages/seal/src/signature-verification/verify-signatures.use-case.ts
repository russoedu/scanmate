import { webcrypto } from 'node:crypto'

import type { Certificate } from 'pkijs'

import { findSignatureFields } from '../signature-fields'
import type { SignatureField } from '../signature-fields'
import { pdfDate } from './pdf-date.mapper'
import type { SealReport, SignatureCheck, SignatureProblem, Signer } from './seal-report.contract'

/**
 * Is a signed PDF still the document that was signed?
 *
 * A digital signature answers a question no comparison of pixels or words can:
 * whether the file has changed since someone signed it. It says nothing about
 * whether the paper that came back matches the document that was issued - that
 * is the rest of this suite - and this package says nothing about whether a
 * signature is *legally* valid, which is a question about trust lists,
 * revocation and jurisdiction rather than about bytes. See the README.
 *
 * What is checked, per signature:
 *
 * 1. The bytes the signature covers digest to what the signature says they do.
 * 2. That digest is signed by the key of the certificate it carries.
 * 3. How much of the file lies outside the signed ranges.
 * 4. Whether the certificate was in date when the file says it was signed.
 *
 * The cryptography is `pkijs` over Node's own WebCrypto; nothing is shelled out
 * to a PDF library, and a file too damaged for a PDF parser is still read,
 * which matters when the question is whether it was tampered with.
 */
export async function verifySignatures (pdf: Uint8Array): Promise<SealReport> {
  const fields = findSignatureFields(pdf)
  if (fields.length === 0) return { signed: false, signatures: [], unbroken: false }

  const signatures: SignatureCheck[] = []
  for (const field of fields) signatures.push(await check(pdf, field))

  return {
    signed:   true,
    signatures,
    unbroken: signatures.every(signature => signature.intact) && (signatures.at(-1)?.whole ?? false),
  }
}

async function check (pdf: Uint8Array, field: SignatureField): Promise<SignatureCheck> {
  const [beforeAt, beforeLength, afterAt, afterLength] = field.byteRange
  const covered = new Uint8Array(beforeLength + afterLength)
  covered.set(pdf.subarray(beforeAt, beforeAt + beforeLength), 0)
  covered.set(pdf.subarray(afterAt, afterAt + afterLength), beforeLength)
  // The hole between the ranges is the signature's own hex string, which no
  // signature can cover; anything past the ranges is a later change.
  const uncovered = Math.max(0, pdf.length - (afterAt + afterLength))

  const signedAt = pdfDate(field.signedAt)
  const problems: SignatureProblem[] = []
  const common = {
    name:      field.name,
    subFilter: field.subFilter,
    reason:    field.reason,
    location:  field.location,
    signedAt,
    whole:     uncovered === 0,
    uncovered,
  }
  if (uncovered > 0) problems.push({ kind: 'not-covered', bytes: uncovered })

  try {
    const pkijs = await import('pkijs')
    const engine = new pkijs.CryptoEngine({ name: 'node', crypto: webcrypto, subtle: webcrypto.subtle })
    pkijs.setEngine('node', engine)

    const content = pkijs.ContentInfo.fromBER(asBuffer(field.contents))
    const signed = new pkijs.SignedData({ schema: content.content })
    const signer = describe(signerCertificate(signed))
    if (signer !== null && signedAt !== null && (signedAt < signer.notBefore || signedAt > signer.notAfter))
      problems.push({ kind: 'certificate-expired', signedAt })

    // `extendedMode` reports each step; pkijs's own type omits the digest field.
    const result = await signed.verify({ signer: 0, data: asBuffer(covered), checkChain: false, extendedMode: true }) as { signatureVerified?: boolean, messageDigestVerified?: boolean }
    const intact = result.signatureVerified === true
    if (!intact) problems.push({ kind: result.messageDigestVerified === false ? 'digest-mismatch' : 'signature-invalid' })

    return { ...common, intact, signer, problems }
  } catch (error) {
    // pkijs reports a digest that does not match by throwing, which is the
    // commonest failure here and not an error in any useful sense.
    const because = error instanceof Error ? error.message : String(error)
    problems.push(because.toLowerCase().includes('message digest') ? { kind: 'digest-mismatch' } : { kind: 'unreadable', because })

    return { ...common, intact: false, signer: null, problems }
  }
}

/**
 * The certificate that signed, out of the several a signature carries.
 *
 * A real signature carries its whole chain - the signer, whoever issued to
 * them, and on up - and the first of them is as often a certification
 * authority as the signer. `SignerInfo` names the one that signed, by its
 * issuer and serial number, and that is the only way to pick it. Measured on a
 * real signed document: taking the first reported `O=Entrust.net` where the
 * signer was a person.
 */
function signerCertificate (signed: { signerInfos?: Array<{ sid: unknown }>, certificates?: unknown[] }): Certificate | undefined {
  const held = (signed.certificates ?? []).filter((candidate): candidate is Certificate => candidate instanceof Object && 'subject' in candidate)
  const sid = signed.signerInfos?.[0]?.sid as { issuer?: Certificate['issuer'], serialNumber?: Certificate['serialNumber'] } | undefined
  if (sid?.serialNumber === undefined) return held[0]
  const wanted = serial(sid.serialNumber)

  return held.find(candidate => serial(candidate.serialNumber) === wanted) ?? held[0]
}

function serial (number: Certificate['serialNumber']): string {
  return [...number.valueBlock.valueHexView].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** What a certificate says about itself. */
function describe (certificate: Certificate | undefined): Signer | null {
  if (certificate === undefined) return null
  const subject = distinguished(certificate.subject)
  const issuer = distinguished(certificate.issuer)

  return {
    subject,
    issuer,
    serialNumber: serial(certificate.serialNumber),
    notBefore:    certificate.notBefore.value,
    notAfter:     certificate.notAfter.value,
    selfSigned:   subject === issuer,
  }
}

/** The short names a reader expects: `CN=A Person, O=A Company`. */
const ATTRIBUTES: Readonly<Record<string, string>> = {
  '2.5.4.3':              'CN',
  '2.5.4.6':              'C',
  '2.5.4.7':              'L',
  '2.5.4.8':              'ST',
  '2.5.4.10':             'O',
  '2.5.4.11':             'OU',
  '1.2.840.113549.1.9.1': 'E',
}

function distinguished (name: Certificate['subject']): string {
  return name.typesAndValues.map(part => `${ATTRIBUTES[part.type] ?? part.type}=${part.value.valueBlock.value}`).join(', ')
}

/** pkijs takes an ArrayBuffer, and a Uint8Array's buffer may be a slice of a larger one. */
function asBuffer (bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
