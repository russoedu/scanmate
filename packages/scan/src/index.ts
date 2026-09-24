/**
 * `@scanmate/scan` - one class over the whole pipeline.
 *
 * ```ts
 * import { Scanmate } from '@scanmate/scan'
 *
 * const scan = new Scanmate('issued.pdf', 'returned.pdf', {
 *   expected: [{ page: 1, id: 'signature', x: 120, y: 577, width: 262, height: 22 }],
 * })
 * const report = await scan.audit()
 * report.verdict                     // 'pass' | 'review'
 * report.pages[0].evidenceImage      // original, scan and overlay, findings drawn
 * await scan.dispose()
 * ```
 *
 * Each stage runs what it needs, remembers what it did, and the stage packages
 * are loaded only when used: a session that only aligns never evaluates
 * tesseract or a PDF library. The pixel comparison, enhancement, the content
 * search and the audit are this package's own code, exported below for use on
 * their own; the reader, the aligner, the PDF reader and the assembler are
 * packages of their own.
 */

export { Scanmate } from './scan-session'
export type { AlignedScanmatePage, EnhancedScanmatePage, ReadableScanmatePage, ScanmateOptions, ScanmatePageReport } from './session-contract'
export type { ScanmateDocument, ScanmatePage } from './document-input'
export type { CalibrateOptions, CalibrationCase, CorpusCalibration } from './corpus-calibration'
export type { BatchInfo, BatchOptions } from './batch-running'
export type { BatchEvidence, BatchEvidenceOptions } from './batch-evidence'

// --- The pixel comparison: what changed on a page, and whether it should have - and which boxes are ticked ---

export { DEFAULT_MIN_CHANGE_AREA, DEFAULT_MIN_MISSING_AREA, diffPage, diffPages } from './change-detection'
export type { Change, ComparedPage, CoordinateUnits, DiffOptions, ExpectedChange, ExpectedResult, InkProbe, PageDiff, ProbeRect, RegionInkMetrics } from './change-detection'
export { checkGroups, readCheckboxes } from './checkbox-reading'
export type { Checkbox, CheckboxGroup, CheckboxOptions, CheckboxReading, CheckboxSide, CheckboxState, GroupReading } from './checkbox-reading'
export { compareRegions, diffDocument, renderDiff } from './region-comparison'
export type { DocumentDiff, Region, RegionOptions, RegionReport } from './region-comparison'
export { annotateOverlay, composePanels, composeSideBySide, connectedComponents, EXPECTED_MARGIN, IDENTIFIED, labelComponents, measureRegionInk, mergeBoxes, MISSING, NOT_IDENTIFIED, probeInk, REFERENCE, UNEXPECTED, UNSETTLED } from './change-detection'
export type { Annotation, Component, Panel, LabelledComponents, LabelOptions as ComponentLabelOptions, MergedBox, RegionInk, RegionInkOptions } from './change-detection'
export { checkboxesFromMasks } from './checkbox-reading'
export { buildMasks, measureRegion, OVERLAY_DIFFERENT, OVERLAY_SHARED, paintOverlay } from './region-comparison'
export type { Masks } from './region-comparison'

// --- Enhancement: even lighting, white paper, dark ink - for the reader, never the evidence ---

export { enhancePages, enhanceScan } from './scan-enhancement'
export type { EnhancedImage, EnhancedPage, EnhancePagesOptions, EnhanceResult, EnhanceScanOptions } from './scan-enhancement'
export type { AppliedEnhancement, EnhanceOptions, SharpenOptions } from './illumination-correction'
export { DEFAULT_ENHANCE_OPTIONS, enhanceRaster, estimateContrastPoints, resolveContrastPoints, sharpenRaster } from './illumination-correction'
export type { ContrastPoints, EnhancedRaster } from './illumination-correction'
export { despeckle, estimateNoiseSigma } from './noise-reduction'

// --- Content search: whether what must be on a page is there, and where the original puts it ---

