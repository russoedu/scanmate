import type { AuditOptions, AuditReport, EvidencePdfOptions } from '@scanmate/audit'
import type { AlignPagesOptions } from '@scanmate/align'
import type { Checkbox, CheckboxOptions, CheckboxReading, ComparedPage, DiffOptions, ExpectedChange, PageDiff } from '@scanmate/diff'
import type { EnhancePagesOptions } from '@scanmate/enhance'
import type { ExtractPairOptions } from '@scanmate/extract'
import type { ExtractedPage, ExtractOptions, FieldSpec, LocatedFields, LocateOptions } from '@scanmate/extract'
import type { ExpectedContent, FindOptions, FindReport } from '@scanmate/find'
import type { MarkOptions, MarkResult, MergeOptions, MergeResult, PageMark } from '@scanmate/merge'
import type { PipelineStage, ScanmateBinarySource, ScanmateSource } from '@scanmate/ink'
import type { OcrOptions, OcrReport, ReadPage } from '@scanmate/ocr'

import { pixelsFromAudit, readingFromAudit } from '../audit-reuse'
import { calibrateCorpus } from '../corpus-calibration'
import type { CalibrateOptions, CalibrationCase, CorpusCalibration } from '../corpus-calibration'
import { preparePages } from '../page-preparation'
import type { Preparation } from '../page-preparation'
import { resolveDocument } from '../document-input'
import type { ScanmateDocument, ScanmatePage } from '../document-input'
import { SharedEngine } from '../reading-engine'
import { fingerprint, StageCache } from '../stage-caching'
import { loadAlign, loadAudit, loadDiff, loadEnhance, loadExtract, loadFind, loadMerge, loadOcr, loadedStages } from '../stage-loading'
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
  // --- the two ends, without a comparison in between ------------------------

  /**
   * Assemble one PDF from pages that arrived separately.
   *
   * The constructor takes an array and merges it for you, so this is for when
   * there is nothing to compare yet: a returned document photographed a page at
   * a time, to be stored now and checked later, or checked against an original
   * that has not arrived.
   *
   * Static because it needs no session - there is no original, no scan and
   * nothing to remember - and it loads `@scanmate/merge` and nothing else.
   */
  static async merge (sources: readonly ScanmateSource[], options: MergeOptions = {}): Promise<MergeResult> {
    const { mergeDocuments } = await loadMerge()

    return await mergeDocuments(sources, options)
  }

  /**
   * Open a PDF and take its pages.
   *
   * The other end of the same idea: reading a document on its own - to see what
   * it holds, at what size, with what text - rather than against another one.
   * A session extracts as a matter of course; this is the same step when that
   * is all you want.
   */
  static async extract (pdf: ScanmateBinarySource, options: ExtractOptions = {}): Promise<ExtractedPage[]> {
    const { extractPages } = await loadExtract()

    return await extractPages(pdf, options)
  }

  /**
   * Draw the regions a validation will measure onto the original, to see
   * whether they are where its fields actually are.
   *
   * Give it the original and the same regions you would give `diff()` or
   * `audit()` as `expected` - a mark is the same shape - and it hands back the
   * PDF with each one boxed and its bleed drawn around it. The bleed is resolved
   * by the same rule the comparison uses, so the band on the page is the band
   * that will be measured.
   *
   * Static, like `merge` and `extract`: the original is all there is, so nothing
   * is aligned, compared or remembered, and only `@scanmate/merge` loads.
   */
  static async mark (pdf: ScanmateBinarySource, marks: readonly PageMark[], options: MarkOptions = {}): Promise<MarkResult> {
    const { markPages } = await loadMerge()

    return await markPages(pdf, marks, options)
  }

  /**
   * Find where a document's fields are from the labels it prints.
   *
   * Coordinates typed by hand are right for one layout; a generated document's
   * fields move whenever its content does. Name each field by its label and an
   * offset from it instead, and this finds the label in the text layer - across
   * runs and wrapped lines, by whole words - and places the field:
   *
   * ```ts
   * const { regions, problems } = await Scanmate.locate('issued.pdf', [
   *   { anchor: 'Signature of U.S. person', fields: { signature: { dx: 44, dy: -3.8, width: 262, height: 22 } } },
   * ])
   * if (problems.length === 0) await Scanmate.mark('issued.pdf', regions)
   * ```
   *
   * The regions are exactly what `expected` and `mark` take. An anchor printed
   * more than once is refused rather than guessed at; name the `occurrence` or
   * the `page`. Static: it reads the original's text and renders nothing, so
   * only `@scanmate/extract` loads.
   */
  static async locate (pdf: ScanmateBinarySource, specs: readonly FieldSpec[], options: LocateOptions = {}): Promise<LocatedFields> {
    const { locateFields } = await loadExtract()

    return await locateFields(pdf, specs, options)
  }

  /**
   * Measure the audit's thresholds on documents someone has checked by hand.
   *
   * Automatic acceptance is only as safe as the thresholds behind it. Give this
   * a corpus - each case an original, what came back, and whether it is
   * `genuine` or was altered - and it audits every document, then reports, for
   * each combination of thresholds, which altered documents would have passed
   * and which genuine ones would have been held up:
   *
   * ```ts
   * const { report, samples } = await Scanmate.calibrate([
   *   { id: 'order-118', genuine: true,  original: 'issued/118.pdf', scanned: 'returned/118.pdf' },
   *   { id: 'order-119', genuine: false, original: 'issued/119.pdf', scanned: 'forged/119.pdf' },
   * ], { expected, onCase: ({ sample }) => save(sample) })
   * report.best    // no false accept, fewest false reviews - with how far the corpus can vouch for it
   * ```
   *
   * One document at a time, one session each, disposed before the next, so a
   * corpus of any size costs the memory of its largest document; one OCR engine
   * serves them all. The corpus can be an async iterable, to read cases as they
   * are needed. `samples` are plain data: save them, and sweep other thresholds
   * later with `calibrateAudit` from `@scanmate/audit` without reading a page
   * again.
   */
  static async calibrate (corpus: Iterable<CalibrationCase> | AsyncIterable<CalibrationCase>, options: CalibrateOptions = {}): Promise<CorpusCalibration> {
    return await calibrateCorpus(corpus, options, (original, scanned, session) => new Scanmate(original, scanned, session))
  }

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
   * The pages a reader works on, prepared for this document.
   *
   * Nobody has to ask for this. `ocr()`, `find()` and `audit()` need pages that
   * read well and this is how they get them; `align()` and `enhance()` remain
   * callable for their own sake but are not steps a caller has to perform.
   *
   * An explicit `enhance()` wins, because a caller who named a treatment meant
   * it. Otherwise the document picks its own - see `preparePages` - and
   * `prepare: 'none'` reads the aligned pages exactly as they are.
   */
  async #readable (): Promise<ReadableScanmatePage[]> {
    if (this.#cache.has('enhance')) return this.enhance()
    if (this.#options.prepare === 'none') return this.align()

    const prepared = await this.#prepare()

    return prepared.pages
  }

  /** Which treatment this document reads best under, decided once. */
  async #prepare (): Promise<Preparation> {
    const ocr = this.#options.ocr

    return this.#cache.run('prepare', fingerprint({ ocr, prepare: this.#options.prepare }), async () => {
      const pages = await this.align()
      const { engine } = await this.#engine.lease()

      return await preparePages(pages, { engine, ocr, onProgress: this.#options.onProgress })
    })
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

  /**
   * Which boxes are ticked, on the original and on the scan.
   *
   * Each side is read on its own terms - the ink inside the box, past its
   * printed frame - so a box ticked before it was issued is read as ticked on
   * both, and an empty one is an answer, not a field someone forgot. `audit()`
   * reads the same boxes and turns into findings only the ones that are wrong.
   * Loads `@scanmate/diff`, and nothing that reads text.
   */
  async checkboxes (boxes?: readonly Checkbox[], options?: CheckboxOptions): Promise<CheckboxReading[]> {
    const wanted = boxes ?? this.#options.checkboxes ?? []

    return this.#cache.run('checkboxes', fingerprint({ wanted, options, diff: this.#options.diff?.ink }), async () => {
      const pages = await this.align()
      const { readCheckboxes } = await loadDiff()

      return await readCheckboxes(pages, wanted, { ink: this.#options.diff?.ink, ...options })
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
    const checkboxes = options?.checkboxes ?? this.#options.checkboxes ?? []
    const audit = this.#merge('audit', options)

    return this.#cache.run('audit', fingerprint({ audit, expected, checkboxes, ocr: this.#options.ocr, diff: this.#options.diff }), async () => {
      const pages = await this.#readable()
      const { auditPages } = await loadAudit()
      const { engine } = await this.#engine.lease()
      const order = new Map(pages.map((page, index) => [page.page, index + 1]))
      const report = await auditPages(pages, {
        ...audit,
        expected,
        checkboxes,
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
      // Nor when it measured checkboxes as regions: their ticks are not
      // unexpected ink to audit, and would be to a `diff()` that had no boxes.
      if (diffOptions.sideBySide !== true && diffOptions.keepMasks !== true && checkboxes.length === 0)
        this.#cache.put('diff', fingerprint({ regions: expected, diff: diffOptions }), pixelsFromAudit(report))

      return report
    })
  }

  /**
   * The audit as one PDF, for whoever reviews it: a cover with the verdict and
   * why, then each page's evidence image with what to look at in words, as
   * text that can be searched.
   *
   * Runs `audit()` if it has not run - with the session's settings, so the
   * PDF is the audit's own evidence, not a second opinion - and loads the PDF
   * library only now.
   */
  async evidence (options?: EvidencePdfOptions): Promise<Uint8Array> {
    const report = await this.audit()
    const { writeEvidencePdf } = await loadAudit()

    return await writeEvidencePdf(report, options)
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
   * How this document was prepared for reading, once anything has read it:
   * which treatment won, what the others scored, and on which page.
   */
  get preparation (): Preparation | undefined { return this.#cache.settled('prepare') }
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
