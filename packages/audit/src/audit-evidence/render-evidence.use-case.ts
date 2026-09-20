import { composePanels, EXPECTED_MARGIN, IDENTIFIED, MISSING, NOT_IDENTIFIED, OVERLAY_DIFFERENT, REFERENCE, UNEXPECTED } from '@scanmate/diff'
import type { Annotation, ExpectedResult, Panel, Rgba } from '@scanmate/diff'
import type { ContentResult } from '@scanmate/find'
import { createRaster, drawLabel, labelSize } from '@scanmate/ink'
import type { Raster, Rect } from '@scanmate/ink'

import type { AuditFinding, FindingKind } from '../finding-correlation'

/**
 * The page a reviewer looks at: the original, the aligned scan, and the overlay
 * of the two, side by side with the same places boxed on each.
 *
 * The three panels answer three different questions, and a reviewer needs all
 * three. The original says **where** the question is. The scan says **what** the
 * answer is, in the colour of that answer. The overlay says **why**: violet
 * where the ink of the two differs, grey where they agree - which is how a
 * reader can see for themselves that the words under a red box are the same
 * words, printed identically, and only read differently.
 *
 * The overlay carries no verdicts of its own. It is the pixel comparison and
 * nothing else - what passed and what failed is the middle panel's job, and
 * repeating it here would make the one independent piece of evidence on the
 * page look like a restatement of the other two.
 *
 * | colour | on the original | on the scan |
 * |---|---|---|
 * | blue | every place being asked about | required content that reads correctly |
 * | green | | a field that was filled in |
 * | red | | a field left empty or covered, content or a figure that changed |
 * | pink | | the band where ink still counts as a field's |
 * | orange | | ink added where nothing was expected |
 * | cyan | printed ink the scan lost | the same place, where it is not |
 */

export const TEXT_DIFFERENCE: Rgba = NOT_IDENTIFIED

const COLOURS: Readonly<Record<FindingKind, Rgba>> = {
  'unexpected-mark':          UNEXPECTED,
  'missing-ink':              MISSING,
  'text-changed':             NOT_IDENTIFIED,
  'text-missing':             NOT_IDENTIFIED,
  'text-added':               NOT_IDENTIFIED,
  'expected-empty':           NOT_IDENTIFIED,
  'expected-overfilled':      NOT_IDENTIFIED,
  'content-missing':          NOT_IDENTIFIED,
  'content-not-identifiable': NOT_IDENTIFIED,
}

/** The legend, in the order it reads. */
const LEGEND: ReadonlyArray<readonly [Rgba, string]> = [
  [REFERENCE, 'checked'],
  [IDENTIFIED, 'filled in'],
  [NOT_IDENTIFIED, 'empty or changed'],
  [EXPECTED_MARGIN, 'room to sign'],
  [UNEXPECTED, 'unexpected ink'],
  [MISSING, 'print lost'],
]

export interface EvidenceOptions {
  /** What the original was rendered at. */
  dpi:             number
  /** The regions the pixel comparison was asked about. */
  expected?:       readonly ExpectedResult[]
  /** What the audit found. */
  findings?:       readonly AuditFinding[]
  /** Required content checked on this page. */
  content?:        readonly ContentResult[]
  /** The pixel overlay, drawn as a third panel when given. */
  overlay?:        Raster | null
  /** How far outside a region its ink still counts, in points. Default `6`. */
  expectedMargin?: number
  /** Draw the legend along the foot. Default `true`. */
  legend?:         boolean
}

