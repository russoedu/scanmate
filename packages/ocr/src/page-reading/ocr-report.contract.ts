import type { ProgressCallback } from '@scanmate/ink'

import type { OcrEngine, TesseractEngineOptions } from '../ocr-engine'
import type { VerifyOptions } from '../print-verification'
import type { RecheckOptions } from './recheck-run.use-case'
import type { NormaliseOptions } from '../text-normalisation'
import type { ScoreMetric, TextMetrics } from '../text-similarity'

/** A run of text placed on the page, in PDF points from the top-left - what `@scanmate/extract` calls a text item. */

/**
 * What `ocrPages` reads: an aligned page, and optionally its enhanced image
 * (`@scanmate/enhance`) and the original's text layer (`@scanmate/extract`).
 * Only the original's text layer is ever used. A scan's own text layer is
 * ignored, deliberately - hidden or stale text must not vouch for what the
 * paper shows.
 */

export interface OcrOptions {
  /** An engine to use and leave running. Default: a tesseract engine made for this call and terminated after it. */
  engine?:            OcrEngine
  /** Settings for that default engine: languages, model, cache. */
  tesseract?:         TesseractEngineOptions
  /**
   * The original's text: `'auto'` (the default) takes its text layer when it
   * has one - exact, and no OCR errors on that side - and reads it otherwise;
   * `'text-layer'` insists; `'ocr'` always reads it.
   */
  original?:          'auto' | 'text-layer' | 'ocr'
  /** Enlarge images below this before reading them. Default `300`; `null` reads them as they are. An `enhanced` image is read as it is. */
  targetDpi?:         number | null
  /** Resolution of a page that does not say. Default `150`. */
  assumeDpi?:         number
  normalise?:         NormaliseOptions
  /** Which metric is a page's `score`. Default `'levenshteinSimilarity'`. */
  scoreMetric?:       ScoreMetric
  /** A run of the original read back below this similarity is a difference. Default `0.8`. */
  matchThreshold?:    number
  /** Scanned words not on any run of the original count as added only from this confidence. Default `60`. */
  minWordConfidence?: number
  /**
   * Re-read each run the page reading doubted, cropped and enlarged, before
   * calling it a difference; it is cleared only when several passes agree with
   * the original. On by default, since a false difference costs a person's
   * time; `false` reports the page reading as it is. See `recheckRun`.
   */
  recheck?:           RecheckOptions | false
  /**
   * Match every printed figure against the original's own glyphs instead of
   * trusting what the scan reads there; `false` leaves figures to the reading.
   * See `verifyPrintedRun`. On by default, and only possible when the original
   * has a text layer.
   */
  printCheck?:        VerifyOptions | false
  onProgress?:        ProgressCallback
}

/** A word or line, placed on the page in points from the top-left. */
export interface PlacedText {
  text:        string
  x:           number
  y:           number
  width:       number
  height:      number
  /** 0-100; `null` for the text layer, which is not a reading. */
  confidence?: number | null
}

export interface SideText {
  source:     'text-layer' | 'ocr'
  /** In the source's own order: the text layer's, or the engine's reading order. */
  text:       string
  /** 0-100 for OCR; `null` for a text layer. */
  confidence: number | null
  lines:      PlacedText[]
  words:      PlacedText[]
}

/**
 * - `changed`: a run of the original, read back as something else;
 * - `missing`: a run of the original with nothing read where it should be;
 * - `added`: words read where the original has none.
 */
export interface TextDifference {
  kind:       'changed' | 'missing' | 'added'
  expected:   string | null
  found:      string | null
  /** Normalised Levenshtein similarity of the two; `0` for missing or added. */
  similarity: number
  /**
   * Why a run counts as changed: its figures differ (`'numbers'`, held to an
   * exact match, since one digit is the whole point), or its words fell below
   * the match threshold (`'text'`). Always `'text'` for missing and added.
   */
  reason:     'numbers' | 'text'
  /**
   * The scan's ink here was matched against the original's own glyphs, and they
   * are not the same glyphs. A difference carrying this was *seen* rather than
   * read, so it stands on its own; one without it is a reading, and a reading
   * disagreeing with identical ink is a misreading.
   */
  verified?:  boolean
  /** Where on the page, in points from the top-left. */
  x:          number
  y:          number
  width:      number
  height:     number
}

/** One run of the original, and what the scan reads in its place. */
export interface RunReading {
  /** The original's text. */
  text:      string
  /** What was read there - by the page reading, or by the recheck that cleared it. */
  found:     string
  /** The reading agrees with the original, by the rule every run is judged by. */
  agrees:    boolean
  /** The run was re-read on its own. */
  rechecked: boolean
  /** Where the original prints it, in points from the top-left. */
  x:         number
  y:         number
  width:     number
  height:    number
}

export interface PageOcr {
  page:        number
  original:    SideText
  scanned:     SideText
  /** Every run of the original with its reading, in the original's order - what a search for required content consults. */
  runs:        RunReading[]
  /**
   * The scan's words re-ordered to follow the original: each run of the
   * original followed by what was read in its place, then any added words.
   * This, not the engine's reading order, is what the metrics compare - so a
   * two-column page read column-wise is not a page of errors.
   */
  alignedText: string
  score:       number
  metrics:     TextMetrics
  differences: TextDifference[]
  /** Runs the page reading doubted and re-read on their own, and how many of them the re-reading cleared. */
  rechecks:    { attempted: number, cleared: number }
  /** Printed figures matched against the original's own glyphs, and how many read as something else. */
  printChecks: { checked: number, different: number }
  warnings:    string[]
}

export interface OcrReport {
  /** Page scores weighted by each page's expected characters - a three-word page does not outvote a dense one. */
  score:    number
  /** Unweighted mean of page scores; the two disagreeing says the short pages read differently. */
  pageMean: number
  pages:    PageOcr[]
  engine:   { name: string, version: string, languages: readonly string[] }
}
