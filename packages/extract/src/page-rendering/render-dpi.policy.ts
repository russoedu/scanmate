import type { PageMetadata } from '../page-inspection'

/**
 * What resolution to render a page at.
 *
 * - A number renders every page at that dpi.
 * - `'native'` renders a scanned page at the resolution it was scanned at, and a
 *   born-digital page at `fallbackDpi`. Rendering a 120 dpi scan at 300 adds no
 *   information; it only interpolates.
 * - `'match'` renders the original at the scan's resolution, measured on the
 *   paper it shows: the scan's pixels over the *original's* page size. A scan
 *   stored on a page of its own size is simply its native dpi, and both sides
 *   render alike. A photo stored at one pixel per point - a 3024-pixel-wide
 *   picture of an A4 sheet on a 42-inch page - says 72 dpi of itself but holds
 *   345 on the sheet, so the original renders at 345 and the photo at its own
 *   pixels, never resampled, leaving the scale to alignment. This is the default for pairs, and it is the answer to a
 *   measurement rather than a guess: on real scans at 93, 120 and 144 dpi,
 *   rendering the original at the scan's own dpi beat every fixed choice from
 *   150 to 300 - on alignment confidence, on overlap, on time, and on false
 *   "changes" at stroke edges, which at 300 dpi reached 0.18% of the page on a
 *   93 dpi scan and were zero at matched dpi. Oversampling the original makes
 *   the two disagree at every edge, and that disagreement is exactly what a
 *   diff reports as a change.
 */
export type DpiChoice = number | 'native' | 'match'

export interface DpiLimits {
  /** Resolution for a page that is not a scan and so has no native dpi. */
  fallbackDpi: number
  /** Bounds on a *native* resolution, which comes from the file and may be absurd. */
  minDpi:      number
  maxDpi:      number
}

export const DEFAULT_DPI_LIMITS: Readonly<DpiLimits> = { fallbackDpi: 200, minDpi: 72, maxDpi: 400 }

/** A page's own resolution: its scan's, clamped, or the fallback when it is not a scan. */
export function nativeDpi (metadata: PageMetadata, limits: DpiLimits): number {
  if (metadata.effectiveDpi === null) return limits.fallbackDpi

  return clamp(metadata.effectiveDpi, limits)
}

/** Resolution for a page of a single document. `'match'` has nothing to match, so it means `'native'`. */
export function pageDpi (metadata: PageMetadata, choice: DpiChoice, limits: DpiLimits): number {
  return typeof choice === 'number' ? checked(choice) : nativeDpi(metadata, limits)
}

/** Resolutions for both sides of a page pair. */
export function pairDpi (
  original: PageMetadata,
  scanned: PageMetadata,
  choice: DpiChoice,
  limits: DpiLimits,
): { original: number, scanned: number } {
  if (typeof choice === 'number') return { original: checked(choice), scanned: checked(choice) }
  if (choice === 'native') return { original: nativeDpi(original, limits), scanned: nativeDpi(scanned, limits) }

  const scan = nativeDpi(scanned, limits)
  if (scanned.effectiveDpi === null) return { original: scan, scanned: scan }

  return { original: clamp(scanned.effectiveDpi * onPaper(original, scanned), limits), scanned: scan }
}

/**
 * How many of the original's pages fit across the scanned page, long side to long
 * side and short to short, whichever fits first - `1` for a scan stored at its
 * paper's size, whatever the orientation.
 */
function onPaper (original: PageMetadata, scanned: PageMetadata): number {
  const [originalLong, originalShort] = sides(original)
  const [scannedLong, scannedShort] = sides(scanned)
  const ratio = Math.min(scannedLong / originalLong, scannedShort / originalShort)

  // Paper sizes differ by a few percent - A4 against Letter - and that is not a different resolution.
  return Math.abs(ratio - 1) < 0.1 ? 1 : ratio
}

function sides (page: PageMetadata): [number, number] {
  return [Math.max(page.pointWidth, page.pointHeight), Math.min(page.pointWidth, page.pointHeight)]
}

function clamp (dpi: number, limits: DpiLimits): number {
  return Math.min(limits.maxDpi, Math.max(limits.minDpi, dpi))
}

function checked (dpi: number): number {
  if (!Number.isFinite(dpi) || dpi <= 0) throw new RangeError(`dpi must be a positive number, got ${dpi}`)

  return dpi
}
