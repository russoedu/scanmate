/**
 * Builds a labelled corpus out of real scans, by altering them.
 *
 * A threshold is a claim about a corpus, and a corpus of synthetic pages proves
 * nothing about paper. So this starts from scans of a real document and alters
 * them three ways, each alteration made on the *aligned scan itself*: the
 * paper, the grain, the lighting and the scanner are then identical on both
 * sides of every pair, and the only difference is the alteration. A genuine
 * control is saved for each page by the same path, so nothing is compared
 * across encodings either.
 *
 *   node tools/calibration/build-corpus.mjs --documents <dir> [--original OCF.pdf] [--out corpus]
 *
 * `--documents` is a folder you keep outside this repository, holding the
 * original PDF and one or more scans of it. **Real documents never enter the
 * repository**, and neither does the corpus this writes - see the README.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { cloneRaster, drawLine, encodeImage, fillRect, toGrayscale } from '@scanmate/ink'
import { placeGlyphs, printPolarity } from '@scanmate/ocr'
import { Scanmate } from '@scanmate/scan'

const { values } = parseArgs({ options: {
  documents: { type: 'string' },
  original:  { type: 'string', default: 'OCF.pdf' },
  scans:     { type: 'string' },
  out:       { type: 'string', default: 'corpus' },
} })

if (values.documents === undefined) {
  console.error('--documents <dir> is required: the folder holding the original and its scans, kept outside this repository.')
  process.exit(1)
}

const original = join(values.documents, values.original)
const scans = values.scans?.split(',')
  ?? readdirSync(values.documents).filter(name => name.toLowerCase().endsWith('.pdf') && name !== values.original).sort()

if (scans.length === 0) {
  console.error(`no scans found in ${values.documents} beside ${values.original}`)
  process.exit(1)
}

mkdirSync(values.out, { recursive: true })
const cases = []
/** A text run's box in pixels, from the points the text layer speaks in. */
const pt = (box, k) => ({ x: box.x * k, y: box.y * k, width: box.width * k, height: box.height * k })

for (const [index, scan] of scans.entries()) {
  const label = `s${String(index + 1).padStart(2, '0')}`
  const session = new Scanmate(original, join(values.documents, scan))
  const aligned = await session.align()

  for (const page of aligned) {
    const dpi = page.original.dpi ?? 150
    const k = dpi / 72
    const grey = toGrayscale(page.original.raster)
    const items = page.metadata.original.textItems
    const tag = `${label}-p${page.page}`
    const save = async (id, raster, genuine, how) => {
      const file = join(values.out, `${id}.png`)
      writeFileSync(file, await encodeImage(raster))
      cases.push({ id, genuine, page: page.page, file, how })
    }

    await save(`${tag}-genuine`, page.aligned.raster, true, 'as scanned')

    // 1. A digit replaced by another cut from the same printed number: the
    //    document's own ink, at the document's own resolution, which is the
    //    forgery this suite exists to catch and the hardest one to see.
    for (const run of items.filter(item => /\d[\d,]{4,}/.test(item.text))) {
      const lightOnDark = printPolarity(grey, dpi, run) === 'light-on-dark'
      const cells = placeGlyphs(grey, dpi, run, run.text, { lightOnDark })
      if (cells === null) continue

      const digits = [...run.text].map((character, at) => ({ character, at })).filter(digit => /\d/.test(digit.character) && cells[digit.at] !== null)
      const pair = digits.flatMap(one => digits.filter(other => other.character !== one.character).map(other => [one, other])).find(Boolean)
      if (pair === undefined) continue

      const raster = cloneRaster(page.aligned.raster)
      const from = pt(cells[pair[1].at], k)
      const onto = pt(cells[pair[0].at], k)
      for (let y = 0; y < Math.min(from.height, onto.height); y++) {
        for (let x = 0; x < Math.min(from.width, onto.width); x++) {
          const source = ((Math.round(from.y) + y) * raster.width + Math.round(from.x) + x) * 4
          const target = ((Math.round(onto.y) + y) * raster.width + Math.round(onto.x) + x) * 4
          raster.data.copyWithin(target, source, source + 4)
        }
      }
      await save(`${tag}-digit`, raster, false, `"${run.text}": ${pair[0].character} replaced by its own ${pair[1].character}`)
      break
    }

    // 2. A word erased: paper painted over it, as correction fluid does.
    const word = items.filter(item => item.text.trim().length > 6 && item.width > 30).at(-1)
    if (word !== undefined) {
      const raster = cloneRaster(page.aligned.raster)
      fillRect(raster, pt(word, k), 252)
      await save(`${tag}-erased`, raster, false, `"${word.text.trim().slice(0, 30)}" painted out`)
    }

    // 3. A mark added where the original prints nothing: a pen stroke below the
    //    lowest thing on the page, 0.4 mm wide whatever the scan's resolution.
    const lowest = items.reduce((low, item) => (item.y > low.y ? item : low), items[0])
    if (lowest !== undefined) {
      const raster = cloneRaster(page.aligned.raster)
      const y = (lowest.y + 14) * k
      const width = Math.max(1, Math.round(0.4 / 25.4 * dpi))
      drawLine(raster, 60 * k, y, 150 * k, y + 6 * k, width, 40)
      drawLine(raster, 150 * k, y + 6 * k, 210 * k, y - 4 * k, width, 40)
      await save(`${tag}-mark`, raster, false, 'a pen stroke added in the margin')
    }
  }

  await session.dispose()
  console.log(`${label} (${scan}) done: ${cases.filter(one => one.id.startsWith(label)).length} documents`)
}

writeFileSync(join(values.out, 'cases.json'), JSON.stringify({ original, cases }, null, 1))
console.log(`total ${cases.length} | genuine ${cases.filter(one => one.genuine).length} | altered ${cases.filter(one => !one.genuine).length}`)
