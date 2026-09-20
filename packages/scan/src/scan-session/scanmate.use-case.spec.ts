import { createRaster } from '@scanmate/ink'
import type { StageEvent } from '@scanmate/ink'

import { Scanmate } from './scanmate.use-case'

/**
 * The stages are mocked, so these tests are about the session's own behaviour:
 * what it remembers, what it re-runs, what it loads and when it stops.
 *
 * `vi.mock` intercepts a dynamic `import()` exactly as it does a static one, so
 * the lazy loaders are no harder to stand in for than an ordinary dependency.
 */

const calls: string[] = []
const engine = { name: 'stub', version: '1', languages: ['eng'], recognise: vi.fn(), terminate: vi.fn() }
const created = vi.fn()

function page (number: number) {
  const raster = createRaster(8, 8)

  return {
    page:        number,
    original:    { raster, image: null, dpi: 150, width: 8, height: 8 },
    scanned:     { raster, image: null, dpi: 150, width: 8, height: 8 },
    scannedPage: number,
    metadata:    { original: null, scanned: null },
  }
}

vi.mock('@scanmate/extract', () => ({
  extractPair: vi.fn(async () => {
    calls.push('extractPair')

    return { pages: [page(1)], unpaired: { original: [], scanned: [] }, pageCount: { original: 1, scanned: 1 } }
  }),
}))

vi.mock('@scanmate/align', () => ({
  alignPages: vi.fn(async (pages: readonly { page: number }[]) => {
    calls.push('alignPages')

    return pages.map(p => ({ ...p, aligned: { raster: createRaster(8, 8), image: null, dpi: 150, width: 8, height: 8, confidence: 0.9 } }))
  }),
}))

vi.mock('@scanmate/enhance', () => ({
  enhancePages: vi.fn(async (pages: readonly object[]) => {
    calls.push('enhancePages')

    return pages.map(p => ({ ...p, enhanced: { raster: createRaster(8, 8), image: null, dpi: 300, width: 8, height: 8 } }))
  }),
}))

vi.mock('@scanmate/ocr', () => ({
  ocrPages: vi.fn(async (pages: readonly { page: number }[]) => {
    calls.push('ocrPages')

    return {
      score:    1,
      pageMean: 1,
      pages:    pages.map(page => ({ ...page, text: { page: page.page, score: 1, metrics: { characters: 10 }, differences: [] } })),
      engine:   { name: 'stub', version: '1', languages: ['eng'] },
    }
  }),
  createTesseractEngine: vi.fn(async () => {
    created()
    calls.push('createTesseractEngine')

    return engine
  }),
}))

vi.mock('@scanmate/diff', () => ({
  diffPages: vi.fn(async (pages: readonly { page: number }[]) => {
    calls.push('diffPages')

    return pages.map(page => ({ ...page, diff: { page: page.page, expected: [], unexpected: [], missing: [], probes: [], masks: null } }))
  }),
}))

vi.mock('@scanmate/find', () => ({
  findContent: vi.fn((pages: readonly { page: number }[]) => {
    calls.push('findContent')

    return {
      allFound:        true,
      allIdentifiable: true,
      warnings:        [],
      pages:           pages.map(page => ({ ...page, find: { page: page.page, allFound: true, content: [], warnings: [] } })),
    }
  }),
}))

vi.mock('@scanmate/audit', () => ({
  auditPages: vi.fn(async (pages: readonly { page: number }[]) => {
    calls.push('auditPages')

    return {
      verdict:   'pass',
      textScore: 1,
      pages:     pages.map(page => ({
        ...page,
        audit: {
          page:    page.page,
          verdict: 'pass',
          text:    { page: page.page, score: 1, metrics: { characters: 10 }, differences: [] },
          pixels:  { page: page.page, expected: [], unexpected: [], missing: [], probes: [], masks: null },
        },
      })),
      summary: { pages: 1, passed: 1, findings: {}, corroborated: 0 },
    }
  }),
}))

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31])   // "%PDF-1"

function session (options = {}) {
  return new Scanmate(PDF, PDF, options)
}

beforeEach(() => {
  calls.length = 0
  created.mockClear()
  engine.terminate.mockClear()
})

