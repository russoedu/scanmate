/**
 * Writes the images the merge goldens are computed over.
 *
 * Run once; the output is COMMITTED, for the same reason the seal fixtures are:
 * `parity:check` regenerates the goldens and fails on any diff, so every input
 * has to be fixed bytes. These *could* be regenerated deterministically from a
 * seeded synthetic document - but only on a machine with the same libvips, and
 * the goldens are written on one platform and checked on another.
 *
 * The PDF case reuses `fixtures/seal/plain.pdf` rather than making another one.
 *
 * One fixture is NOT written here: `cmyk.jpg` comes from
 * `make-merge-fixtures.py`, because libvips - which `@scanmate/ink` encodes
 * through - does not write a CMYK JPEG, and the CMYK case is exactly what
 * decides whether a JPEG is embedded as its own bytes or decoded first.
 *
 * ```sh
 * node tools/parity/fixtures/make-merge-fixtures.mts
 * ```
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createSyntheticDocument,
  encodeImage,
  toGrayscale,
} from '../../../packages/ink/dist/index.esm.js'
import { mergeDocuments } from '../../../packages/merge/dist/index.esm.js'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'merge')

const page = createSyntheticDocument({ width: 240, height: 320, seed: 7 })
const grey = toGrayscale(page.raster)

const cases: Array<[string, Uint8Array]> = [
  // Embedded as its own bytes: a scan must not be compressed a second time.
  ['photo.jpg', await encodeImage(page.raster, { format: 'jpeg', quality: 90 })],
  // A greyscale JPEG, which is the other colour space a PDF takes directly.
  ['grey.jpg', await encodeImage(grey, { format: 'jpeg', quality: 90 })],
  // Carried over losslessly - as pixels, since a PDF cannot hold a PNG file.
  ['page.png', await encodeImage(page.raster, { format: 'png' })],
  /*
   * An A4 page, for marking. Every other fixture PDF is exactly 200 x 200, so
   * the one-decimal rounding in a mark's "reaches past the edge" warning is a
   * no-op on all of them - and a port that skipped the rounding passed. 595.28
   * x 841.89 rounds to 595.3 x 841.9, and now says so.
   */
  ['a4.pdf', (await mergeDocuments(
    [await encodeImage(page.raster, { format: 'png' })],
    { pageSize: 'a4' },
  )).pdf],
]

mkdirSync(out, { recursive: true })
for (const [name, bytes] of cases) {
  writeFileSync(join(out, name), bytes)
  console.log(`${name.padEnd(12)} ${String(bytes.length).padStart(7)} bytes`)
}
console.log(`\n${cases.length} fixtures written to ${out}`)
