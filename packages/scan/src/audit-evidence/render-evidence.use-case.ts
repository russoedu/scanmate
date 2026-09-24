import { composePanels, EXPECTED_MARGIN, IDENTIFIED, MISSING, NOT_IDENTIFIED, REFERENCE, UNEXPECTED, UNSETTLED } from '../change-detection'
import { OVERLAY_DIFFERENT } from '../region-comparison'
import type { Annotation, ExpectedResult, Panel, Rgba } from '../change-detection'
import type { ContentResult } from '../content-search'
import { createRaster, drawLabel, growBy, hasBleed, labelSize, resolveBleed, resolveRegionBleed } from '@scanmate/ink'
import type { Bleed, Raster, ScanmateRect } from '@scanmate/ink'

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
 * | red | | a field left empty or covered, a box ticked wrongly, content or a figure that changed |
 * | pink | | the band where ink still counts as a field's |
 * | orange | | ink added where nothing was expected |
 * | cyan | printed ink the scan lost | the same place, where it is not |
 * | olive | | read differently, ink identical, nothing could settle it |
 */

export const TEXT_DIFFERENCE: Rgba = NOT_IDENTIFIED

const COLOURS: Readonly<Record<FindingKind, Rgba>> = {
  'unexpected-mark':     UNEXPECTED,
  'missing-ink':         MISSING,
  'text-changed':        NOT_IDENTIFIED,
  'text-unsettled':      UNSETTLED,
  'text-missing':        NOT_IDENTIFIED,
  'text-added':          NOT_IDENTIFIED,
  'expected-empty':      NOT_IDENTIFIED,
  'expected-overfilled': NOT_IDENTIFIED,
  'checkbox-mismatch':   NOT_IDENTIFIED,
  'checkbox-struck':     NOT_IDENTIFIED,
  'checkbox-cleared':    NOT_IDENTIFIED,
  'checkbox-group':      NOT_IDENTIFIED,
}

/** The legend, in the order it reads. */
const LEGEND: ReadonlyArray<readonly [Rgba, string]> = [
  [REFERENCE, 'checked'],
  [IDENTIFIED, 'filled in'],
  [NOT_IDENTIFIED, 'empty or changed'],
  [EXPECTED_MARGIN, 'room to sign'],
  [UNEXPECTED, 'unexpected ink'],
  [MISSING, 'print lost'],
  [UNSETTLED, 'unsettled'],
]

/**
 * What the evidence page draws. The bleed fields - `bleed`, and a side to
 * override it - are the room drawn around each expected region, and must be the
 * same bleed the comparison measured with, or the band on the page is not the
 * band that was checked. A region carrying its own bleed is drawn with that,
 * as the comparison claimed it.
 */
export interface EvidenceOptions extends Bleed {
  /** What the original was rendered at. */
  dpi:       number
  /** The regions the pixel comparison was asked about. */
  expected?: readonly ExpectedResult[]
  /** What the audit found. */
  findings?: readonly AuditFinding[]
  /** Required content checked on this page. */
  content?:  readonly ContentResult[]
  /** The pixel overlay, drawn as a third panel when given. */
  overlay?:  Raster | null
  /** Draw the legend along the foot. Default `true`. */
  legend?:   boolean
}

