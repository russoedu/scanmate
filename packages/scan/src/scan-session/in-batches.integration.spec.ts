import { createSyntheticPdf } from '@scanmate/extract'

import { Scanmate } from './scanmate.use-case'

/** A document of `count` pages, each saying which it is. */
async function document (count: number): Promise<Uint8Array> {
  return await createSyntheticPdf(Array.from({ length: count }, (_, i) => ({ text: [{ x: 72, y: 700, content: `Page ${i + 1}` }] })))
}

describe('Scanmate.inBatches', () => {
  it('hands each batch a real session over just its pages', async () => {
    const pdf = await document(5)
    const pages = await Scanmate.inBatches(pdf, pdf, async (scan) => {
      const extracted = await scan.pages()

      return extracted.map(page => page.page)
    }, { batch: 2, extract: { dpi: 36 } })

    expect(pages).toStrictEqual([[1, 2], [3, 4], [5]])
  }, 120_000)
})
