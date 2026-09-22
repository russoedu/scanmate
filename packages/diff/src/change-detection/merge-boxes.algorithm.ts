import type { Component } from './connected-components.algorithm'

/**
 * Join components that belong to one change.
 *
 * A signature is not one connected component: the pen lifts between letters,
 * the dot of an i floats above its stem, a tick's two strokes may not quite meet.
 * Reported raw, one signature would be forty boxes. So components whose boxes
 * come within `gap` pixels of each other are merged, and merged boxes that now
 * reach a neighbour merge again, until nothing moves.
 *
 * Naive pairwise merging is quadratic, and a badly aligned page can produce
 * thousands of fragments. Boxes are bucketed on a grid of cells at least as
 * large as the gap, so each box is only compared with the few that share or
 * border its cells.
 */

export interface MergedBox {
  x:          number
  y:          number
  width:      number
  height:     number
  /** Changed pixels inside the merged box. */
  pixels:     number
  /** How many components it was built from. */
  components: number
}

export function mergeBoxes (components: readonly Component[], gap: number): MergedBox[] {
  let boxes: MergedBox[] = components.map(c => ({ ...c, components: 1 }))
  if (boxes.length < 2) return boxes

  // Each pass unions everything that touches; a merged box can newly reach
  // another, so repeat until a pass merges nothing.
  for (;;) {
    const merged = mergeOnce(boxes, gap)
    if (merged.length === boxes.length) return merged
    boxes = merged
  }
}

function mergeOnce (boxes: readonly MergedBox[], gap: number): MergedBox[] {
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }

    return i
  }

  const cell = Math.max(16, gap * 2)
  const grid = new Map<string, number[]>()
  for (const [i, box] of boxes.entries()) {
    for (const key of cellsOf(box, gap, cell)) {
      const bucket = grid.get(key)
      if (bucket === undefined) grid.set(key, [i])
      else bucket.push(i)
    }
  }

  for (const bucket of grid.values())
    for (let a = 0; a < bucket.length; a++)
      for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a]
        const j = bucket[b]
        if (find(i) !== find(j) && near(boxes[i], boxes[j], gap)) parent[find(j)] = find(i)
      }

  const groups = new Map<number, MergedBox>()
  for (const [i, box] of boxes.entries()) {
    const root = find(i)
    const group = groups.get(root)
    if (group === undefined) {
      groups.set(root, { ...box })
      continue
    }
    const right = Math.max(group.x + group.width, box.x + box.width)
    const bottom = Math.max(group.y + group.height, box.y + box.height)
    group.x = Math.min(group.x, box.x)
    group.y = Math.min(group.y, box.y)
    group.width = right - group.x
    group.height = bottom - group.y
    group.pixels += box.pixels
    group.components += box.components
  }

  return [...groups.values()]
}

/** Do two boxes come within `gap` pixels of each other? Touching or overlapping counts. */
function near (a: MergedBox, b: MergedBox, gap: number): boolean {
  return a.x - gap <= b.x + b.width &&
    b.x - gap <= a.x + a.width &&
    a.y - gap <= b.y + b.height &&
    b.y - gap <= a.y + a.height
}

/** Grid cells covered by a box inflated by the gap. */
function cellsOf (box: MergedBox, gap: number, cell: number): string[] {
  const x0 = Math.floor((box.x - gap) / cell)
  const y0 = Math.floor((box.y - gap) / cell)
  const x1 = Math.floor((box.x + box.width + gap) / cell)
  const y1 = Math.floor((box.y + box.height + gap) / cell)
  const keys: string[] = []
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) keys.push(`${cx},${cy}`)

  return keys
}
