import { createRaster, resampleRaster } from '@scanmate/ink'
import type { Raster } from '@scanmate/ink'

import type { OcrEngine } from '../ocr-engine'
import type { PrintPolarity } from '../print-verification'
import { FIGURE, judgeRun } from './match-words.use-case'
import type { MatchOptions, Reference } from './match-words.use-case'

/**
 * A second look at one run the page reading got wrong, before calling it a
 * difference.
 *
 * Read as part of a whole page, a short run - a figure in a table, a word on
 * a shaded bar - is at the mercy of the engine's layout analysis and of one
 * resolution. Cropped to itself, enlarged further, read as a single line (or
 * word, or as digits only when it is a figure), light-on-dark text inverted,
 * contrast stretched, it often reads cleanly. Whether the text is light on a
 * dark bar is taken from the original, where it is certain, rather than
 * guessed from the scan: a white total on a purple bar can scan as pale lilac
 * on paler lilac, too light overall to look like a dark bar. Measured on real scans at 120
 * and 144 dpi, cropped multi-pass reading confirmed 96-97% of every printed
 * value on the page; at 93 dpi, a third.
 *
 * The danger is the opposite error: try enough readings and one may land on
 * the expected text by chance - on a 93-dpi scan a single agreeing pass
 * accepted 4 of 61 forged digits. So a run is cleared only when `agree`
 * separate passes (two by default) read it as the original prints it, by the
 * same rule the page is judged by: figures exactly, words within the threshold.
 */

export interface RecheckPass {
  /** Resolution to enlarge the crop to; a crop already finer is not reduced. */
  dpi:      number
  /** Read the crop as one line of text, or as one word. */
  layout:   'line' | 'word'
  /** Stretch the crop's contrast to full black and white first. */
  stretch?: boolean
}

export interface RecheckOptions {
  /** The readings to try, in order. Default {@link DEFAULT_RECHECK_PASSES}. */
  passes?: readonly RecheckPass[]
  /** Passes that must agree with the original to clear a run. Default `2`. */
  agree?:  number
}

export const DEFAULT_RECHECK_PASSES: readonly RecheckPass[] = [
  { dpi: 300, layout: 'line' },
  { dpi: 400, layout: 'line' },
  { dpi: 400, layout: 'line', stretch: true },
  { dpi: 500, layout: 'line' },
  { dpi: 400, layout: 'word' },
  { dpi: 600, layout: 'line', stretch: true },
]

export interface Recheck {
  cleared: boolean
  /** An agreeing reading when cleared; `null` otherwise. */
  reading: string | null
  /** Passes tried, and how many agreed. */
  passes:  number
  agreed:  number
}

/** What a figure may be read as, when a run is only a figure. */
const FIGURE_CHARACTERS = '0123456789.,:/%()+-'
/** White kept around a crop, in pixels: tesseract reads poorly off the edge of an image. */
const MARGIN = 12

/**
 * Reads one run's crop once per pass, and says what each pass read - without
 * judging it against anything.
 *
 * `recheckRun` asks "does this still say what the original prints?", which is
 * the right question while reading a page. It is the wrong question once the
 * pixels have disagreed with the reading, because a systematic misreading -
 * a face, a size, a resolution the engine handles badly - misreads the
 * *original* just as surely as the scan. Reading both sides the same way and
 * comparing the two readings to each other cancels exactly that error, and
 * needs the readings themselves rather than a verdict.
 *
 * @param engine - The engine to read with.
 * @param image - The page to crop from, and its resolution.
 * @param run - The run to read, placed on that page.
 * @param options - Which passes to try; the matching rules pick the charset.
 * @param polarity - Whether the original prints this run light on dark.
 * @returns What each pass read, in order; empty when the run cannot be cropped.
 */
export async function readRun (
  engine: OcrEngine,
  image: { raster: Raster, dpi: number },
  run: Reference,
  options: MatchOptions & RecheckOptions,
  polarity?: PrintPolarity,
): Promise<string[]> {
  const { passes = DEFAULT_RECHECK_PASSES } = options
  const crop = cropRun(image.raster, image.dpi, run, polarity)
  if (crop === null) return []

  const characters = FIGURE.test(run.text.trim()) ? FIGURE_CHARACTERS : undefined
  const readings: string[] = []
  for (const pass of passes) {
    const scale = Math.max(1, pass.dpi / image.dpi)
    const enlarged = scale === 1 ? crop : await resampleRaster(crop, Math.round(crop.width * scale), Math.round(crop.height * scale))
    const prepared = frame(polarity === 'light-on-dark' || pass.stretch === true ? stretch(enlarged) : enlarged)
    const read = await engine.recognise(prepared, { layout: pass.layout, characters })
    readings.push(read.lines.map(line => line.text).join(' ').trim())
  }

  return readings
}

