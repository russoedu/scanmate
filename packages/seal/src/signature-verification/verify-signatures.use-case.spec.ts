import { signedPdf } from './fixtures/sign-pdf.algorithm'
import { verifySignatures } from './verify-signatures.use-case'

/** The same bytes with one changed, somewhere the signature covers. */
function tamper (pdf: Uint8Array, find: string, replace: string): Uint8Array {
  const text = new TextDecoder('latin1').decode(pdf)
  const at = text.indexOf(find)
  if (at === -1) throw new Error(`the fixture does not contain ${find}`)
  const out = new Uint8Array(pdf)
  for (let i = 0; i < replace.length; i++) out[at + i] = replace.codePointAt(i) ?? 0

  return out
}

describe('verifySignatures', () => {
  it('reads what the signature says about itself, and confirms the bytes it covers', async () => {
    const pdf = await signedPdf({ name: 'A Person', commonName: 'Test Signer' })
    const report = await verifySignatures(pdf)

    expect(report.signed).toBe(true)
    expect(report.signatures).toHaveLength(1)
    const [signature] = report.signatures
    expect(signature).toMatchObject({
      name: 'A Person', subFilter: 'adbe.pkcs7.detached', reason: 'Agreed', intact: true, whole: true, uncovered: 0, problems: [],
    })
    expect(signature.signedAt?.toISOString()).toBe('2026-09-22T12:00:00.000Z')
    expect(signature.signer).toMatchObject({ subject: 'CN=Test Signer', issuer: 'CN=Test Signer', selfSigned: true })
    expect(report.unbroken).toBe(true)
  }, 60_000)

  it('catches a byte changed after signing', async () => {
    const pdf = await signedPdf()
    const edited = tamper(pdf, '/MediaBox [0 0 200 200]', '/MediaBox [0 0 200 900]')
    const report = await verifySignatures(edited)

    expect(report.unbroken).toBe(false)
    expect(report.signatures[0]).toMatchObject({ intact: false, whole: true })
    expect(report.signatures[0].problems).toStrictEqual([{ kind: 'digest-mismatch' }])
  }, 60_000)

  it('reports bytes appended after the signed ranges, and still verifies what is signed', async () => {
    const pdf = await signedPdf()
    const appended = new Uint8Array(pdf.length + 32)
    appended.set(pdf, 0)
    appended.set(new TextEncoder().encode('\n% added after it was signed\n'), pdf.length)
    const report = await verifySignatures(appended)
    const [signature] = report.signatures

    expect(signature.intact).toBe(true)
    expect(signature.whole).toBe(false)
    expect(signature.uncovered).toBe(32)
    expect(signature.problems).toStrictEqual([{ kind: 'not-covered', bytes: 32 }])
  }, 60_000)

  it('says a certificate was out of date when the file says it was signed', async () => {
    const pdf = await signedPdf({
      when:     'D:20260922120000Z',
      validity: { from: new Date('2020-01-01T00:00:00Z'), to: new Date('2021-01-01T00:00:00Z') },
    })
    const report = await verifySignatures(pdf)
    const [signature] = report.signatures

    expect(signature.intact).toBe(true)
    expect(signature.problems).toStrictEqual([{ kind: 'certificate-expired', signedAt: new Date('2026-09-22T12:00:00Z') }])
  }, 60_000)

  it('says plainly when a file carries no signature', async () => {
    const unsigned = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')

    expect(await verifySignatures(unsigned)).toStrictEqual({ signed: false, signatures: [], unbroken: false })
  })

  it('reads a signature out of a file too broken for a PDF parser', async () => {
    const pdf = await signedPdf()
    // The cross-reference table destroyed: no parser will open this, and the
    // question - what does the signature cover, and does it still hold - is
    // exactly the question a tampered file raises.
    const wrecked = tamper(pdf, 'startxref', 'startxrXf')
    const report = await verifySignatures(wrecked)

    expect(report.signed).toBe(true)
    expect(report.signatures[0].intact).toBe(false)
    expect(report.signatures[0].problems).toStrictEqual([{ kind: 'digest-mismatch' }])
  }, 60_000)
})
