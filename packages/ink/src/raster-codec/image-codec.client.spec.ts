import sharp from 'sharp'

import { blurRaster, countPages, decodeImage, encodeImage, readImageMetadata, resampleRaster } from './image-codec.client'
import { createRaster } from './raster.model'

/** Odd dimensions on purpose: a stride or padding bug hides behind a round number. */
const W = 37
const H = 19

function page (): ReturnType<typeof createRaster> {
  const image = createRaster(W, H)
  for (let p = 0; p < W * H; p++) {
    const i = p * 4
    image.data[i] = p % 256
    image.data[i + 1] = (p * 7) % 256
    image.data[i + 2] = (p * 13) % 256
    image.data[i + 3] = 255
  }

  return image
}

describe('decodeImage', () => {
  it('round trips RGBA through PNG byte for byte', async () => {
    const original = page()
    const back = await decodeImage(await encodeImage(original, { format: 'png' }))

    expect({ width: back.width, height: back.height }).toEqual({ width: W, height: H })
    expect([...back.data]).toEqual([...original.data])
  })

  it('passes an already-decoded raster straight through, without copying', async () => {
    const original = page()

    expect(await decodeImage(original)).toBe(original)
  })

  it('accepts an ArrayBuffer as readily as a Uint8Array', async () => {
    const bytes = await encodeImage(page(), { format: 'png' })
    const copy = new Uint8Array(bytes)
    const fromView = await decodeImage(copy)
    const detached = new ArrayBuffer(copy.byteLength)
    new Uint8Array(detached).set(copy)
    const fromBuffer = await decodeImage(detached)

    expect([...fromBuffer.data]).toEqual([...fromView.data])
  })

  it('reads a file from a path', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ink-codec-'))
    const file = path.join(dir, 'page.png')
    await fs.writeFile(file, await encodeImage(page(), { format: 'png' }))

    const back = await decodeImage(file)
    expect({ width: back.width, height: back.height }).toEqual({ width: W, height: H })
  })

  it('flattens transparency onto white rather than onto black', async () => {
    const transparent = createRaster(4, 1, [0, 0, 0, 0])
    const back = await decodeImage(await encodeImage(transparent, { format: 'png' }))

    expect([...back.data.slice(0, 4)]).toEqual([255, 255, 255, 255])
  })

  it('rejects an empty buffer', async () => {
    await expect(decodeImage(new Uint8Array(0))).rejects.toThrow(/empty image buffer/)
  })

  it('rejects bytes that are not an image', async () => {
    await expect(decodeImage(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow()
  })
})

describe('encodeImage', () => {
  it('writes PNG by default', async () => {
    const meta = await readImageMetadata(await encodeImage(page()))

    expect(meta.format).toBe('png')
  })

  it('writes every format it claims to, and reads each one back at the right size', async () => {
    const original = page()
    for (const format of ['png', 'jpeg', 'webp', 'tiff', 'avif'] as const) {
      const bytes = await encodeImage(original, { format })
      expect(bytes.length).toBeGreaterThan(0)
      const back = await decodeImage(bytes)
      expect({ format, width: back.width, height: back.height })
        .toEqual({ format, width: W, height: H })
    }
  }, 60_000)

  it('round trips TIFF, which the pure-JavaScript codec could not read at all', async () => {
    const original = page()
    const back = await decodeImage(await encodeImage(original, { format: 'tiff' }))

    expect([...back.data]).toEqual([...original.data])
  })

  it('honours the PNG compression level', async () => {
    const original = page()
    const fast = await encodeImage(original, { format: 'png', compressionLevel: 0 })
    const small = await encodeImage(original, { format: 'png', compressionLevel: 9 })

    expect(small.length).toBeLessThan(fast.length)
  })
})

describe('decodeImage orientation', () => {
  it('applies the EXIF orientation tag by default', async () => {
    // Landscape pixels tagged "display rotated 90 clockwise", as a phone camera
    // emits. A correct reader hands back a portrait raster. The old jpeg-js path
    // ignored this entirely, which put a phone photo 90 degrees out of true
    // against a maxSkewDeg that defaults to 12.
    const tagged = await sharp({
      create: { width: 20, height: 10, channels: 3, background: { r: 200, g: 50, b: 50 } },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer()

    const oriented = await decodeImage(tagged)
    expect({ width: oriented.width, height: oriented.height }).toEqual({ width: 10, height: 20 })

    const asStored = await decodeImage(tagged, { autoOrient: false })
    expect({ width: asStored.width, height: asStored.height }).toEqual({ width: 20, height: 10 })
  }, 30_000)
})

describe('readImageMetadata', () => {
  it('reports the shape of an encoded image without decoding it', async () => {
    const meta = await readImageMetadata(await encodeImage(page(), { format: 'png' }))

    expect({ format: meta.format, width: meta.width, height: meta.height, pages: meta.pages })
      .toEqual({ format: 'png', width: W, height: H, pages: 1 })
  })

  it('reports pixel density when the file records it', async () => {
    const withDensity = await sharp(
      Buffer.from(page().data.buffer, page().data.byteOffset, W * H * 4),
      { raw: { width: W, height: H, channels: 4 } },
    ).withMetadata({ density: 300 }).png().toBuffer()

    const metadata = await readImageMetadata(withDensity)

    expect(metadata.density).toBe(300)
  })

  it('refuses a decoded raster, which has no file to describe', async () => {
    await expect(readImageMetadata(page())).rejects.toThrow(/not a decoded raster/)
  })
})

describe('countPages', () => {
  it('counts one page for an ordinary image', async () => {
    const png = await encodeImage(page(), { format: 'png' })

    expect(await countPages(png)).toBe(1)
  })

  // A genuine multi-page TIFF cannot be synthesised here: sharp reads multi-page
  // sources but will not write one from a raw buffer (`pageHeight` on raw input
  // produces a single tall page). Covering the greater-than-one case needs a real
  // scanner TIFF committed as a fixture, which belongs with the PDF fixtures.
})

describe('resampleRaster', () => {
  it('enlarges to the exact size asked for, keeping a solid colour solid', async () => {
    const out = await resampleRaster(createRaster(31, 20, [40, 90, 200, 255]), 100, 65)

    expect({ width: out.width, height: out.height }).toEqual({ width: 100, height: 65 })
    expect([...out.data.slice(50 * 4 * 100 + 200, 50 * 4 * 100 + 204)]).toEqual([40, 90, 200, 255])
  })

  it('keeps a dark stroke dark when enlarging it threefold', async () => {
    const page = createRaster(30, 30)
    for (let y = 0; y < 30; y++) page.data.set([0, 0, 0, 255], (y * 30 + 15) * 4)
    const out = await resampleRaster(page, 90, 90)

    expect(out.data[(45 * 90 + 46) * 4]).toBeLessThan(60)
    expect(out.data[(45 * 90 + 10) * 4]).toBe(255)
  })

  it('returns a copy, not the input, when the size is unchanged', async () => {
    const page = createRaster(4, 4)
    const out = await resampleRaster(page, 4, 4)

    expect(out).not.toBe(page)
    expect(out.data).toEqual(page.data)
  })

  it('refuses a size that is not a positive whole number of pixels', async () => {
    await expect(resampleRaster(createRaster(4, 4), 0, 4)).rejects.toThrow(RangeError)
  })
})

describe('blurRaster', () => {
  it('softens an edge and keeps the page its size', async () => {
    const edge = createRaster(40, 10)
    for (let y = 0; y < 10; y++) for (let x = 0; x < 40; x++) edge.data.set(x < 20 ? [0, 0, 0] : [255, 255, 255], (y * 40 + x) * 4)
    const blurred = await blurRaster(edge, 2)
    const at = (x: number) => blurred.data[(5 * 40 + x) * 4]

    expect([blurred.width, blurred.height]).toStrictEqual([40, 10])
    expect(at(2)).toBe(0)
    expect(at(37)).toBe(255)
    expect(at(19)).toBeGreaterThan(40)
    expect(at(20)).toBeLessThan(215)
    expect(at(19)).toBeLessThan(at(20))
  })

  it('refuses a sigma libvips cannot blur with', async () => {
    await expect(blurRaster(createRaster(4, 4), 0.1)).rejects.toThrow(RangeError)
  })
})