describe('Scanmate', () => {
  it('runs what a stage needs, in order, whatever is asked for first', async () => {
    await session().diff()

    expect(calls).toEqual(['extractPair', 'alignPages', 'diffPages'])
  })

  it('remembers a stage rather than running it twice', async () => {
    const scan = session()
    await scan.align()
    await scan.align()
    await scan.diff()

    expect(calls.filter(c => c === 'alignPages')).toHaveLength(1)
    expect(calls.filter(c => c === 'extractPair')).toHaveLength(1)
  })

  it('shares one run between callers asking at the same time', async () => {
    // The test that fails if results are cached instead of promises.
    // Preparation is off so the count is the reading itself, not the trial
    // reads that choosing a treatment makes; that is its own test.
    const scan = session({ prepare: 'none' })
    await Promise.all([scan.ocr(), scan.ocr(), scan.diff()])

    expect(calls.filter(c => c === 'alignPages')).toHaveLength(1)
    expect(calls.filter(c => c === 'ocrPages')).toHaveLength(1)
  })

  it('re-runs a stage whose options changed, and drops what came from the old answer', async () => {
    const scan = session()
    await scan.diff()
    await scan.align({ model: 'homography' })
    await scan.diff()

    expect(calls.filter(c => c === 'alignPages')).toHaveLength(2)
    expect(calls.filter(c => c === 'diffPages')).toHaveLength(2)
    // The pages themselves did not change, so they were not extracted again.
    expect(calls.filter(c => c === 'extractPair')).toHaveLength(1)
  })

  it('treats differently-ordered but equal options as the same settings', async () => {
    const scan = session()
    await scan.align({ model: 'all', workingSize: 1400 })
    await scan.align({ workingSize: 1400, model: 'all' })

    expect(calls.filter(c => c === 'alignPages')).toHaveLength(1)
  })

  it('does not cache a failure', async () => {
    const align = await import('@scanmate/align')
    const spy = vi.mocked(align.alignPages)
    spy.mockRejectedValueOnce(new Error('no features'))
    const scan = session()

    await expect(scan.align()).rejects.toThrow('no features')
    await expect(scan.align()).resolves.toHaveLength(1)
  })

  it('prepares the pages itself, so a caller never has to align or enhance', async () => {
    const scan = session()
    await scan.ocr()

    // Each treatment is tried on one page and the best kept. Every recipe but
    // the first enhances, so the trial is visible in the calls.
    expect(calls.filter(call => call === 'enhancePages').length).toBeGreaterThan(0)
    expect(scan.preparation?.tried.map(t => t.id).toSorted((a, b) => a.localeCompare(b))).toEqual(['as-scanned', 'levelled', 'levelled-sharpened'])
    // The stub reads everything perfectly, so nothing beats leaving it alone.
    expect(scan.preparation?.chosen.id).toBe('as-scanned')
  })

  it('decides how to prepare once, however many readers ask', async () => {
    const scan = session()
    await scan.ocr()
    const trials = calls.filter(call => call === 'ocrPages').length
    await scan.audit()

    expect(calls.filter(call => call === 'ocrPages').length).toBe(trials)
  })

  it('reads the aligned pages untouched when told not to prepare', async () => {
    const scan = session({ prepare: 'none' })
    await scan.ocr()

    expect(calls).toEqual(['extractPair', 'alignPages', 'createTesseractEngine', 'ocrPages'])
    expect(scan.preparation).toBeUndefined()
  })

  it('reads the enhanced pages once enhancing was asked for', async () => {
    const scan = session()
    await scan.enhance()
    await scan.ocr()

    expect(calls).toEqual(['extractPair', 'alignPages', 'enhancePages', 'createTesseractEngine', 'ocrPages'])
  })
})

describe('Scanmate, the reading engine', () => {
  it('creates one engine for the whole session and terminates it on dispose', async () => {
    const scan = session()
    await scan.ocr()
    await scan.audit()

    expect(created).toHaveBeenCalledTimes(1)
    expect(engine.terminate).not.toHaveBeenCalled()

    await scan.dispose()
    expect(engine.terminate).toHaveBeenCalledTimes(1)
  })

  it('never terminates an engine it was given', async () => {
    const scan = session({ engine })
    await scan.ocr()
    await scan.dispose()

    expect(created).not.toHaveBeenCalled()
    expect(engine.terminate).not.toHaveBeenCalled()
  })

  it('starts no engine at all for a session that only aligns', async () => {
    const scan = session()
    await scan.align()
    await scan.dispose()

    expect(created).not.toHaveBeenCalled()
  })
})

describe('Scanmate, reusing an audit', () => {
  it('hands back the reading and the pixels the audit already worked out', async () => {
    const scan = session()
    await scan.audit()
    // What the audit already paid for: asking again must cost nothing more.
    const afterAudit = calls.length
    await scan.ocr()
    await scan.diff()

    expect(calls.slice(afterAudit)).toEqual([])
  })

  it('keeps the audit itself when it files the reading and the pixels it produced', async () => {
    // Filing a back-fill must not cascade a drop through diff to the audit that made it.
    const scan = session()
    await scan.audit()
    const joined = await scan.report()

    expect(scan.auditReport).toBeDefined()
    expect(joined[0].audit).toBeDefined()
    expect(joined[0].text).toBeDefined()
    expect(joined[0].diff).toBeDefined()
  })

  it('still runs a real diff when the caller asks for something the audit did not produce', async () => {
    const scan = session()
    await scan.audit()
    await scan.diff(undefined, { sideBySide: true })

    // Audit's own diff has no side-by-side, so this must not come from the cache.
    expect(calls.filter(c => c === 'diffPages')).toHaveLength(1)
  })
})

describe('Scanmate, what it reports without running anything', () => {
  it('answers undefined until a stage has settled', async () => {
    const scan = session()
    expect(scan.alignedPages).toBeUndefined()
    expect(scan.ocrReport).toBeUndefined()

    await scan.align()
    expect(scan.alignedPages).toHaveLength(1)
    // `loaded` is process-wide, so it only grows; what matters is that these are in it.
    expect(scan.loaded).toContain('extract')
    expect(scan.loaded).toContain('align')
  })

  it('reports progress from every stage on one callback', async () => {
    const events: StageEvent[] = []
    const scan = session({ onProgress: (event: StageEvent) => { events.push(event) } })
    const report = await scan.find()

    expect(report.allFound).toBe(true)

    expect(events.filter(event => event.stage === 'find').map(event => event.phase)).toEqual(['start', 'done'])
  })
})
