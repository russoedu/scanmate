import { resampleRaster, toGrayscale } from '@scanmate/ink'
import type { Raster, ReadablePage, TextRun } from '@scanmate/ink'

import { collectInto, mergeVerifiedFigures, printPolarity, verifyPrintedRun } from '../print-verification'
import type { TemplateStore, Templates } from '../print-verification'
import { createTesseractEngine } from '../ocr-engine'
import type { OcrEngine, RecognisedText } from '../ocr-engine'
import { DEFAULT_NORMALISE } from '@scanmate/ink'
import { compareTexts } from '../text-similarity'
import { claimWords, judgeRun, judgeRuns } from './match-words.use-case'
import type { MatchOptions, Reference } from './match-words.use-case'
import { recheckRun } from './recheck-run.use-case'
import type { OcrOptions, OcrReport, PageOcr, PlacedText, ReadPage, SideText } from './ocr-report.contract'

/**
 * Read every aligned page and say how closely the scan's text matches the
 * original's - per page, and for the document.
 *
 * The scan is read from its enhanced image when there is one, otherwise from
 * the aligned scan enlarged to `targetDpi`. The original comes from its text
 * layer when it has one, which is exact, so every error counted is the scan's;
 * otherwise it is read the same way. Both are then compared run by run of the
 * original, on the shared canvas, rather than in whatever order the engine
 * read them.
 *
 * One engine serves the whole call. Pass `engine` to share one across calls;
 * it is then left running.
 */
export async function ocrPages<Page extends ReadablePage> (pages: readonly Page[], options: OcrOptions = {}): Promise<OcrReport<Page>> {
  const engine = options.engine ?? await createTesseractEngine(options.tesseract)
  try {
    // The glyphs of the whole document, gathered before any page is read.
    //
    // A page's own figures are often set in a face it uses for little else, and
    // a run cannot be checked against rivals that are not there - on a real
    // order confirmation the face of the page-1 total carries six distinct
    // digits on that page and nine across the document, and six is below the
    // bar for checking anything at all. The same face at the same size renders
    // identically on every page, so a glyph from page 4 is as good a template
    // as one from page 1.
    //
    // Each page's greyscale is dropped as soon as its glyphs are taken, so this
    // holds one page of pixels at a time, not the document.
    const templates: TemplateStore = new Map()
    if (options.printCheck !== false)
      for (const page of pages) {
        const items = page.metadata?.original?.textItems
        if (items === undefined || items === null || items.length === 0) continue
        collectInto(templates, toGrayscale(page.original.raster), page.original.dpi ?? options.assumeDpi ?? 150, items)
      }

    const results: Array<ReadPage<Page>> = []
    for (const [position, page] of pages.entries()) {
      const index = position + 1
      const started = Date.now()
      options.onProgress?.({ stage: 'ocr', phase: 'start', page: page.page, index, total: pages.length })

      const result = await readPage(page, engine, options, templates)
      results.push({ ...page, text: result })

      options.onProgress?.({
        stage:      'ocr',
        phase:      'done',
        page:       page.page,
        index,
        total:      pages.length,
        durationMs: Date.now() - started,
        detail:     { score: result.score, original: result.original.source, confidence: result.scanned.confidence, differences: result.differences.length, rechecked: result.rechecks.attempted, cleared: result.rechecks.cleared },
      })
    }

    const readings = results.map(page => page.text)
    const characters = readings.reduce((sum, reading) => sum + reading.metrics.characters, 0)

    return {
      score:    characters === 0 ? mean(readings.map(r => r.score)) : readings.reduce((sum, r) => sum + r.score * r.metrics.characters, 0) / characters,
      pageMean: mean(readings.map(r => r.score)),
      pages:    results,
      engine:   { name: engine.name, version: engine.version, languages: engine.languages },
    }
  } finally {
    if (options.engine === undefined) await engine.terminate()
  }
}

