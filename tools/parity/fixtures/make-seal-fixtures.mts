/**
 * Writes the signed PDFs the seal goldens are computed over.
 *
 * Run once; the output is COMMITTED. That is the one place this differs from
 * every other parity input, and the reason is not a preference: signing needs
 * an RSA key, `webcrypto.subtle.generateKey` cannot be seeded, and so a fixture
 * regenerated on each run would be different bytes every time. `parity:check`
 * regenerates the goldens and fails on any diff, so a non-deterministic input
 * would fail it permanently.
 *
 * Fixed bytes in, deterministic goldens out. Regenerate only when a case is
 * added or the signing fixture itself changes, and expect every seal golden to
 * move when you do - new keys mean new signatures mean new certificate bytes.
 *
 * ```sh
 * node tools/parity/fixtures/make-seal-fixtures.mts
 * ```
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * The signing fixture is test scaffolding, so it is not exported from the
 * package and there is no built `dist` to import it from - it has to be loaded
 * from source. Node runs the TypeScript happily; what it will not do is
 * resolve the extensionless relative imports the source is written with, since
 * those are resolved by the compiler rather than at runtime. So: try the
 * specifier, and on failure try it again with `.ts`.
 *
 * Scoped to relative specifiers deliberately. A bare specifier that fails to
 * resolve is a missing dependency and must still say so.
 */
registerHooks({
  resolve (specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.')) throw error

      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { signedPdf } = await import(
  '../../../packages/seal/src/signature-verification/fixtures/sign-pdf.algorithm.ts'
) as { signedPdf: (options?: Record<string, unknown>) => Promise<Uint8Array> }

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'seal')

/** The same bytes with a run replaced, in place, so every offset is unchanged. */
function tamper (pdf: Uint8Array, find: string, replace: string): Uint8Array {
  const text = new TextDecoder('latin1').decode(pdf)
  const at = text.indexOf(find)
  if (at === -1) throw new Error(`the fixture does not contain ${find}`)
  if (replace.length !== find.length) throw new Error('a replacement must be the same length')
  const bytes = new Uint8Array(pdf)
  for (let i = 0; i < replace.length; i++) bytes[at + i] = replace.codePointAt(i) ?? 0

  return bytes
}

/** The same bytes with more after them, past everything any signature covers. */
function append (pdf: Uint8Array, trailing: string): Uint8Array {
  const extra = new TextEncoder().encode(trailing)
  const bytes = new Uint8Array(pdf.length + extra.length)
  bytes.set(pdf, 0)
  bytes.set(extra, pdf.length)

  return bytes
}

const cases: Array<[string, () => Promise<Uint8Array> | Uint8Array]> = [
  // The ordinary case: one signature, intact, covering the whole file.
  ['plain', () => signedPdf({ name: 'A Person', commonName: 'Test Signer' })],

  // A chain, authority first - so picking the signer by issuer and serial is
  // the difference between naming a person and naming Entrust.
  ['chain', () => signedPdf({ commonName: 'A Signing Person', chain: true })],

  // A certificate that was out of date when the file says it was signed. The
  // signature itself still verifies, which is the point: two independent
  // findings, not one verdict.
  ['expired', () => signedPdf({
    when:     'D:20260922120000Z',
    validity: { from: new Date('2020-01-01T00:00:00Z'), to: new Date('2021-01-01T00:00:00Z') },
  })],

  // A byte changed inside the signed range.
  ['tampered', async () =>
    tamper(await signedPdf(), '/MediaBox [0 0 200 200]', '/MediaBox [0 0 200 900]')],

  // Bytes added after the signed ranges: what IS signed still holds, and the
  // remainder is reported rather than quietly ignored.
  ['appended', async () => append(await signedPdf(), '\n% added after it was signed\n')],

  // The cross-reference table destroyed. No PDF parser will open this, and
  // reading it anyway is the whole reason seal parses bytes rather than PDFs.
  ['wrecked', async () => tamper(await signedPdf(), 'startxref', 'startxrXf')],

  // `/M` written in a form the date mapper must reject rather than guess at.
  ['undated', () => signedPdf({ when: 'D:2026' })],

  // A name as a UTF-16BE hex string with a byte-order mark, which is the other
  // half of `literal()` and the half a latin1 reading gets silently wrong.
  // Changing it breaks the digest, and the golden records that honestly - this
  // fixture exists for the FIELD reading, not the verdict.
  ['utf16-name', async () => {
    const pdf = await signedPdf({ name: 'A Person' })

    // Same length, so every /ByteRange offset in the file still means what it
    // says: `<FEFF0041>` is the byte-order mark plus one UTF-16BE character.
    return tamper(pdf, '/Name (A Person)', '/Name <FEFF0041>')
  }],

  // No signature at all.
  ['unsigned', () =>
    new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')],
]

mkdirSync(out, { recursive: true })
for (const [name, make] of cases) {
  const bytes = await make()
  writeFileSync(join(out, `${name}.pdf`), bytes)
  console.log(`${name.padEnd(12)} ${String(bytes.length).padStart(6)} bytes`)
}
console.log(`\n${cases.length} fixtures written to ${out}`)
