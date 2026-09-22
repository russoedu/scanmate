import type { BinaryImage } from '@scanmate/ink'

/**
 * Connected-component labelling: which set pixels of a mask touch, and the box
 * around each group.
 *
 * The overlay says *which pixels* changed; a caller asking "was anything added
 * outside the boxes I expected" needs *regions*, so the pixels have to be grouped.
 * No maintained package does this for a flat mask, and it is small enough that
 * a dependency would cost more than it saves.
 *
 * Classic two-pass labelling with union-find. The first pass gives each set pixel
 * the smallest label among its already-visited neighbours and records that any
 * other neighbouring labels are the same component; the second resolves each
 * label to its root and accumulates the box and pixel count, so a third pass is
 * never needed. Union by size and path halving keep the forest flat.
 */

export interface Component {
  /** Bounding box, in pixels, inclusive of every pixel in the component. */
  x:      number
  y:      number
  width:  number
  height: number
  /** Set pixels in the component. */
  pixels: number
}

export interface LabelOptions {
  /**
   * `8` (the default) joins diagonal neighbours, so a handwritten stroke at an
   * angle stays one component instead of shattering into a staircase of pieces.
   */
  connectivity?: 4 | 8
}

export function connectedComponents (mask: BinaryImage, options: LabelOptions = {}): Component[] {
  return labelComponents(mask, options).components
}

export interface LabelledComponents {
  components: Component[]
  /**
   * Per pixel, one plus the index of its component in `components`; `0` where
   * the mask is clear. What a caller needs to ask which pixels a component owns.
   */
  labels:     Int32Array
}

/** {@link connectedComponents}, keeping the label image the second pass resolves anyway. */
export function labelComponents (mask: BinaryImage, options: LabelOptions = {}): LabelledComponents {
  const { connectivity = 8 } = options
  const { width, height, data } = mask
  const labels = new Int32Array(width * height)
  // Label 0 is background; provisional labels start at 1. At most one per
  // two pixels can be provisional, which bounds the parent table.
  const parent = new Int32Array(Math.floor((width * height) / 2) + 2)
  const size = new Int32Array(parent.length)
  let next = 1

  const find = (label: number): number => {
    let root = label
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]]
      root = parent[root]
    }

    return root
  }
  const union = (a: number, b: number): number => {
    let ra = find(a)
    let rb = find(b)
    if (ra === rb) return ra
    if (size[ra] < size[rb]) [ra, rb] = [rb, ra]
    parent[rb] = ra
    size[ra] += size[rb]

    return ra
  }

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const p = row + x
      if (data[p] === 0) continue

      let label = 0
      const consider = (q: number): void => {
        const l = labels[q]
        if (l === 0) return
        label = label === 0 ? l : union(label, l)
      }
      if (x > 0) consider(p - 1)
      if (y > 0) {
        consider(p - width)
        if (connectivity === 8) {
          if (x > 0) consider(p - width - 1)
          if (x < width - 1) consider(p - width + 1)
        }
      }

      if (label === 0) {
        if (next >= parent.length) throw new RangeError('connected-component label table overflow')
        label = next++
        parent[label] = label
        size[label] = 1
      }
      labels[p] = label
    }
  }

  // Second pass: resolve to roots and accumulate each root's box.
  const index = new Int32Array(next).fill(-1)
  const boxes: Array<{ minX: number, minY: number, maxX: number, maxY: number, pixels: number }> = []
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const l = labels[row + x]
      if (l === 0) continue
      const root = find(l)
      let i = index[root]
      if (i === -1) {
        i = boxes.length
        index[root] = i
        boxes.push({ minX: x, minY: y, maxX: x, maxY: y, pixels: 0 })
      }
      labels[row + x] = i + 1
      const box = boxes[i]
      if (x < box.minX) box.minX = x
      if (x > box.maxX) box.maxX = x
      if (y > box.maxY) box.maxY = y
      box.pixels++
    }
  }

  const components = boxes.map(b => ({
    x:      b.minX,
    y:      b.minY,
    width:  b.maxX - b.minX + 1,
    height: b.maxY - b.minY + 1,
    pixels: b.pixels,
  }))

  return { components, labels }
}
