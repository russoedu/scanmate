import { StandardFonts, degrees, rgb } from '@cantoo/pdf-lib'
import type { PDFFont, PDFPage } from '@cantoo/pdf-lib'
import { growBy, hasBleed, resolveBleed } from '@scanmate/ink'
import type { ScanmateBinarySource, ScanmateRect } from '@scanmate/ink'

import { openPdf, readSource } from '../source-reading'
import { toUserSpace, viewportSize, viewportTransform } from './page-viewport.mapper'
import type { PageGeometry } from './page-viewport.mapper'
import type { MarkOptions, MarkResult, PageMark } from './page-mark.contract'

/**
 * The colours of the audit's evidence page, so the two read the same way: the
 * region in blue, its bleed in magenta.
 */
const REGION = rgb(0, 23 / 255, 252 / 255)
const BLEED = rgb(245 / 255, 0, 252 / 255)
const LABEL_SIZE = 7

/**
 * Draws each mark on the original, with its bleed around it, and hands the PDF
 * back - a way to see whether the positions a validation will use are where
 * the fields actually are, before anything is measured with them.
 *
 * Drawn on the document itself, as vectors: the page is not re-rendered, so it
 * stays sharp at any zoom and the boxes sit exactly where their coordinates
 * say. Nothing is aligned or adjusted, because there is nothing to align - this
 * is the original, and the marks were measured against it.
 */
export async function markPages (pdf: ScanmateBinarySource, marks: readonly PageMark[], options: MarkOptions = {}): Promise<MarkResult> {
  const source = await readSource(pdf, 0)
  if (source.kind !== 'pdf') throw new TypeError('marks are drawn on a PDF, and this is not one')

  // Decrypted if encrypted, as a signed document usually is - see `openPdf` for
  // why that and not `ignoreEncryption`, which would silently drop every mark.
  const document = await openPdf(source.bytes, { password: options.password })
  const font = options.labels === false ? null : await document.embedFont(StandardFonts.Helvetica)
  const bleed = resolveBleed(options)
  const pages = document.getPages()
  const warnings: string[] = []
  let drawn = 0

  for (const mark of marks) {
    const name = mark.id ?? `mark ${drawn + warnings.length + 1}`
    const page = pages[mark.page - 1]
    if (page === undefined) {
      warnings.push(`${name} is on page ${mark.page}, and the document has ${pages.length}`)
      continue
    }

    const geometry = geometryOf(page)
    const size = viewportSize(geometry)
    if (mark.x < 0 || mark.y < 0 || mark.x + mark.width > size.width || mark.y + mark.height > size.height)
      warnings.push(`${name} reaches past the edge of page ${mark.page}, which is ${round(size.width)} x ${round(size.height)} pt`)

    // The band first, so the region's own outline draws over it where they meet.
    if (hasBleed(bleed)) draw(page, geometry, growBy(mark, bleed), { colour: BLEED, dashed: true })
    draw(page, geometry, mark, { colour: REGION, dashed: false })
    if (font !== null && mark.id !== undefined) label(page, geometry, font, mark)
    drawn++
  }

  return { pdf: await document.save(), drawn, warnings }
}

/** The page's visible box and rotation, as pdf.js would read them. */
function geometryOf (page: PDFPage): PageGeometry {
  const crop = page.getCropBox()

  return { view: [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height], rotation: page.getRotation().angle }
}

/**
 * A rectangle measured as displayed, drawn in the PDF's own coordinates.
 *
 * A quarter turn keeps a rectangle a rectangle, so its corners are taken back
 * to user space and their extent is the box to draw.
 */
function draw (page: PDFPage, geometry: PageGeometry, rect: ScanmateRect, style: { colour: ReturnType<typeof rgb>, dashed: boolean }): void {
  const { x, y, width, height } = userBox(geometry, rect)
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor:     style.colour,
    borderWidth:     style.dashed ? 0.6 : 0.9,
    borderDashArray: style.dashed ? [2.5, 1.5] : undefined,
    opacity:         0,
    borderOpacity:   1,
  })
}

/**
 * The id inside the box's top-left corner, upright to the reader however the
 * page is turned.
 *
 * Inside rather than above: on the original a field is empty, so the corner is
 * free, while the space above it is usually the printed line before - and a
 * label written over that would obscure the very edge being checked.
 */
function label (page: PDFPage, geometry: PageGeometry, font: PDFFont, mark: PageMark): void {
  const at = toUserSpace(viewportTransform(geometry), mark.x + 2, mark.y + LABEL_SIZE)
  page.drawText(mark.id ?? '', {
    x:      at.x,
    y:      at.y,
    size:   LABEL_SIZE,
    font,
    color:  REGION,
    // Text is laid in user space; turning it with the page keeps it readable.
    rotate: degrees(geometry.rotation),
  })
}

function userBox (geometry: PageGeometry, rect: ScanmateRect): ScanmateRect {
  const transform = viewportTransform(geometry)
  const corners = [
    toUserSpace(transform, rect.x, rect.y),
    toUserSpace(transform, rect.x + rect.width, rect.y + rect.height),
  ]
  const xs = corners.map(corner => corner.x)
  const ys = corners.map(corner => corner.y)

  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.abs(xs[1] - xs[0]), height: Math.abs(ys[1] - ys[0]) }
}

function round (value: number): number {
  return Math.round(value * 10) / 10
}