export function renderEvidence (original: Raster, aligned: Raster, options: EvidenceOptions): Raster {
  const { dpi, expected = [], findings = [], content = [], overlay = null, legend = true } = options
  const bleed = resolveBleed(options)
  const toPixels = dpi / 72
  const line = Math.max(2, Math.round(dpi / 72))
  const box = (rect: ScanmateRect, by = 2): ScanmateRect => grow(scale(rect, toPixels), by)

  // The original: every place being asked about, in one colour. Where, not what.
  const asked: Annotation[] = [
    ...expected.map(region => ({ rect: box(region), color: REFERENCE })),
    ...content.flatMap(result => places(result).map(rect => ({ rect: box(rect, 3), color: REFERENCE }))),
    ...boxed(findings).map(([, rect]) => ({ rect: box(rect, 4), color: REFERENCE })),
  ]

  // The scan: the answers, each in the colour of that answer.
  const answers: Annotation[] = [
    ...expected.flatMap(region => {
      const room = resolveRegionBleed(region, bleed)

      return hasBleed(room) ? [{ rect: scale(growBy(region, room), toPixels), color: EXPECTED_MARGIN }] : []
    }),
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

  const titled = withTitles(page, panels, line, gutter)

  return legend ? withLegend(titled, line, Boolean(overlay)) : titled
}

/** What each panel is, in the order they are composed. */
const PANEL_NAMES = ['original', 'scanned', 'overlay'] as const

/**
 * A caption over each panel, because three near-identical pages side by side do
 * not say which is which - and the one that matters most, the overlay, is the
 * one a reader is least likely to guess.
 */
function withTitles (page: Raster, panels: readonly Panel[], line: number, gutter: number): Raster {
  const wanted = Math.max(2, Math.round(line * 1.5))
  const narrowest = Math.min(...panels.map(panel => panel.raster.width))
  // The caption belongs to its panel, so it is sized to the panel rather than
  // to the page: three columns of a wide page are each still only a page wide.
  let scale = wanted
  while (scale > 1 && labelSize(PANEL_NAMES[2], { scale }).width > narrowest) scale--

  const text = labelSize('X', { scale })
  const padding = Math.round(text.height * 0.8)
  const band = text.height + padding * 2
  const out = createRaster(page.width, page.height + band)
  for (let i = 0; i < out.data.length; i += 4) out.data.set([255, 255, 255, 255], i)
  out.data.set(page.data, band * page.width * 4)

  let x = 0
  for (const [index, panel] of panels.entries()) {
    const name = PANEL_NAMES[index]
    if (name !== undefined) drawLabel(out, name, { x: x + padding, y: padding }, { scale, color: [40, 40, 40, 255] })
    x += panel.raster.width + gutter
  }

  return out
}

/** The findings that have a place on the page, each with it. */
function boxed (findings: readonly AuditFinding[]): Array<[AuditFinding, ScanmateRect]> {
  return findings.flatMap(finding => (finding.box === null ? [] : [[finding, finding.box] as [AuditFinding, ScanmateRect]]))
}

/** Where the original prints one piece of required content, or where it should be. */
function places (result: ContentResult): ScanmateRect[] {
  const boxes = result.occurrences.map(occurrence => occurrence.box).filter((rect): rect is ScanmateRect => rect !== null)

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

/** How the legend is laid out at one size: what each entry costs, and where it lands. */
interface LegendPlan {
  scale:   number
  swatch:  number
  padding: number
  rows:    Array<Array<{ colour: Rgba, label: string, muted: boolean }>>
}

/**
 * The legend has to fit the page it explains.
 *
 * The size used to follow the annotation stroke alone, which is a property of
 * the page's resolution and says nothing about how wide the page is. On a
 * narrower page - a single portrait panel rather than three side by side - the
 * row ran past the right edge and the last entries were simply cut off, which
 * on the overlay panel meant losing the entry that explains the overlay.
 *
 * So the stroke sets what is wanted and the width decides what is possible: the
 * largest size that fits on one row is used, and if even the smallest does not
 * fit, the entries wrap rather than disappear.
 */
function planLegend (page: Raster, line: number, hasOverlay: boolean): LegendPlan {
  const entries = LEGEND.map(([colour, label]) => ({ colour, label, muted: false }))
  if (hasOverlay) entries.push({ colour: OVERLAY_DIFFERENT, label: 'overlay: ink that differs, grey unchanged', muted: true })

  const wanted = Math.max(2, Math.round(line * 1.5))
  for (let scale = wanted; scale > 1; scale--) {
    const plan = pack(entries, page.width, scale)
    if (plan.rows.length === 1) return plan
  }

  // Nothing fits on one row: wrap at the smallest size rather than lose entries.
  return pack(entries, page.width, 1)
}

/** Entries laid into as few rows as the width allows, in the order they read. */
function pack (entries: ReadonlyArray<{ colour: Rgba, label: string, muted: boolean }>, width: number, scale: number): LegendPlan {
  const text = labelSize('X', { scale })
  const swatch = text.height
  const padding = Math.round(text.height * 0.8)
  const rows: LegendPlan['rows'] = []
  let row: LegendPlan['rows'][number] = []
  let x = padding

  for (const entry of entries) {
    const cost = swatch + Math.round(padding / 2) + labelSize(entry.label, { scale }).width + padding
    if (x + cost > width && row.length > 0) {
      rows.push(row)
      row = []
      x = padding
    }
    row.push(entry)
    x += cost
  }
  rows.push(row)

  return { scale, swatch, padding, rows }
}

/** The page with a legend along the foot, so the colours need no caption. */
function withLegend (page: Raster, line: number, hasOverlay: boolean): Raster {
  const { scale: legendScale, swatch, padding, rows } = planLegend(page, line, hasOverlay)
  const text = labelSize('X', { scale: legendScale })
  const step = text.height + Math.round(padding / 2)
  const height = rows.length * step - Math.round(padding / 2) + padding * 2
  const strip = createRaster(page.width, page.height + height)

  strip.data.set(page.data, 0)
  for (let i = page.data.length; i < strip.data.length; i += 4) strip.data.set([255, 255, 255, 255], i)

  for (const [index, row] of rows.entries()) {
    let x = padding
    const y = page.height + padding + index * step
    for (const entry of row) {
      fill(strip, { x, y, width: swatch, height: swatch }, entry.colour)
      x += swatch + Math.round(padding / 2)
      drawLabel(strip, entry.label, { x, y }, { scale: legendScale, color: entry.muted ? [90, 90, 90, 255] : [40, 40, 40, 255] })
      x += labelSize(entry.label, { scale: legendScale }).width + padding
    }
  }

  return strip
}

function fill (raster: Raster, rect: ScanmateRect, colour: Rgba): void {
  const left = Math.max(0, Math.round(rect.x))
  const top = Math.max(0, Math.round(rect.y))
  const right = Math.min(raster.width, Math.round(rect.x + rect.width))
  const bottom = Math.min(raster.height, Math.round(rect.y + rect.height))
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) raster.data.set(colour, (y * raster.width + x) * 4)
}

function scale (r: ScanmateRect, by: number): ScanmateRect {
  return { x: r.x * by, y: r.y * by, width: r.width * by, height: r.height * by }
}

function grow (r: ScanmateRect, by: number): ScanmateRect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by }
}
