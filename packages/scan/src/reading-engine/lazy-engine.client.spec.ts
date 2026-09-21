import { createRaster } from '@scanmate/ink'
import type { OcrEngine, RecognisedText } from '@scanmate/ocr'

import { LazyEngine } from './lazy-engine.client'

function fake () {
  const terminate = vi.fn(async () => {})
  const recognise = vi.fn(async () => ({ text: '', words: [] } as unknown as RecognisedText))
  const engine = { name: 'fake', version: '1', languages: ['eng'], recognise, terminate } as unknown as OcrEngine
  const create = vi.fn(async () => engine)

  return { create, recognise, terminate }
}

describe('LazyEngine', () => {
  it('starts nothing until something reads', async () => {
    const { create } = fake()
    const lazy = new LazyEngine(create)
    await lazy.terminate()

    expect(lazy.started).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(() => lazy.name).toThrow('has not read anything yet')
  })

  it('starts once, however many read at the same time, and answers for the engine it started', async () => {
    const { create, recognise } = fake()
    const lazy = new LazyEngine(create)
    const page = createRaster(4, 4)
    await Promise.all([lazy.recognise(page), lazy.recognise(page), lazy.recognise(page)])

    expect(create).toHaveBeenCalledTimes(1)
    expect(recognise).toHaveBeenCalledTimes(3)
    expect([lazy.name, lazy.version, lazy.languages]).toStrictEqual(['fake', '1', ['eng']])
  })

  it('is terminated only by its owner, and only once', async () => {
    const { create, terminate } = fake()
    const lazy = new LazyEngine(create)
    await lazy.recognise(createRaster(4, 4))
    await lazy.terminate()

    expect(terminate).not.toHaveBeenCalled()
    await lazy.release()
    await lazy.release()
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(lazy.started).toBe(false)
  })
})