export { findContent } from './content-search'
export type { ContentResult, ExpectedContent, FindOptions, FindReport, FoundBy, Occurrence, PageFind } from './content-search'
export { approximateSearch, bestMatch, wordSpan } from './approximate-search'
export type { ApproximateMatch, SearchOptions } from './approximate-search'

// --- The audit: the reading and the pixels merged into one verdict, its evidence, and its calibration ---

export { auditPages, DEFAULT_MIN_TEXT_SCORE } from './page-audit'
export type { AuditedPage, AuditOptions, AuditReport, PageAudit, Verdict } from './page-audit'
export type { AuditFinding, ExplainedDifference, FindingKind } from './finding-correlation'
export { combineSummaries, summariseAudit, writeEvidenceCover, writeEvidencePdf } from './evidence-document'
export type { EvidencePdfOptions, EvidenceSummary, SummarisedPage } from './evidence-document'
export { calibrateAudit, DEFAULT_CALIBRATION_GRID, documentPasses, sampleAudit } from './audit-calibration'
export type { CalibrationGrid, CalibrationLabel, CalibrationPoint, CalibrationReport, CalibrationSample, CalibrationThresholds, SampledFinding, SampledPage } from './audit-calibration'
export { correlateFindings } from './finding-correlation'
export type { Correlation, CorrelationInput } from './finding-correlation'
export { INK_EVIDENCE, QUORUM, SETTLEMENT_PASSES, settleDisputes } from './dispute-settlement'
export type { Settlement, SettlementInput } from './dispute-settlement'
export { renderEvidence, TEXT_DIFFERENCE } from './audit-evidence'

// --- Every type the stages speak ---
//
// A session's options and results are the stages' own types, so a caller of
// this package alone must be able to name them without adding each stage to
// their manifest. Type-only, so erased before anything runs: re-exporting them
// loads nothing, and a session that never reads a page never touches the reader.
//
// Five names are spoken by two stages in different senses, and are renamed here
// so that both can be reached: ink's and diff's `LabelOptions`, align's and
// ocr's `MatchOptions`, and ocr's per-word `Verdict` beside audit's verdict on a
// page. `Rgba` is ink's, which diff only passes on.

export type {
  AlignedImage, AlignedPage, BinaryImage, Bleed, ContentExtent, DecodeOptions, DocumentOptions, EncodeOptions,
  GrayImage, ImageFormat, ImageMetadata, ImageWithResolution, InkOptions, Interpolation,
  LabelOptions as DrawLabelOptions, Matrix3, NormaliseOptions, PageImage, PageRegion, PdfTextRun,
  PipelineStage, Point, PointMatch, ProgressCallback, Raster, ReadablePage, ResampleOptions, ResolvedBleed,
  Rgba, ScanmateBinarySource, ScanmateOrientedRect, ScanmateRect, ScanmateSource, ScanOptions, ScanPage,
  SimulatedScan, SkewOptions, StageEvent, SyntheticDocument, TextRun, TransformModel, TransformSummary,
  WarpOptions,
} from '@scanmate/ink'
export type {
  AnchorCorner, AnchorMatch, DocumentInfo, DocumentInspection, DpiChoice, DpiLimits, EmbeddedImage,
  ExtractedPage, ExtractOptions, ExtractPairOptions, FieldOffset, FieldSpec, InspectedPage, InspectOptions,
  LocatablePage, LocatedAnchor, LocatedFields, LocateOptions, LocationProblem, OpenedPdf, PageKind,
  PageMetadata, PagePairing, PageSelection, PairedDocument, PairedPage, RenderOptions, SyntheticImage,
  SyntheticLine, SyntheticPdfPage, SyntheticText, TextLayer,
} from '@scanmate/extract'
export type {
  AlignDiagnostics, AlignOptions, AlignPagesOptions, AlignResult, CoarseOptions, CoarseResult, Correspondence,
  FeatureOptions, FeatureSet, Keypoint, MatchOptions as FeatureMatchOptions, ModelAttempt,
  PhaseCorrelationResult, RansacOptions, RansacResult, ScoredModel,
} from '@scanmate/align'
export type {
  CellOptions, Claims, MatchOptions as WordMatchOptions, OcrEngine, OcrLine, OcrOptions, OcrReport, OcrWord,
  PageOcr, PlacedText, PrintAbstention, PrintCheck, PrintPolarity, PrintVerification, ReadPage, Recheck,
  RecheckOptions, RecheckPass, RecognisedText, RecogniseHints, Reference, RunReading, ScoreMetric, SideText,
  Templates, TemplateStore, TesseractCacheOptions, TesseractEngine, TesseractEngineOptions, TesseractSettings,
  TextDifference, TextMetrics, Verdict as WordVerdict, VerifyOptions, WordMatch,
} from '@scanmate/ocr'
export type {
  Affine, Embedding, MarkOptions, MarkResult, MergedPage, MergeOptions, MergeResult, OpenPdfOptions,
  PageGeometry, PageMark, PageSize, Placement, ResolvedSource, SourceKind,
} from '@scanmate/merge'
export type { SealReport, SignatureCheck, SignatureProblem, Signer } from '@scanmate/seal'

