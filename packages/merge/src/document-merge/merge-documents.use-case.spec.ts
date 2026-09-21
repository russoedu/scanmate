import { PDFDocument } from '@cantoo/pdf-lib'
import { createRaster, encodeImage } from '@scanmate/ink'
import type { StageEvent } from '@scanmate/ink'
import sharp from 'sharp'

import { MergeSourceError } from '../source-reading'
import { mergeDocuments } from './merge-documents.use-case'

async function pdf (...sizes: Array<[number, number]>): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  for (const size of sizes) document.addPage(size)

  return document.save()
}

/** A solid image as a file, with the resolution it records. */
async function image (format: 'jpeg' | 'png' | 'webp', width: number, height: number, density = 72, orientation?: number): Promise<Uint8Array> {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 40 } } })
  const withMeta = base.withMetadata({ density, ...(orientation !== undefined && { orientation }) })
  const encoded = format === 'jpeg' ? withMeta.jpeg() : (format === 'png' ? withMeta.png() : withMeta.webp())

  return new Uint8Array(await encoded.toBuffer())
}

function contains (haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer

    return true
  }

  return false
}

/** A PDF of `pages` blank pages, encrypted the way given. */
async function encryptedPdf (pages: number, security: { ownerPassword: string, userPassword: string }): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  for (let page = 0; page < pages; page++) document.addPage([300, 400])
  document.encrypt(security)

  return await document.save()
}

describe('mergeDocuments, with encrypted sources', () => {
  it('merges a signed-style PDF - an owner password alone - without being given one', async () => {
    const signed = await encryptedPdf(2, { ownerPassword: 'owner', userPassword: '' })
    const other = await encryptedPdf(1, { ownerPassword: 'owner', userPassword: '' })
    const result = await mergeDocuments([signed, other])

    expect(result.pageCount).toBe(3)
    // A new document, so it comes out unencrypted whatever went in.
    const merged = await PDFDocument.load(result.pdf)
    expect(merged.isEncrypted).toBe(false)
  })

  it('opens a source that needs a password to be read, given it, and names the source when not', async () => {
    const secured = await encryptedPdf(1, { ownerPassword: 'owner', userPassword: 'secret' })
    const other = await encryptedPdf(1, { ownerPassword: 'owner', userPassword: '' })

    await expect(mergeDocuments([other, secured])).rejects.toMatchObject({ index: 1 })
    await expect(mergeDocuments([other, secured])).rejects.toBeInstanceOf(MergeSourceError)
    const result = await mergeDocuments([other, secured], { password: 'secret' })
    expect(result.pageCount).toBe(2)
  })
})

