import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Scanmate } from '../scan-session'
import { checkSignatures } from './check-signatures.use-case'

/**
 * That a document reaches `@scanmate/seal` whole, however it was handed in.
 *
 * Whether a signature verifies is settled in `@scanmate/seal`, against
 * signatures it makes itself with a real key - that is its test, not this one.
 * What is this package's own is everything around it: reading the bytes off a
 * path, a URL or an array, answering honestly for a document it assembled, and
 * loading the signature code only when someone asks for it.
 */

/** A PDF carrying a signature dictionary whose signature is nonsense. */
function signatureShaped (): Uint8Array {
  const body = '%PDF-1.7\n1 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ' +
    `/ByteRange [0 100 200 300] /Contents <${'00'.repeat(64)}> >>\nendobj\n%%EOF\n`

  return new TextEncoder().encode(body)
}

const unsigned = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')

describe('checkSignatures', () => {
  it('says plainly when a document carries no signature', async () => {
    expect(await checkSignatures(unsigned)).toStrictEqual({ signed: false, signatures: [], unbroken: false })
  })

  it('runs the signature through @scanmate/seal, and reports what it found wrong', async () => {
    const report = await checkSignatures(signatureShaped())

    expect(report.signed).toBe(true)
    expect(report.unbroken).toBe(false)
    expect(report.signatures[0].subFilter).toBe('adbe.pkcs7.detached')
    expect(report.signatures[0].problems.map(problem => problem.kind)).toContain('unreadable')
  })

  it('reads a document named by path, and one named by file URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scanmate-seal-'))
    const path = join(directory, 'signed.pdf')
    await writeFile(path, signatureShaped())

    const byPath = await checkSignatures(path)
    const byUrl = await checkSignatures(pathToFileURL(path))

    expect(byPath.signed).toBe(true)
    expect(byUrl.signed).toBe(true)
  })

  it('reports a document it assembled itself as unsigned, because it is', async () => {
    // Images merged into a PDF here carry nobody's signature, and verifying the
    // bytes this package just wrote would be verifying our own work.
    const report = await checkSignatures([unsigned, unsigned])

    expect(report).toStrictEqual({ signed: false, signatures: [], unbroken: false })
  })
})

describe('Scanmate.seal', () => {
  it('checks a PDF with no session at all', async () => {
    const report = await Scanmate.seal(signatureShaped())

    expect(report.signed).toBe(true)
  })

  it('checks the scan by default, and the original when asked', async () => {
    const session = new Scanmate(signatureShaped(), unsigned)

    const scanned = await session.seal()
    const original = await session.seal('original')

    expect(scanned.signed).toBe(false)
    expect(original.signed).toBe(true)
    await session.dispose()
  })

  it('remembers each side, so asking twice reads once', async () => {
    const session = new Scanmate(unsigned, signatureShaped())
    const [first, second] = await Promise.all([session.seal(), session.seal()])

    expect(first).toBe(second)
    await session.dispose()
  })
})
