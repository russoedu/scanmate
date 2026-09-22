import { createSyntheticPdf } from '@scanmate/extract'
import { createRaster, encodeImage } from '@scanmate/ink'
import type { OcrEngine } from '@scanmate/ocr'

import { LazyEngine } from '../reading-engine'
import type { ScanmateOptions } from '../session-contract'
import { runInBatches } from './run-in-batches.use-case'

/** A document of `count` pages, each saying which it is. */
async function document (count: number): Promise<Uint8Array> {
  return await createSyntheticPdf(Array.from({ length: count }, (_, i) => ({ text: [{ x: 72, y: 700, content: `Page ${i + 1}` }] })))
}

/** A session that only records what it was opened with, and whether it was disposed. */
function recorder () {
  const opened: ScanmateOptions[] = []
  let open = 0
  let most = 0
  const factory = (_one: unknown, _two: unknown, options: ScanmateOptions) => {
    opened.push(options)
    open++
    most = Math.max(most, open)

    return {
      options,
      dispose: async () => {
        open--
      },
    }
  }

  return { opened, factory, peak: () => most, stillOpen: () => open }
}

describe('runInBatches', () => {
  it('runs a session per run of pages, one at a time, and keeps what the work returned', async () => {
    const pdf = await document(10)
    const { opened, factory, peak, stillOpen } = recorder()
    const seen: string[] = []
    const results = await runInBatches(pdf, pdf, async (_session, batch) => `${batch.index}/${batch.count}: ${batch.pages?.join(',')}`, {
      batch:   4,
      onBatch: ({ index }) => {
        seen.push(`done ${index}`)
      },
    }, factory)

    expect(results).toStrictEqual(['1/3: 1,2,3,4', '2/3: 5,6,7,8', '3/3: 9,10'])
    expect(opened.map(o => o.extract?.pages)).toStrictEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]])
    expect(seen).toStrictEqual(['done 1', 'done 2', 'done 3'])
    expect(peak()).toBe(1)
    expect(stillOpen()).toBe(0)
  }, 60_000)

  it('batches only the pages selected, keeping the other extract options', async () => {
    const pdf = await document(10)
    const { opened, factory } = recorder()
    await runInBatches(pdf, pdf, async () => null, { batch: 4, extract: { pages: '2-7', dpi: 100 } }, factory)

    expect(opened.map(o => o.extract)).toStrictEqual([{ pages: [2, 3, 4, 5], dpi: 100 }, { pages: [6, 7], dpi: 100 }])
  }, 60_000)

  it('shares one engine with every batch, and starts it only if a batch reads', async () => {
    const pdf = await document(3)
    const { opened, factory } = recorder()
    await runInBatches(pdf, pdf, async () => null, { batch: 1 }, factory)

    const [engine] = opened.map(o => o.engine)
    expect(opened.every(o => o.engine === engine)).toBe(true)
    expect(engine).toBeInstanceOf(LazyEngine)
    expect((engine as LazyEngine).started).toBe(false)
  }, 60_000)

  it('uses an engine it was given, and leaves it running', async () => {
    const terminate = vi.fn(async () => {})
    const given = { terminate } as unknown as OcrEngine
    const pdf = await document(2)
    const { opened, factory } = recorder()
    await runInBatches(pdf, pdf, async () => null, { batch: 1, engine: given }, factory)

    expect(opened.every(o => o.engine === given)).toBe(true)
    expect(terminate).not.toHaveBeenCalled()
  }, 60_000)

  it('disposes the batch whose work failed, and stops', async () => {
    const pdf = await document(8)
    const { opened, factory, stillOpen } = recorder()
    const failing = runInBatches(pdf, pdf, async (_session, batch) => {
      if (batch.index === 2) throw new Error('unreadable')

      return batch.index
    }, { batch: 3 }, factory)

    await expect(failing).rejects.toThrow('unreadable')
    expect(opened).toHaveLength(2)
    expect(stillOpen()).toBe(0)
  }, 60_000)

  it('runs a pair of images as one batch', async () => {
    const image = await encodeImage(createRaster(40, 40))
    const { opened, factory } = recorder()
    const results = await runInBatches(image, image, async (_session, batch) => batch.pages, { batch: 2 }, factory)

    expect(results).toStrictEqual([null])
    expect(opened[0].extract).toBeUndefined()
  })

  it('refuses a batch that is not a whole number of pages', async () => {
    const pdf = await document(2)
    const { factory } = recorder()

    await expect(runInBatches(pdf, pdf, async () => null, { batch: 0 }, factory)).rejects.toThrow(RangeError)
  })
})