describe('mergeDocuments', () => {
  it('puts PDFs, image files and rasters into one PDF, in the order given', async () => {
    const result = await mergeDocuments([
      await pdf([595, 842], [612, 792]),
      await image('jpeg', 300, 400, 300),
      await image('png', 200, 100, 200),
      { raster: createRaster(150, 150), dpi: 150 },
    ])
    const reopened = await PDFDocument.load(result.pdf)

    expect(reopened.getPageCount()).toBe(5)
    expect(result.passedThrough).toBe(false)
    expect(result.pages.map(p => [p.page, p.source, p.sourcePage, p.kind, p.embedding])).toEqual([
      [1, 1, 1, 'pdf', 'pdf-page'],
      [2, 1, 2, 'pdf', 'pdf-page'],
      [3, 2, 1, 'image', 'jpeg'],
      [4, 3, 1, 'image', 'png'],
      [5, 4, 1, 'raster', 'encoded-png'],
    ])
    expect(reopened.getPage(1).getSize()).toEqual({ width: 612, height: 792 })
  })

  it('sizes an image page from the resolution the image records', async () => {
    const result = await mergeDocuments([await image('png', 600, 300, 200)])

    // 600 x 300 pixels at 200 dpi is 3 x 1.5 inches.
    expect(result.pages[0]).toMatchObject({ width: 216, height: 108, dpi: 200 })
  })

  it('does not believe the 72 dpi that software writes when it knows nothing', async () => {
    const result = await mergeDocuments([await image('png', 300, 300, 72)], { imageDpi: 100 })

    expect(result.pages[0]).toMatchObject({ width: 216, height: 216, dpi: 100 })
  })

  it('embeds a JPEG as its own bytes, compressed once only', async () => {
    const jpeg = await image('jpeg', 64, 48, 300)
    const result = await mergeDocuments([jpeg, await image('png', 10, 10)])

    expect(result.pages[0].embedding).toBe('jpeg')
    expect(contains(result.pdf, jpeg)).toBe(true)
  })

  it('applies a JPEG’s EXIF rotation, so a phone photo lands upright', async () => {
    // Stored 80 wide and 40 tall, tagged to be turned a quarter: it is portrait.
    const result = await mergeDocuments([await image('jpeg', 80, 40, 300, 6)])

    expect(result.pages[0].embedding).toBe('encoded-png')
    expect(result.pages[0].height).toBeGreaterThan(result.pages[0].width)
  })

  it('decodes formats a PDF cannot hold, and encodes them as asked', async () => {
    const lossless = await mergeDocuments([await image('webp', 40, 40, 300)])
    const small = await mergeDocuments([await image('webp', 40, 40, 300)], { encoding: 'jpeg' })

    expect(lossless.pages[0].embedding).toBe('encoded-png')
    expect(small.pages[0].embedding).toBe('encoded-jpeg')
  })

  it('makes one page per frame of a multi-page image', async () => {
    const frames = await Promise.all([1, 2, 3].map(async n => sharp({ create: { width: 20, height: 20, channels: 3, background: { r: n * 60, g: 0, b: 0 } } }).png().toBuffer()))
    const animated = new Uint8Array(await sharp(frames, { join: { animated: true } }).webp().toBuffer())
    const result = await mergeDocuments([animated])

    expect(result.pages.map(p => p.sourcePage)).toEqual([1, 2, 3])
  })

  it('embeds a page image’s encoded bytes rather than encoding its raster again', async () => {
    const raster = createRaster(30, 20, [10, 200, 10, 255])
    const jpeg = await encodeImage(raster, { format: 'jpeg' })
    const png = await encodeImage(raster, { format: 'png' })
    const result = await mergeDocuments([{ raster, dpi: 300, image: jpeg }, { raster, dpi: 300, image: png }])

    expect(result.pages.map(p => [p.kind, p.embedding, p.dpi])).toEqual([['raster', 'jpeg', 300], ['raster', 'png', 300]])
    expect(contains(result.pdf, jpeg)).toBe(true)
  })

  it('fits images to a paper size when asked, turning the page for a landscape image', async () => {
    const result = await mergeDocuments([await image('png', 400, 300, 300)], { pageSize: 'a4' })

    expect(result.pages[0]).toMatchObject({ width: 841.89, height: 595.28 })
  })

  it('returns a single PDF byte for byte', async () => {
    const original = await pdf([595, 842])
    const result = await mergeDocuments([original])

    expect(result.passedThrough).toBe(true)
    expect(result.pdf).toEqual(original)
    expect(result.pageCount).toBe(1)
  })

  it('writes a new file for a single PDF when given metadata to set', async () => {
    const result = await mergeDocuments([await pdf([595, 842])], { metadata: { title: 'Signed OCF', keywords: ['ocf'] } })
    const reopened = await PDFDocument.load(result.pdf, { updateMetadata: false })

    expect(result.passedThrough).toBe(false)
    expect(reopened.getTitle()).toBe('Signed OCF')
    expect(reopened.getProducer()).toBe('@scanmate/merge')
  })

  it('says which source it could not use', async () => {
    const bad = mergeDocuments([await image('png', 5, 5), new TextEncoder().encode('neither a PDF nor an image')])

    await expect(bad).rejects.toBeInstanceOf(MergeSourceError)
    await expect(bad).rejects.toMatchObject({ index: 1 })
    await expect(mergeDocuments([])).rejects.toThrow(RangeError)
  })

  it('reports a start and a done event per source', async () => {
    const events: StageEvent[] = []
    await mergeDocuments([await pdf([100, 100], [100, 100]), await image('png', 5, 5)], { onProgress: e => { events.push(e) } })

    expect(events.map(e => `${e.stage}:${e.phase}:${e.page}`)).toEqual(['merge:start:1', 'merge:done:1', 'merge:start:2', 'merge:done:2'])
    expect(events[1].detail).toEqual({ kind: 'pdf', pages: 2 })
  })
})
