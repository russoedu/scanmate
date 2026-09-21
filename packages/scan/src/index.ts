/**
 * `@scanmate/scan` - one class over the whole pipeline.
 *
 * ```ts
 * import { Scanmate } from '@scanmate/scan'
 *
 * const scan = new Scanmate('issued.pdf', 'returned.pdf', {
 *   expected: [{ page: 1, id: 'signature', x: 120, y: 577, width: 262, height: 22 }],
 * })
 * const report = await scan.audit()
 * report.verdict                     // 'pass' | 'review'
 * report.pages[0].evidenceImage      // original, scan and overlay, findings drawn
 * await scan.dispose()
 * ```
 *
 * Each stage runs what it needs, remembers what it did, and is loaded only when
 * it is used: a session that only aligns never evaluates tesseract or a PDF
 * library. The stages remain usable on their own - this is the convenient door,
 * not the only one.
 */

export { Scanmate } from './scan-session'
export type { AlignedScanmatePage, EnhancedScanmatePage, ReadableScanmatePage, ScanmateOptions, ScanmatePageReport } from './scan-session'
export type { ScanmateDocument, ScanmatePage } from './document-input'

// What `Scanmate.mark` takes and returns. Type-only, so erased before anything
// runs: re-exporting them loads nothing, and a session that never marks a page
// still never touches @scanmate/merge.
export type { MarkOptions, MarkResult, PageMark } from '@scanmate/merge'
export type { Bleed } from '@scanmate/ink'

// --- Building blocks ---

export { MissingStageError, loadedStages } from './stage-loading'
export { fingerprint } from './stage-caching'
export { SharedEngine } from './reading-engine'
export type { EngineLease } from './reading-engine'
