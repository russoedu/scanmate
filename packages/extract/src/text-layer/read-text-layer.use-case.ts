import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfTextRun } from '@scanmate/ink'

/**
 * A page's text layer: the plain text, and every run of it with its position.
 *
 * pdf.js gives each run's transform in unrotated user space, baseline at the
 * origin. Composing it with the scale-1 viewport - which is what flips the page
 * to a top-left origin and applies `/Rotate` - puts the run on the page as it is
 * displayed and rendered. The box then spans the font's ascent above the
 * baseline and its descent below, from the metrics pdf.js reports per font;
 * a font without them is taken to span 0.8 em up and 0.2 em down.
 */

type Transform = [number, number, number, number, number, number]

const DEFAULT_ASCENT = 0.8
const DEFAULT_DESCENT = -0.2

export interface TextLayer {
  /** Runs joined, with line ends as newlines and the whole trimmed. Empty when there is no text. */
  text:  string
  items: PdfTextRun[]
}

export async function readTextLayer (page: PDFPageProxy): Promise<TextLayer> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const styles = content.styles as Record<string, { ascent?: number, descent?: number } | undefined>

  let text = ''
  const items: PdfTextRun[] = []

  for (const item of content.items) {
    if (!('str' in item)) continue
    text += item.str
    if (item.hasEOL) text += '\n'
    if (item.str.trim() === '') continue

    const placed = compose(viewport.transform as Transform, item.transform as Transform)
    const fontSize = Math.hypot(placed[2], placed[3])
    // The baseline direction, and "up" from it: the transform's second column,
    // which the viewport's flip has already turned to point up the screen.
    const along = unit(placed[0], placed[1])
    const up = unit(placed[2], placed[3])
    const style = styles[item.fontName]
    const ascent = (style?.ascent ?? DEFAULT_ASCENT) * fontSize
    const descent = (style?.descent ?? DEFAULT_DESCENT) * fontSize
    const origin = { x: placed[4], y: placed[5] }

    const corners = [
      point(origin, along, up, 0, ascent),
      point(origin, along, up, item.width, ascent),
      point(origin, along, up, 0, descent),
      point(origin, along, up, item.width, descent),
    ]
    const xs = corners.map(c => c.x)
    const ys = corners.map(c => c.y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)

    items.push({
      text:     item.str,
      x:        left,
      y:        top,
      width:    Math.max(...xs) - left,
      height:   Math.max(...ys) - top,
      baseline: origin,
      fontSize,
      fontName: item.fontName,
      angle:    Math.atan2(along.y, along.x) * 180 / Math.PI,
      endsLine: item.hasEOL,
    })
  }

  return { text: text.trim(), items }
}

function point (origin: Vector, along: Vector, up: Vector, distance: number, height: number): Vector {
  return { x: origin.x + along.x * distance + up.x * height, y: origin.y + along.y * distance + up.y * height }
}

interface Vector { x: number, y: number }

function unit (x: number, y: number): Vector {
  const length = Math.hypot(x, y) || 1

  return { x: x / length, y: y / length }
}

function compose (m: Transform, n: Transform): Transform {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}