async function readPage (page: ReadablePage, engine: OcrEngine, options: OcrOptions, templates: Templates): Promise<PageOcr> {
  const {
    original: originalSource = 'auto',
    targetDpi = 300,
    assumeDpi = 150,
    normalise = DEFAULT_NORMALISE,
    scoreMetric = 'levenshteinSimilarity',
    matchThreshold = 0.8,
    minWordConfidence = 60,
    recheck = {},
    printCheck = {},
  } = options
  const warnings: string[] = []

  // The scan: its enhanced image as it is, or the aligned scan made fine enough to read.
  const scanImage = page.enhanced
    ? { raster: page.enhanced.raster, dpi: page.enhanced.dpi ?? assumeDpi }
    : await readable(page.aligned.raster, page.original.dpi ?? assumeDpi, targetDpi)
  const scanned = placed(await engine.recognise(scanImage.raster), scanImage.dpi)
  if (scanned.side.text.trim() === '') warnings.push('nothing could be read on the scanned page')

  // The original: its own text where it has some, else read like the scan.
  const items = page.metadata?.original?.textItems ?? []
  const useLayer = originalSource !== 'ocr' && items.length > 0
  if (originalSource === 'text-layer' && items.length === 0) warnings.push('the original has no text layer, so it was read by OCR')

  let original: SideText
  let references: Reference[]
  if (useLayer) {
    references = items.map(item => ({ text: item.text, x: item.x, y: item.y, width: item.width, height: item.height, endsLine: item.endsLine, confidence: null }))
    original = { source: 'text-layer', text: items.map(i => i.text + (i.endsLine === true ? '\n' : ' ')).join('').trim(), confidence: null, lines: references, words: references }
  } else {
    const image = await readable(page.original.raster, page.original.dpi ?? assumeDpi, targetDpi)
    original = placed(await engine.recognise(image.raster), image.dpi).side
    references = original.lines.map(line => ({ ...line, endsLine: true }))
  }

  // Place the scan's words on the original's runs; give every doubted run a
  // second look of its own before it counts as a difference.
  const rules: MatchOptions = { normalise, matchThreshold, minWordConfidence }
  const claims = claimWords(references, scanned.side.words, scanned.lineOf, rules)
  // Words over ink the original itself printed - a logo, a heading set as an
  // image - belong to the original even though its text layer lacks them.
  // Writing over printed matter is for @scanmate/diff to see, not this.
  const originalDpi = page.original.dpi ?? assumeDpi
  const originalGray = toGrayscale(page.original.raster)
  claims.added = claims.added
    .map(group => group.filter(word => !printedUnder(page.original.raster, originalDpi, word)))
    .filter(group => group.length > 0)
  const rechecks = { attempted: 0, cleared: 0 }
  const rechecked = new Set<number>()
  if (recheck !== false)
    for (const [r, run] of references.entries()) {
      if (judgeRun(run.text, claims.found[r], rules).agrees) continue
      rechecks.attempted++
      rechecked.add(r)
      const second = await recheckRun(engine, scanImage, run, { ...rules, ...recheck }, printPolarity(originalGray, originalDpi, run))
      if (second.reading === null) continue
      claims.found[r] = second.reading
      rechecks.cleared++
    }
  // Figures are matched against the original's own glyphs, which settles what no
  // reading of a returned scan can: whether this is still the digit that was printed.
  const printChecks: PageOcr['printChecks'] = {
    checked:   0,
    different: 0,
    skipped:   { 'no-figure': 0, 'unplaceable': 0, 'few-rivals': 0, 'too-coarse': 0, 'undecided': 0, 'no-claim': 0 },
  }
  const seenChanged = new Set<number>()
  if (printCheck !== false && useLayer) {
    const scanGray = toGrayscale(page.aligned.raster)
    const printed: TextRun[] = items.map(item => ({ ...item }))
    for (const [r, run] of printed.entries()) {
      const verified = verifyPrintedRun(originalGray, scanGray, originalDpi, run, templates, printCheck)
      if (!verified.verified) {
        printChecks.skipped[verified.because]++
        continue
      }
      printChecks.checked++
      if (!verified.agrees) {
        printChecks.different++
        seenChanged.add(r)
      }
      claims.found[r] = mergeVerifiedFigures(claims.found[r], run, verified)
    }
  }

  const match = judgeRuns(references, claims, rules, seenChanged)
  const runs = references.map((run, r) => ({
    text:      run.text,
    found:     claims.found[r],
    agrees:    judgeRun(run.text, claims.found[r], rules).agrees,
    rechecked: rechecked.has(r),
    x:         run.x,
    y:         run.y,
    width:     run.width,
    height:    run.height,
  }))
  const metrics = compareTexts(match.expectedText, match.alignedText, normalise)
  if (scanned.side.confidence !== null && scanned.side.confidence < 60) warnings.push(`low OCR confidence on the scanned page (${Math.round(scanned.side.confidence)})`)

  return {
    page:        page.page,
    original,
    scanned:     scanned.side,
    runs,
    alignedText: match.alignedText,
    score:       metrics[scoreMetric],
    metrics,
    differences: match.differences,
    rechecks,
    printChecks,
    warnings,
  }
}

