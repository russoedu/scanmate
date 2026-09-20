import type { AuditOptions, AuditReport } from '@scanmate/audit'
import type { AlignPagesOptions } from '@scanmate/align'
import type { ComparedPage, DiffOptions, ExpectedChange, PageDiff } from '@scanmate/diff'
import type { EnhancePagesOptions } from '@scanmate/enhance'
import type { ExtractPairOptions } from '@scanmate/extract'
import type { ExpectedContent, FindOptions, FindReport } from '@scanmate/find'
import type { PipelineStage } from '@scanmate/ink'
import type { OcrOptions, OcrReport, ReadPage } from '@scanmate/ocr'

import { pixelsFromAudit, readingFromAudit } from '../audit-reuse'
import { resolveDocument } from '../document-input'
import type { ScanmateDocument, ScanmatePage } from '../document-input'
import { SharedEngine } from '../reading-engine'
import { fingerprint, StageCache } from '../stage-caching'
import { loadAlign, loadAudit, loadDiff, loadEnhance, loadFind, loadOcr, loadedStages } from '../stage-loading'
import { relayAuditProgress } from './progress-relay.mapper'
import type { AlignedScanmatePage, EnhancedScanmatePage, ReadableScanmatePage, ScanmateOptions, ScanmatePageReport } from './scan-session.contract'

/**
 * One returned document, compared with the one that was issued.
 *
 * ```ts
 * const scan = new Scanmate('issued.pdf', 'returned.pdf')
 * const report = await scan.audit()
 * await scan.dispose()
 * ```
 *
 * **Every method runs what it needs.** `diff()` on a fresh session extracts and
 * aligns first. Each stage is remembered, so calling another method afterwards
 * costs only the new work, and calling the same one twice costs nothing. Change
 * an option and that stage runs again, dropping whatever was computed from its
 * old answer.
 *
 * **Nothing loads until it is used.** The stage packages are pulled in with
 * dynamic imports, so a session that only aligns never evaluates tesseract, a
 * language model, or a PDF library. `sharp` is the floor: every stage stands on
 * `@scanmate/ink`, which loads libvips when it loads.
 *
 * **It is a short-lived object, not a service.** It holds every page's pixels so
 * that later stages are cheap, which for a long document is gigabytes. Keep one
 * per document and `dispose()` it; for a long one, take it a few pages at a
 * time with `extract.pages` and dispose between batches.
 *
 * Two orderings are worth knowing. `audit()` runs the reading and the pixel
 * comparison itself and hands both back, so calling it **first** makes `ocr()`,
 * `diff()` and `find()` free afterwards. The reverse order still pays twice;
 * that is a gap in `auditPages`, not something this class can paper over
 * without forking the verdict logic.
 */
export class Scanmate {
  readonly #original: ScanmateDocument
  readonly #scanned:  ScanmateDocument
  #options:           ScanmateOptions
  readonly #cache = new StageCache()
  readonly #engine:   SharedEngine
  #merged:            { original: Uint8Array | null, scanned: Uint8Array | null } = { original: null, scanned: null }
  #unpaired:          { original: number[], scanned: number[] } | undefined
  #warning:           string | null = null

  constructor (original: ScanmateDocument, scanned: ScanmateDocument, options: ScanmateOptions = {}) {
    this.#original = original
    this.#scanned = scanned
    this.#options = options
    this.#engine = new SharedEngine(options.engine, () => this.#options.ocr?.tesseract)
  }