export function renderEvidence (original: Raster, aligned: Raster, options: EvidenceOptions): Raster {
  const { dpi, expected = [], findings = [], content = [], overlay = null, expectedMargin = 6, legend = true } = options
  const toPixels = dpi / 72
  const line = Math.max(2, Math.round(dpi / 72))
  const box = (rect: Rect, by = 2): Rect => grow(scale(rect, toPixels), by)

  // The original: every place being asked about, in one colour. Where, not what.
  const asked: Annotation[] = [
    ...expected.map(region => ({ rect: box(region), color: REFERENCE })),
    ...content.flatMap(result => places(result).map(rect => ({ rect: box(rect, 3), color: REFERENCE }))),
    ...boxed(findings).map(([, rect]) => ({ rect: box(rect, 4), color: REFERENCE })),
  ]

  // The scan: the answers, each in the colour of that answer.
  const answers: Annotation[] = [
    ...(expectedMargin > 0 ? expected.map(region => ({ rect: scale(grow(region, expectedMargin), toPixels), color: EXPECTED_MARGIN })) : []),
    ...expected.map(region => ({ rect: box(region), color: region.identified ? IDENTIFIED : NOT_IDENTIFIED })),
    ...content.filter(result => result.identifiable).flatMap(result => places(result).map(rect => ({ rect: box(rect, 3), color: REFERENCE }))),
  ]
  const thick: Annotation[] = []
  for (const finding of findings) {
    if (finding.box === null) continue
    const annotation = { rect: box(finding.box, 4), color: COLOURS[finding.kind] }
    if (finding.corroborated) thick.push(annotation)
    else answers.push(annotation)
  }

  const gutter = Math.max(4, Math.round(dpi / 12))
  const panels: Panel[] = [
    { raster: original, annotations: asked },
    { raster: aligned, annotations: [...answers, ...thick, ...thick] },
    ...(overlay === null ? [] : [{ raster: overlay }]),
  ]
  const page = composePanels(panels, line, gutter)
  // Corroborated findings again, twice as thick: the reviewer's eye goes there first.
  if (thick.length > 0) {
    const offset = original.width + gutter
    composePanelsThick(page, thick, offset, line * 2)
  }

  return legend ? withLegend(page, line, Boolean(overlay)) : page
}

/** The findings that have a place on the page, each with it. */
function boxed (findings: readonly AuditFinding[]): Array<[AuditFinding, Rect]> {
  return findings.flatMap(finding => (finding.box === null ? [] : [[finding, finding.box] as [AuditFinding, Rect]]))
}

/** Where the original prints one piece of required content, or where it should be. */
function places (result: ContentResult): Rect[] {
  const boxes = result.occurrences.map(occurrence => occurrence.box).filter((rect): rect is Rect => rect !== null)

  return boxes.length > 0 ? boxes : (result.box === null ? [] : [result.box])
}

/** Redraws the corroborated findings on the scan's panel, thicker. */
function composePanelsThick (page: Raster, thick: readonly Annotation[], offset: number, thickness: number): void {
  for (const annotation of thick) {
    const rect = { ...annotation.rect, x: annotation.rect.x + offset }
    for (const side of [
      { x: rect.x, y: rect.y, width: rect.width, height: thickness },
      { x: rect.x, y: rect.y + rect.height - thickness, width: rect.width, height: thickness },
      { x: rect.x, y: rect.y, width: thickness, height: rect.height },
      { x: rect.x + rect.width - thickness, y: rect.y, width: thickness, height: rect.height },
    ]) fill(page, side, annotation.color)
  }
}

/** The page with a legend along the foot, so the colours need no caption. */
function withLegend (page: Raster, line: number, hasOverlay: boolean): Raster {
  const scaleUp = Math.max(2, Math.round(line * 1.5))
  const text = labelSize('X', { scale: scaleUp })
  const swatch = text.height
  const padding = Math.round(text.height * 0.8)
  const height = text.height + padding * 2
  const strip = createRaster(page.width, page.height + height)

  strip.data.set(page.data, 0)
  for (let i = page.data.length; i < strip.data.length; i += 4) strip.data.set([255, 255, 255, 255], i)

  let x = padding
  const y = page.height + padding
  for (const [colour, label] of LEGEND) {
    fill(strip, { x, y, width: swatch, height: swatch }, colour)
    x += swatch + Math.round(padding / 2)
    drawLabel(strip, label, { x, y }, { scale: scaleUp, color: [40, 40, 40, 255] })
    x += labelSize(label, { scale: scaleUp }).width + padding
  }
  if (hasOverlay) {
    fill(strip, { x, y, width: swatch, height: swatch }, OVERLAY_DIFFERENT)
    x += swatch + Math.round(padding / 2)
    drawLabel(strip, 'overlay: ink that differs, grey unchanged', { x, y }, { scale: scaleUp, color: [90, 90, 90, 255] })
  }

  return strip
}

function fill (raster: Raster, rect: Rect, colour: Rgba): void {
  const left = Math.max(0, Math.round(rect.x))
  const top = Math.max(0, Math.round(rect.y))
  const right = Math.min(raster.width, Math.round(rect.x + rect.width))
  const bottom = Math.min(raster.height, Math.round(rect.y + rect.height))
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) raster.data.set(colour, (y * raster.width + x) * 4)
}

function scale (r: Rect, by: number): Rect {
  return { x: r.x * by, y: r.y * by, width: r.width * by, height: r.height * by }
}

function grow (r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by }
}