// --- The kernel's runtime, so a type this package hands out can also be made ---

/**
 * Everything above re-exports `@scanmate/ink`'s *types*, and for a long time
 * only its types: a caller could name a `SyntheticDocument`, a `Raster` or a
 * `Matrix3` through this front door and then had to add `@scanmate/ink` to
 * their own manifest to build one. That is not a door, it is a window.
 *
 * It costs nothing to fix. `ink` is not a lazily loaded stage - this package
 * imports it as a value in thirty-odd files, so anything that imports
 * `@scanmate/scan` has already loaded ink and `sharp`. These names were
 * reachable at runtime all along; they were simply not spelled out.
 *
 * The rule is the one already implied by the type list: **if this package
 * re-exports a type, it re-exports the runtime that makes and uses it.** What
 * is deliberately left out is the numerical plumbing ink documents as
 * "consumed by `@scanmate/align`" - the eigen solvers, the FFT, the seeded
 * PRNG. Those belong to a stage, not to a caller, and a caller who genuinely
 * wants them should depend on ink and say so.
 */

/** Images: the shapes, their constructors, and the codec. */
export { blurRaster, cloneRaster, countPages, createBinary, createGray, createRaster, decodeImage, encodeImage, isRaster, readImageMetadata, resampleRaster } from '@scanmate/ink'

/** Ink: greyscale to ink, ink to mask. */
export { binarize, boxBlur, coverage, dilate, grayToRaster, inkMap, integralImage, otsuThreshold, toGrayscale } from '@scanmate/ink'

/** Resampling and the warp the alignment applies. */
export { boxBlurRaster, downscaleGray, resizeGray, sampleGrayBilinear, warpGray, warpRaster } from '@scanmate/ink'

/** Geometry: the transform, and the shapes it moves. */
export {
  applyPoint, conjugateScale, decompose, determinant, IDENTITY, invert, isPlausible, mapRectCorners,
  multiply, normalize, rebase, reprojectionError, scaling, similarity, translation,
} from '@scanmate/ink'

/** Measurement, bleed and text normalisation. */
export { contentExtent, correlation, DEFAULT_BLEED, DEFAULT_NORMALISE, diacriticsMap, estimateSkew, foldConfusables, foldDiacritics, growBy, hasBleed, intersectionOverUnion, mean, normaliseText, profileSharpness, resolveBleed, resolveRegionBleed, tokenise } from '@scanmate/ink'

/**
 * Synthesis: a document, a scan of it, and the strokes to mark either.
 *
 * Ink calls these test fixtures, and they are - but a fixture is exactly what
 * a consumer's own end-to-end tests need, and building a forged digit or a
 * signature written into a field is the same job whichever repository asks.
 */
export { createSyntheticDocument, drawLabel, drawLine, drawSignature, drawTick, fillRect, labelSize, simulateScan, strokeRect } from '@scanmate/ink'

// --- Building blocks ---

export { MissingStageError, loadedStages } from './stage-loading'
export { fingerprint } from './stage-caching'
export { LazyEngine, SharedEngine } from './reading-engine'
export type { EngineLease } from './reading-engine'
