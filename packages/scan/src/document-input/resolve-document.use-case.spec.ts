import { createSyntheticPdf, extractPages } from '@scanmate/extract'
import { encodeImage } from '@scanmate/ink'

import { resolveDocument } from './resolve-document.use-case'

/** A document of `count` pages, each saying which it is. */
async function document (count: number): Promise<Uint8Array> {
  return await createSyntheticPdf(Array.from({ length: count }, (_, i) => ({ text: [{ x: 72, y: 700, content: `Page ${i + 1}` }] })))
}

/** A page of the document as a photograph would bring it back: an image, not a PDF. */
async function photograph (pdf: Uint8Array, page: number, dpi: number): Promise<Uint8Array> {
  const [rendered] = await extractPages(pdf, { pages: [page], dpi, output: 'none' })

  return await encodeImage(rendered.image.raster)
}

describe('resolveDocument, a document against an image', () => {
  it('renders the document\'s page at the image\'s resolution and keeps its text', async () => {
    const pdf = await document(1)
    const photo = await photograph(pdf, 1, 100)
    const { pages, warning } = await resolveDocument(pdf, photo)
    const [pair] = pages

    expect(pages).toHaveLength(1)
    // Matched to the pixel, give or take the rounding of a computed resolution.
    expect(Math.abs(pair.original.raster.width - pair.scanned.raster.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(pair.original.raster.height - pair.scanned.raster.height)).toBeLessThanOrEqual(1)
    expect(pair.metadata.original?.textItems.map(item => item.text)).toStrictEqual(['Page 1'])
    expect(pair.metadata.scanned).toBeUndefined()
    expect(warning).toBeNull()
  }, 60_000)

  it('pairs the image with the page extract.pages selects, and says the document had more', async () => {
    const pdf = await document(3)
    const { pages, warning } = await resolveDocument(pdf, await photograph(pdf, 2, 100), { extract: { pages: [2] } })

    expect(pages[0].page).toBe(2)
    expect(pages[0].metadata.original?.textItems[0].text).toBe('Page 2')
    expect(warning).toBe('the image was compared with page 2 of a 3-page document; choose another with extract.pages')
  }, 60_000)

  it('works the other way round: an image original against a PDF return', async () => {
    const pdf = await document(1)
    const { pages } = await resolveDocument(await photograph(pdf, 1, 80), pdf)

    expect(pages[0].metadata.scanned?.textItems[0].text).toBe('Page 1')
    expect(Math.abs(pages[0].original.raster.width - pages[0].scanned.raster.width)).toBeLessThanOrEqual(1)
  }, 60_000)
})
