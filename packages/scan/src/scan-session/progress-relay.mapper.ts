import type { ProgressCallback, StageEvent } from '@scanmate/ink'

/**
 * Makes the reading events emitted from inside an audit count.
 *
 * `auditPages` reads one page at a time, calling `ocrPages([page])` per page and
 * passing the caller's callback straight through. Each of those calls believes
 * it is a run of one, so every `stage: 'ocr'` event says `index: 1, total: 1` -
 * and a progress bar built on `index / total`, which is what the event is for,
 * sits at 100% for the whole document.
 *
 * The session knows the real position, so it rewrites those two fields on the
 * way past. Nothing else is touched: a throw from the callback still propagates,
 * because the contract says a throwing callback aborts the stage and that is
 * deliberate back-pressure, not an accident to be swallowed here.
 */
export function relayAuditProgress (
  onProgress: ProgressCallback | undefined,
  position: (page: number) => number,
  total: number,
): ProgressCallback | undefined {
  if (onProgress === undefined) return undefined

  return (event: StageEvent): void => {
    if (event.stage !== 'ocr') {
      onProgress(event)

      return
    }
    onProgress({ ...event, index: position(event.page), total })
  }
}
