import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * That a stage is not loaded, proven rather than asserted.
 *
 * The in-process check - `loadedStages()` after a call - only reports this
 * package's own bookkeeping, so it would still pass if someone added a
 * convenience `import { encodeImage } from '@scanmate/ink'` at the top of the
 * session and quietly pulled the whole graph back in.
 *
 * So a child process runs a real session against the **built** packages with a
 * module hook that logs every specifier Node resolves, and the assertions are
 * about what that log does not contain. This is the slowest test in the
 * package, and the only one that can catch that regression.
 */

async function resolvedBy (fixture: string): Promise<string> {
  // Windows needs a file:// URL here, not a bare path: the ESM loader refuses `c:\...`.
  const { stdout } = await run(process.execPath, [
    '--import', pathToFileURL(join(fixtures, 'register.mjs')).href,
    join(fixtures, fixture),
  ], {
    cwd:         dirname(fixtures),
    maxBuffer:   32 * 1024 * 1024,
    windowsHide: true,
  })

  return stdout
}

describe('what a session loads', () => {
  it('aligns without loading a reader, a PDF library or the other stages', async () => {
    const resolved = await resolvedBy('align-only.mjs')

    expect(resolved).toContain('DONE')
    expect(resolved).toContain('@scanmate/align')
    expect(resolved).toContain('@scanmate/ink')

    // Named one by one so a failure says which package crept back in.
    const loaded = ['@scanmate/ocr', '@scanmate/extract', '@scanmate/merge', '@scanmate/seal', 'tesseract.js', 'pdfjs-dist', '@cantoo/pdf-lib', '@napi-rs/canvas', 'pkijs']
      .filter(name => resolved.includes(name))

    expect(loaded).toEqual([])
  }, 180_000)

  it('compares pixels without loading a reader or a PDF library', async () => {
    // The pixel comparison is this package's own code now, so it is always
    // there; what must still not load is everything it does not need.
    const resolved = await resolvedBy('diff-too.mjs')

    expect(resolved).toContain('DONE')

    const loaded = ['@scanmate/ocr', '@scanmate/seal', 'tesseract.js', 'pdfjs-dist', '@cantoo/pdf-lib', '@napi-rs/canvas', 'pkijs']
      .filter(name => resolved.includes(name))

    expect(loaded).toEqual([])
  }, 180_000)

  it('checks a signature without loading a single stage of the pipeline', async () => {
    // The point of the check: a born-digital return is settled by arithmetic on
    // its own bytes, so nothing that renders, aligns or reads a page has any
    // business loading. `@scanmate/ink` and its codec are still the floor -
    // this package imports them as values - but nothing above that.
    const resolved = await resolvedBy('seal-only.mjs')

    expect(resolved).toContain('DONE')
    expect(resolved).toContain('@scanmate/seal')

    const loaded = ['@scanmate/ocr', '@scanmate/align', '@scanmate/extract', '@scanmate/merge', 'tesseract.js', 'pdfjs-dist', '@cantoo/pdf-lib', '@napi-rs/canvas']
      .filter(name => resolved.includes(name))

    expect(loaded).toEqual([])
  }, 180_000)

  it('locates fields with the PDF reader alone - no reader of pixels, no other stage', async () => {
    const resolved = await resolvedBy('locate-only.mjs')

    expect(resolved).toContain('DONE')
    expect(resolved).toContain('@scanmate/extract')

    const loaded = ['@scanmate/ocr', '@scanmate/align', '@scanmate/merge', '@scanmate/seal', 'tesseract.js', '@cantoo/pdf-lib', 'pkijs']
      .filter(name => resolved.includes(name))

    expect(loaded).toEqual([])
  }, 180_000)
})
