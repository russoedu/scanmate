/**
 * Median-filter the R, G and B channels of an RGBA buffer; alpha is copied.
 *
 * A median, unlike the mean the background is estimated with, rejects the
 * isolated light and dark specks a scanner or photocopier leaves instead of
 * smearing them into their neighbours - which, once contrast is stretched, is
 * how a speck fuses into a thin stroke and a `1` becomes a `l`.
 *
 * Each output is the median of the square window of `radius` around it,
 * clipped at the image border - the element at `length >> 1` of the sorted
 * window, so a clipped window of even size takes the upper middle. For the
 * common 3x3 window, interior pixels use a 19-comparison selection network
 * (Paeth) instead of a sort: the same value, several times faster, on a page
 * of millions of pixels times three channels.
 */
export function despeckle (data: Uint8ClampedArray, width: number, height: number, radius = 1): Uint8ClampedArray {
  const r = Math.max(1, Math.round(radius))
  const out = new Uint8ClampedArray(data.length)
  const side = 2 * r + 1
  const window = new Uint8Array(side * side)
  const nine = new Uint8Array(9)

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height - 1, y + r)

    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      out[index + 3] = data[index + 3]
      const interior = r === 1 && y > 0 && y < height - 1 && x > 0 && x < width - 1

      for (let c = 0; c < 3; c++) {
        if (interior) {
          const above = index - width * 4 + c
          const here = index + c
          const below = index + width * 4 + c
          nine[0] = data[above - 4]
          nine[1] = data[above]
          nine[2] = data[above + 4]
          nine[3] = data[here - 4]
          nine[4] = data[here]
          nine[5] = data[here + 4]
          nine[6] = data[below - 4]
          nine[7] = data[below]
          nine[8] = data[below + 4]
          out[index + c] = median9(nine)
          continue
        }

        const x0 = Math.max(0, x - r)
        const x1 = Math.min(width - 1, x + r)
        let n = 0
        for (let ny = y0; ny <= y1; ny++)
          for (let nx = x0; nx <= x1; nx++) window[n++] = data[(ny * width + nx) * 4 + c]
        out[index + c] = selectMiddle(window, n)
      }
    }
  }

  return out
}

/** The sorted element at `n >> 1` of the first `n` values, by insertion sort - windows here are tiny. */
function selectMiddle (values: Uint8Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = values[i]
    let j = i - 1
    while (j >= 0 && values[j] > v) {
      values[j + 1] = values[j]
      j--
    }
    values[j + 1] = v
  }

  return values[n >> 1]
}

/** Median of nine values by Paeth's selection network; leaves `p` partly sorted. */
function median9 (p: Uint8Array): number {
  sort(p, 1, 2)
  sort(p, 4, 5)
  sort(p, 7, 8)
  sort(p, 0, 1)
  sort(p, 3, 4)
  sort(p, 6, 7)
  sort(p, 1, 2)
  sort(p, 4, 5)
  sort(p, 7, 8)
  sort(p, 0, 3)
  sort(p, 5, 8)
  sort(p, 4, 7)
  sort(p, 3, 6)
  sort(p, 1, 4)
  sort(p, 2, 5)
  sort(p, 4, 7)
  sort(p, 4, 2)
  sort(p, 6, 4)
  sort(p, 4, 2)

  return p[4]
}

function sort (p: Uint8Array, a: number, b: number): void {
  if (p[a] <= p[b]) return

  const t = p[a]
  p[a] = p[b]
  p[b] = t
}
