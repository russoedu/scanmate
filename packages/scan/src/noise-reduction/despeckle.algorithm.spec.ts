import { createRandom } from '@scanmate/ink'

import { despeckle } from './despeckle.algorithm'

/** The obvious median filter - window, sort, middle - to check the fast one against. */
function reference (data: Uint8ClampedArray, width: number, height: number, r: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const window: number[] = []
        for (let ny = Math.max(0, y - r); ny <= Math.min(height - 1, y + r); ny++)
          for (let nx = Math.max(0, x - r); nx <= Math.min(width - 1, x + r); nx++) window.push(data[(ny * width + nx) * 4 + c])
        window.sort((a, b) => a - b)
        out[i + c] = window[window.length >> 1]
      }
      out[i + 3] = data[i + 3]
    }

  return out
}

function noise (width: number, height: number, seed: number): Uint8ClampedArray {
  const random = createRandom(seed)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256)

  return data
}

describe('despeckle', () => {
  it('is exactly the windowed median, border included, for the 3x3 window', () => {
    const data = noise(37, 23, 1)

    expect(despeckle(data, 37, 23, 1)).toEqual(reference(data, 37, 23, 1))
  })

  it('is exactly the windowed median for a wider window', () => {
    const data = noise(19, 17, 2)

    expect(despeckle(data, 19, 17, 2)).toEqual(reference(data, 19, 17, 2))
  })

  it('removes an isolated speck and keeps a stroke three pixels wide', () => {
    const width = 20
    const height = 20
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    const set = (x: number, y: number): void => {
      data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3)
    }
    set(4, 4)
    for (let y = 8; y < 11; y++) for (let x = 2; x < 18; x++) set(x, y)
    const out = despeckle(data, width, height)

    expect(out[(4 * width + 4) * 4]).toBe(255)
    expect(out[(9 * width + 10) * 4]).toBe(0)
  })
})
