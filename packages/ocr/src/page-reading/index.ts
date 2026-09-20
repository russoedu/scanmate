/** Reading aligned pages and scoring the scan's text against the original's. */

export { claimWords, judgeRun, judgeRuns, matchWords } from './match-words.use-case'
export type { Claims, MatchOptions, Reference, Verdict, WordMatch } from './match-words.use-case'
export { ocrPages } from './ocr-pages.use-case'
export type { OcrOptions, OcrReport, PageOcr, PlacedText, PositionedText, ReadablePage, RunReading, SideText, TextDifference } from './ocr-report.contract'
export { DEFAULT_RECHECK_PASSES, readRun, recheckRun } from './recheck-run.use-case'
export type { Recheck, RecheckOptions, RecheckPass } from './recheck-run.use-case'
