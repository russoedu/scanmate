import { annotateOverlay, composeSideBySide, EXPECTED_MARGIN, IDENTIFIED, MISSING, NOT_IDENTIFIED, UNEXPECTED } from '@scanmate/diff'
import type { Annotation, ExpectedResult, Rgba } from '@scanmate/diff'
import type { Raster, Rect } from '@scanmate/ink'

import type { AuditFinding, FindingKind } from '../finding-correlation'

/**
 * The page a reviewer looks at: the original and the aligned scan side by
 * side, with the audit's verdict drawn on both halves in the same places.
 *
 * - green: an expected region that was filled in;
 * - orange: the band around it where ink still counts as that region's;
 * - amber: an expected region left empty, or blacked out;
 * - magenta: ink added where nothing was expected;
 * - blue: printed ink the scan lost;
 * - red: text that reads differently from the original, or required content
 *   that is not where it should be.
 *
 * Findings seen by both comparisons are drawn twice as thick: the reviewer's
 * eye goes to them first.
 */

export const TEXT_DIFFERENCE: Rgba = [220, 30, 45, 255]

const COLOURS: Readonly<Record<FindingKind, Rgba>> = {
  'unexpected-mark':          UNEXPECTED,
  'missing-ink':              MISSING,
  'text-changed':             TEXT_DIFFERENCE,
  'text-missing':             TEXT_DIFFERENCE,
  'text-added':               TEXT_DIFFERENCE,
  'expected-empty':           NOT_IDENTIFIED,
  'expected-overfilled':      NOT_IDENTIFIED,
  'content-missing':          TEXT_DIFFERENCE,
  'content-not-identifiable': TEXT_DIFFERENCE,
}

export function renderEvidence (
  original: Raster,
  aligned: Raster,
  dpi: number,
  expected: readonly ExpectedResult[],
  findings: readonly AuditFinding[],
  expectedMargin = 6,
): Raster {
  const toPixels = dpi / 72
  const line = Math.max(2, Math.round(dpi / 72))
  const drawn: Annotation[] = [
    // How far outside each region its ink still counts, drawn under the region itself.
    ...(expectedMargin > 0 ? expected.map(region => ({ rect: scale(grow(region, expectedMargin), toPixels), color: EXPECTED_MARGIN })) : []),
    ...expected
      .filter(region => region.identified)
      .map(region => ({ rect: grow(scale(region, toPixels), 2), color: IDENTIFIED })),
  ]

  const thin: Annotation[] = []
  const thick: Annotation[] = []
  for (const finding of findings) {
    if (finding.box === null) continue
    const annotation = { rect: grow(scale(finding.box, toPixels), 4), color: COLOURS[finding.kind] }
    if (finding.corroborated) thick.push(annotation)
    else thin.push(annotation)
  }

  const gutter = Math.max(4, Math.round(dpi / 12))
  const page = composeSideBySide(original, aligned, [...drawn, ...thin], line, gutter)

  // Corroborated findings, twice as thick, at the same place on both halves.
  const offset = original.width + gutter
  annotateOverlay(page, [...thick, ...thick.map(a => ({ ...a, rect: { ...a.rect, x: a.rect.x + offset } }))], line * 2)

  return page
}

function scale (r: Rect, by: number): Rect {
  return { x: r.x * by, y: r.y * by, width: r.width * by, height: r.height * by }
}

function grow (r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by }
}