export async function recheckRun (
  engine: OcrEngine,
  image: { raster: Raster, dpi: number },
  run: Reference,
  options: MatchOptions & RecheckOptions,
  polarity?: PrintPolarity,
): Promise<Recheck> {
  const { passes = DEFAULT_RECHECK_PASSES, agree = 2 } = options
  const crop = cropRun(image.raster, image.dpi, run, polarity)
  if (crop === null) return { cleared: false, reading: null, passes: 0, agreed: 0 }

  const characters = FIGURE.test(run.text.trim()) ? FIGURE_CHARACTERS : undefined
  let agreed = 0
  let reading: string | null = null
  let tried = 0

  for (const pass of passes) {
    if (agreed + (passes.length - tried) < agree) break
    tried++
    const scale = Math.max(1, pass.dpi / image.dpi)
    const enlarged = scale === 1 ? crop : await resampleRaster(crop, Math.round(crop.width * scale), Math.round(crop.height * scale))
    // Inverted text keeps the bar's grey behind it; only a stretch makes that paper white.
    const prepared = frame(polarity === 'light-on-dark' || pass.stretch === true ? stretch(enlarged) : enlarged)
    const read = await engine.recognise(prepared, { layout: pass.layout, characters })
    const text = read.lines.map(line => line.text).join(' ').trim()

    if (judgeRun(run.text, text, options).agrees) {
      agreed++
      reading ??= text
      if (agreed >= agree) return { cleared: true, reading, passes: tried, agreed }
    }
  }

  return { cleared: false, reading: null, passes: tried, agreed }
}

/**
 * The run's box on the image, grown by a quarter of its height (at least 2 pt)
 * so the glyphs are whole; light text on a dark bar is turned dark on light -
 * as the original prints it when that is known, else when the crop is dark.
 */
function cropRun (raster: Raster, dpi: number, run: Reference, polarity?: PrintPolarity): Raster | null {
  const s = dpi / 72
  const pad = Math.max(2, run.height * 0.25)
  const left = Math.max(0, Math.floor((run.x - pad) * s))
  const top = Math.max(0, Math.floor((run.y - pad) * s))
  const right = Math.min(raster.width, Math.ceil((run.x + run.width + pad) * s))
  const bottom = Math.min(raster.height, Math.ceil((run.y + run.height + pad) * s))
  if (right - left < 2 || bottom - top < 2) return null

  const out = createRaster(right - left, bottom - top)
  for (let y = top; y < bottom; y++)
    out.data.set(raster.data.subarray((y * raster.width + left) * 4, (y * raster.width + right) * 4), (y - top) * out.width * 4)

  let sum = 0
  for (let i = 0; i < out.data.length; i += 4) sum += luminance(out.data, i)
  const invert = polarity === undefined ? sum / (out.width * out.height) < 110 : polarity === 'light-on-dark'
  if (invert)
    for (let i = 0; i < out.data.length; i += 4)
      for (let c = 0; c < 3; c++) out.data[i + c] = 255 - out.data[i + c]

  return out
}

/** Linear stretch so the darkest 2% become black and the lightest 2% white. */
function stretch (raster: Raster): Raster {
  const values = new Uint8Array(raster.width * raster.height)
  for (let p = 0; p < values.length; p++) values[p] = luminance(raster.data, p * 4)
  const sorted = values.toSorted()
  const low = sorted[Math.floor(sorted.length * 0.02)]
  const high = sorted[Math.floor(sorted.length * 0.98)]
  if (high <= low) return raster

  const out = createRaster(raster.width, raster.height)
  for (const [p, value] of values.entries()) {
    const v = Math.round(((value - low) / (high - low)) * 255)
    out.data.fill(Math.min(255, Math.max(0, v)), p * 4, p * 4 + 3)
  }

  return out
}

/** The crop on a white border. */
function frame (raster: Raster): Raster {
  const out = createRaster(raster.width + 2 * MARGIN, raster.height + 2 * MARGIN)
  for (let y = 0; y < raster.height; y++)
    out.data.set(raster.data.subarray(y * raster.width * 4, (y + 1) * raster.width * 4), ((y + MARGIN) * out.width + MARGIN) * 4)

  return out
}

function luminance (data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
}
