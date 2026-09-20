/**
 * `@scanmate/ocr` - how closely a scan's text matches the original's.
 *
 * ```ts
 * import { ocrPages } from '@scanmate/ocr'
 *
 * const report = await ocrPages(alignedPages)          // or enhanced pages
 * report.score                                          // the document, 0-1
 * report.pages[0].metrics.wordRecall                    // one of ten measures
 * report.pages[0].differences                           // what differs, and where
 * report.pages[0].original.text                         // both texts, in full
 * report.pages[0].scanned.text
 * ```
 *
 * The original's text is its text layer when it has one: exact, so every error
 * is the scan's. The scan is read with tesseract - WebAssembly, offline, with
 * nothing written to disk unless configured to be. Its words are placed back on
 * the original's canvas and matched run by run to what the original printed
 * there, so reading order never counts as a difference and every difference
 * has a place on the page.
 *
 * Text is normalised before it is compared: Unicode compatibility forms,
 * typography, line-end hyphens, diacritics, case, and OCR noise.
 */

export { ocrPages } from './page-reading'
export type { OcrOptions, OcrReport, PageOcr, PlacedText, PositionedText, ReadablePage, RunReading, SideText, TextDifference } from './page-reading'
export { createTesseractEngine, DEFAULT_TESSERACT_OPTIONS } from './ocr-engine'
export type { OcrEngine, OcrLine, OcrWord, RecognisedText, RecogniseHints, TesseractCacheOptions, TesseractEngine, TesseractEngineOptions, TesseractSettings } from './ocr-engine'
export { compareTexts } from './text-similarity'
export type { ScoreMetric, TextMetrics } from './text-similarity'
export { DEFAULT_NORMALISE, normaliseText, tokenise } from './text-normalisation'
export type { NormaliseOptions } from './text-normalisation'

// --- Building blocks ---

export { collectTemplates, FIGURE_CHARACTERS, glyphCells, glyphWords, placeGlyphs, printPolarity, templateKey, TEXT_CHARACTERS, verifyPrintedRun } from './print-verification'
export type { Box, CellOptions, PrintedRun, PrintPolarity, PrintVerification, Templates, VerifyOptions } from './print-verification'
export { claimWords, DEFAULT_RECHECK_PASSES, judgeRun, judgeRuns, matchWords, readRun, recheckRun } from './page-reading'
export type { Claims, MatchOptions, Recheck, RecheckOptions, RecheckPass, Reference, Verdict, WordMatch } from './page-reading'
export { cosine, dice, jaccard, jaroWinkler, levenshtein, levenshteinSimilarity, wordDistance, wordRecall } from './text-similarity'
export { diacriticsMap, foldConfusables, foldDiacritics } from './text-normalisation'