/**
 * At least this share of a word's box dark in the original means the original
 * printed something there. Printed words - a logo's letters - cover a third of
 * their box or more; a form's rule or a checkbox edge crossing a handwritten
 * word covers a tenth. Only the first explains the word away.
 */
const PRINTED_SHARE = 0.2

/** The original has ink under the word: something is printed there, text layer or not. */
function printedUnder (raster: Raster, dpi: number, word: PlacedText): boolean {
  const s = dpi / 72
  const left = Math.max(0, Math.floor(word.x * s))
  const top = Math.max(0, Math.floor(word.y * s))
  const right = Math.min(raster.width, Math.ceil((word.x + word.width) * s))
  const bottom = Math.min(raster.height, Math.ceil((word.y + word.height) * s))
  if (right <= left || bottom <= top) return false

  let dark = 0
  for (let y = top; y < bottom; y++)
    for (let x = left, i = (y * raster.width + left) * 4; x < right; x++, i += 4)
      if (0.299 * raster.data[i] + 0.587 * raster.data[i + 1] + 0.114 * raster.data[i + 2] < 128) dark++

  return dark / ((right - left) * (bottom - top)) >= PRINTED_SHARE
}

/** An image at `targetDpi` or finer: enlarged when below it, kept as it is otherwise. */
async function readable (raster: Raster, dpi: number, targetDpi: number | null): Promise<{ raster: Raster, dpi: number }> {
  if (targetDpi === null || dpi >= targetDpi) return { raster, dpi }
  const scale = targetDpi / dpi

  return { raster: await resampleRaster(raster, Math.round(raster.width * scale), Math.round(raster.height * scale)), dpi: targetDpi }
}

/** An engine's reading, moved from the image's pixels to points on the page. */
function placed (read: RecognisedText, dpi: number): { side: SideText, lineOf: number[] } {
  const toPoints = 72 / dpi
  const words: PlacedText[] = []
  const lineOf: number[] = []
  const lines: PlacedText[] = []

  for (const [l, line] of read.lines.entries()) {
    if (line.words.length === 0) continue
    const inPoints = line.words.map(w => ({ text: w.text, confidence: w.confidence, x: w.x * toPoints, y: w.y * toPoints, width: w.width * toPoints, height: w.height * toPoints }))
    words.push(...inPoints)
    lineOf.push(...inPoints.map(() => l))
    const left = Math.min(...inPoints.map(w => w.x))
    const top = Math.min(...inPoints.map(w => w.y))
    lines.push({
      text:       line.text,
      confidence: mean(inPoints.map(w => w.confidence ?? 0)),
      x:          left,
      y:          top,
      width:      Math.max(...inPoints.map(w => w.x + w.width)) - left,
      height:     Math.max(...inPoints.map(w => w.y + w.height)) - top,
    })
  }

  return { side: { source: 'ocr', text: read.text.trim(), confidence: read.confidence, lines, words }, lineOf }
}

function mean (values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}
