import type { ScanmateOptions } from '../scan-session/scan-session.contract'

export interface BatchOptions extends ScanmateOptions {
  /**
   * Pages in each session. Default `4`. An A4 page at 300 dpi is 35 MB an image,
   * and a session keeps several of each page - the original, the scan, the
   * aligned scan, the overlay, the evidence - so it is the batch, not the
   * document, that sets the peak.
   */
  batch?:   number
  /** Called as each batch is done, with what `work` returned for it. */
  onBatch?: (done: BatchInfo & { result: unknown }) => void | Promise<void>
}

/** Which batch `work` is running on. */
export interface BatchInfo {
  /** One-based. */
  index: number
  count: number
  /** The original's page numbers in this batch; `null` when the pair is two images, which is one page and one batch. */
  pages: number[] | null
}