  /** A per-call bag over the constructor's, and it becomes this stage's settings. */
  #merge<Key extends 'extract' | 'align' | 'enhance' | 'ocr' | 'diff' | 'find' | 'audit'> (
    key: Key,
    options: Partial<NonNullable<ScanmateOptions[Key]>> | undefined,
  ): NonNullable<ScanmateOptions[Key]> {
    const merged = { ...this.#options[key], ...options } as NonNullable<ScanmateOptions[Key]>
    if (options !== undefined) this.#options = { ...this.#options, [key]: merged }

    return merged
  }

  /**
   * The newest page set a reader can work on: enhanced when it was asked for,
   * else aligned. No cast: both satisfy `ReadablePage` structurally.
   */
  async #readable (): Promise<ReadableScanmatePage[]> {
    if (this.#cache.has('enhance')) return this.enhance()

    return this.align()
  }

  // --- the stages -----------------------------------------------------------

  /** The pages of the original paired with the scan's, merging and extracting as the input needs. */
  async pages (options?: Omit<ExtractPairOptions, 'onProgress'>): Promise<ScanmatePage[]> {
    const extract = this.#merge('extract', options)

    return this.#cache.run('pages', fingerprint({ extract, merge: this.#options.merge }), async () => {
      const resolved = await resolveDocument(this.#original, this.#scanned, {
        merge:      this.#options.merge,
        extract,
        onProgress: this.#options.onProgress,
      })
      this.#merged = resolved.merged
      this.#unpaired = resolved.unpaired
      this.#warning = resolved.warning

      return resolved.pages
    })
  }

  /** Every page with the scan put back on the original's canvas. */
  async align (options?: Omit<AlignPagesOptions, 'onProgress'>): Promise<AlignedScanmatePage[]> {
    const align = this.#merge('align', options)

    return this.#cache.run('align', fingerprint(align), async () => {
      const pages = await this.pages()
      const { alignPages } = await loadAlign()

      return await alignPages(pages, { ...align, onProgress: this.#options.onProgress })
    })
  }

  /**
   * Every aligned page with a cleaned copy alongside.
   *
   * Never run implicitly. `ocrPages` enlarges what it is given, and `auditPages`
   * works from the raw alignment, so enhancing behind the caller's back would
   * shift their scores away from what the packages give on their own.
   */
  async enhance (options?: Omit<EnhancePagesOptions, 'onProgress'>): Promise<EnhancedScanmatePage[]> {
    const enhance = this.#merge('enhance', options)

    return this.#cache.run('enhance', fingerprint(enhance), async () => {
      const pages = await this.align()
      const { enhancePages } = await loadEnhance()

      return await enhancePages(pages, { ...enhance, onProgress: this.#options.onProgress })
    })
  }

  /** How closely the scan's text matches the original's. Each page comes back carrying its `text`. */
  async ocr (options?: Omit<OcrOptions, 'onProgress' | 'engine'>): Promise<OcrReport<ReadableScanmatePage>> {
    const ocr = this.#merge('ocr', options)

    return this.#cache.run('ocr', fingerprint(ocr), async () => {
      const pages = await this.#readable()
      const { ocrPages } = await loadOcr()
      const { engine } = await this.#engine.lease()

      return await ocrPages(pages, { ...ocr, engine, onProgress: this.#options.onProgress })
    })
  }

  /** What changed, and whether it was supposed to. Each page comes back carrying its `diff`. */
  async diff (expected?: readonly ExpectedChange[], options?: Omit<DiffOptions, 'onProgress'>): Promise<Array<ComparedPage<AlignedScanmatePage>>> {
    const regions = expected ?? this.#options.expected ?? []
    const diff = this.#merge('diff', options)

    return this.#cache.run('diff', fingerprint({ regions, diff }), async () => {
      const pages = await this.align()
      const { diffPages } = await loadDiff()

      return await diffPages(pages, regions, { ...diff, onProgress: this.#options.onProgress })
    })
  }

  /** Whether the content that must be there is there. Each page comes back carrying its `find`. */
  async find (content?: readonly ExpectedContent[], options?: FindOptions): Promise<FindReport<ReadPage<ReadableScanmatePage>>> {
    const wanted = content ?? this.#options.content ?? []
    const find = this.#merge('find', options)

    return this.#cache.run('find', fingerprint({ wanted, find }), async () => {
      const reading = await this.ocr()
      const { findContent } = await loadFind()
      const started = Date.now()
      // findContent is synchronous and reports nothing; the session says when it ran.
      const total = reading.pages.length
      for (const [index, page] of reading.pages.entries())
        this.#options.onProgress?.({ stage: 'find', phase: 'start', page: page.page, index: index + 1, total })
      const report = findContent(reading.pages, wanted, find)
      for (const [index, page] of reading.pages.entries())
        this.#options.onProgress?.({
          stage:      'find',
          phase:      'done',
          page:       page.page,
          index:      index + 1,
          total,
          durationMs: Date.now() - started,
          detail:     { allFound: report.pages[index]?.find.allFound },
        })

      return report
    })
  }

  /** The verdict, with its evidence. Each page comes back carrying its `audit`. */
  async audit (options?: Omit<AuditOptions, 'onProgress'>): Promise<AuditReport<ReadableScanmatePage>> {
    const expected = options?.expected ?? this.#options.expected ?? []
    const audit = this.#merge('audit', options)

    return this.#cache.run('audit', fingerprint({ audit, expected, ocr: this.#options.ocr, diff: this.#options.diff }), async () => {
      const pages = await this.#readable()
      const { auditPages } = await loadAudit()
      const { engine } = await this.#engine.lease()
      const order = new Map(pages.map((page, index) => [page.page, index + 1]))
      const report = await auditPages(pages, {
        ...audit,
        expected,
        ocr:        { ...this.#options.ocr, engine },
        diff:       this.#options.diff,
        onProgress: relayAuditProgress(this.#options.onProgress, page => order.get(page) ?? 1, pages.length),
      })

      // Audit already did the reading and the pixel comparison; keep both so a
      // later call is free.
      //
      // The reading is filed under the settings a bare `ocr()` would ask for,
      // because audit was handed exactly those. The pixels are only filed when
      // audit's forced settings cannot have changed the answer: it runs its
      // diff with no side-by-side and drops the masks afterwards, so a session
      // wanting either must not be handed this - it would get a `null` where it
      // asked for a picture. See ../audit-reuse.
      const diffOptions = { ...this.#options.diff }
      this.#cache.put('ocr', fingerprint({ ...this.#options.ocr }), readingFromAudit(report, engine))
      if (diffOptions.sideBySide !== true && diffOptions.keepMasks !== true)
        this.#cache.put('diff', fingerprint({ regions: expected, diff: diffOptions }), pixelsFromAudit(report))

      return report
    })
  }

  /**
   * Everything this session knows about each page.
   *
   * A plain lookup by page number, not a join with an assertion: every stage
   * hands its pages back, so nothing has to be matched up again afterwards.
   */
  async report (): Promise<ScanmatePageReport[]> {
    const aligned = await this.align()
    const reading = byPage(this.#cache.settled<OcrReport<ReadableScanmatePage>>('ocr')?.pages)
    const compared = byPage(this.#cache.settled<Array<ComparedPage<AlignedScanmatePage>>>('diff'))
    const audited = byPage(this.#cache.settled<AuditReport<ReadableScanmatePage>>('audit')?.pages)
    const searched = byPage(this.#cache.settled<FindReport<ReadPage<ReadableScanmatePage>>>('find')?.pages)

    return aligned.map(page => ({
      page:    page.page,
      aligned: page,
      text:    reading.get(page.page)?.text,
      diff:    compared.get(page.page)?.diff,
      find:    searched.get(page.page)?.find,
      audit:   audited.get(page.page)?.audit,
    }))
  }

  // --- what it knows, without running anything ------------------------------

  get sourcePages (): readonly ScanmatePage[] | undefined { return this.#cache.settled('pages') }
  get alignedPages (): readonly AlignedScanmatePage[] | undefined { return this.#cache.settled('align') }
  get enhancedPages (): readonly EnhancedScanmatePage[] | undefined { return this.#cache.settled('enhance') }
  get ocrReport (): OcrReport | undefined { return this.#cache.settled('ocr') }
  get pageDiffs (): readonly PageDiff[] | undefined { return this.#cache.settled('diff') }
  get findReport (): FindReport | undefined { return this.#cache.settled('find') }
  get auditReport (): AuditReport | undefined { return this.#cache.settled('audit') }
  /** Pages with no partner on the other side. Nothing downstream reports these. */
  get unpaired (): { original: number[], scanned: number[] } | undefined { return this.#unpaired }
  /** The merged PDF for a side that was given as an array of sources. */
  get mergedPdf (): { original: Uint8Array | null, scanned: Uint8Array | null } { return this.#merged }
  /** Set when the two sides are of different kinds, so they share no matched resolution. */
  get warning (): string | null { return this.#warning }
  /**
   * Which stage packages have been loaded.
   *
   * Process-wide, not per session: module evaluation happens once, so a second
   * session loads nothing and a per-instance count would say so misleadingly.
   */
  get loaded (): ReadonlySet<PipelineStage> { return loadedStages() }

  // --- ending it ------------------------------------------------------------

  /**
   * Terminates an engine this session created and forgets every cached page.
   *
   * Idempotent, and the session still works afterwards: a later call starts
   * again from the inputs. A session that never read anything never started an
   * engine, so forgetting to call this leaks nothing there.
   *
   * No `Symbol.asyncDispose`, so no `await using`: the workspace compiles
   * against `es2024`, which does not declare it, and adding the lib for one
   * piece of syntactic sugar is not worth the divergence. Call this.
   */
  async dispose (): Promise<void> {
    this.#cache.clear()
    await this.#engine.dispose()
  }
}

/** Items by the page they belong to. */
function byPage<T extends { page: number }> (items: readonly T[] | undefined): Map<number, T> {
  return new Map((items ?? []).map(item => [item.page, item]))
}

export { loadedStages } from '../stage-loading'
