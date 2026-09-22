import type { BinaryImage, ScanmateRect } from '@scanmate/ink'

import { labelComponents } from './connected-components.use-case'
import type { Component } from './connected-components.use-case'
import { mergeBoxes } from './merge-boxes.use-case'

/**
 * The shape of the new ink inside one expected region.
 *
 * "Was ink added here" is one number; whether that ink is a filled-in field is
 * a question about its shape. A signature is a few strokes somewhere inside the
 * box. A field someone blacked out is ink across most of it. A sliver along one
 * border, spanning the whole box and a hair thick, is the field's own printed
 * rule that the alignment left a pixel or two out of place - no one wrote it.
 * So the region is analysed on its own: its new ink labelled, form-rule slivers
 * discarded, the rest grouped the way page-level changes are, and measured.
 *
 * Everything here is in pixels of the region; the caller converts.
 */

export interface RegionInkOptions {
  /** Pixels within which pieces of ink are one change. */
  mergeGap:           number
  /** Smallest change, in pixels, that counts. */
  minChangePixels:    number
  /** A piece spanning at least this share of the region's width (or height) may be a form rule. */
  lineSpan:           number
  /** ...if it is also no thicker than this many pixels, */
  lineThickness:      number
  /** ...or than this share of the region's other side, whichever is more. */
  lineThicknessRatio: number
  /** Width of the border band, as a share of the region's shorter side (at least one pixel). */
  edgeBand:           number
}

export interface RegionInk {
  /** New-ink pixels in the changes that count. */
  pixels:    number
  /** Changes that count, after grouping. */
  changes:   number
  /** Pixels in the largest one. */
  largest:   number
  /** Box around every change that counts, in page pixels; `null` when there is none. */
  bounds:    ScanmateRect | null
  /** Share of those pixels that lie in the band along the region's border. */
  edgeTouch: number
  /** Share of the region's area that is counted new ink. */
  fill:      number
  /** Form-rule slivers discarded. */
  formLines: number
}

const NONE: Omit<RegionInk, 'formLines'> = { pixels: 0, changes: 0, largest: 0, bounds: null, edgeTouch: 0, fill: 0 }

/** Analyse `added` (the page's new-ink mask) inside `rect` (page pixels). */
export function measureRegionInk (added: BinaryImage, rect: ScanmateRect, options: RegionInkOptions): RegionInk {
  const left = Math.max(0, Math.floor(rect.x))
  const top = Math.max(0, Math.floor(rect.y))
  const right = Math.min(added.width, Math.ceil(rect.x + rect.width))
  const bottom = Math.min(added.height, Math.ceil(rect.y + rect.height))
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return { ...NONE, formLines: 0 }

  const crop = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    crop.set(added.data.subarray((top + y) * added.width + left, (top + y) * added.width + right), y * width)

  const { components, labels } = labelComponents({ width, height, data: crop })
  const isRule = (c: Component): boolean => {
    const horizontal = c.width >= options.lineSpan * width &&
      c.height <= Math.max(options.lineThickness, options.lineThicknessRatio * height)
    const vertical = c.height >= options.lineSpan * height &&
      c.width <= Math.max(options.lineThickness, options.lineThicknessRatio * width)

    return horizontal || vertical
  }

  const pieces = components.filter(c => c.pixels >= 2)
  const rules = pieces.filter(c => isRule(c))
  const kept = pieces.filter(c => !isRule(c))
  const changes = mergeBoxes(kept, options.mergeGap).filter(box => box.pixels >= options.minChangePixels)
  if (changes.length === 0) return { ...NONE, formLines: rules.length }

  // A kept piece belongs to the change whose box holds it: a change's box is the
  // union of its pieces, and any piece inside it would have been merged into it.
  const counts = new Uint8Array(components.length)
  for (const [i, c] of components.entries()) {
    if (c.pixels < 2 || isRule(c)) continue
    counts[i] = changes.some(box => c.x >= box.x && c.y >= box.y && c.x + c.width <= box.x + box.width && c.y + c.height <= box.y + box.height) ? 1 : 0
  }

  const band = Math.max(1, Math.round(Math.min(width, height) * options.edgeBand))
  let pixels = 0
  let edge = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const label = labels[y * width + x]
      if (label === 0 || counts[label - 1] === 0) continue
      pixels++
      if (x < band || y < band || x >= width - band || y >= height - band) edge++
    }

  const minX = Math.min(...changes.map(b => b.x))
  const minY = Math.min(...changes.map(b => b.y))
  const maxX = Math.max(...changes.map(b => b.x + b.width))
  const maxY = Math.max(...changes.map(b => b.y + b.height))

  return {
    pixels,
    changes:   changes.length,
    largest:   Math.max(...changes.map(b => b.pixels)),
    bounds:    { x: left + minX, y: top + minY, width: maxX - minX, height: maxY - minY },
    edgeTouch: pixels > 0 ? edge / pixels : 0,
    fill:      pixels / (width * height),
    formLines: rules.length,
  }
}
