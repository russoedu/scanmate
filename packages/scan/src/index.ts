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
 * Each stage runs what it needs, remembers what it did, and is loaded only when
 * it is used: a session that only aligns never evaluates tesseract or a PDF
 * library. The stages remain usable on their own - this is the convenient door,
 * not the only one.
 */

export { Scanmate } from './scan-session'
export type { AlignedScanmatePage, EnhancedScanmatePage, ReadableScanmatePage, ScanmateOptions, ScanmatePageReport } from './scan-session'
export type { ScanmateDocument, ScanmatePage } from './document-input'
export type { CalibrateOptions, CalibrationCase, CorpusCalibration } from './corpus-calibration'

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
  AppliedEnhancement, ContrastPoints, EnhancedImage, EnhancedPage, EnhancedRaster, EnhanceOptions,
  EnhancePagesOptions, EnhanceResult, EnhanceScanOptions, SharpenOptions,
} from '@scanmate/enhance'
export type {
  CellOptions, Claims, MatchOptions as WordMatchOptions, OcrEngine, OcrLine, OcrOptions, OcrReport, OcrWord,
  PageOcr, PlacedText, PrintAbstention, PrintCheck, PrintPolarity, PrintVerification, ReadPage, Recheck,
  RecheckOptions, RecheckPass, RecognisedText, RecogniseHints, Reference, RunReading, ScoreMetric, SideText,
  Templates, TemplateStore, TesseractCacheOptions, TesseractEngine, TesseractEngineOptions, TesseractSettings,
  TextDifference, TextMetrics, Verdict as WordVerdict, VerifyOptions, WordMatch,
} from '@scanmate/ocr'
export type {
  Annotation, Change, Checkbox, CheckboxOptions, CheckboxReading, CheckboxSide, CheckboxState, ComparedPage,
  Component, CoordinateUnits, DiffOptions, DocumentDiff, ExpectedChange, ExpectedResult, InkProbe,
  LabelledComponents, LabelOptions as ComponentLabelOptions, Masks, MergedBox, PageDiff, Panel, ProbeRect,
  Region, RegionInk, RegionInkMetrics, RegionInkOptions, RegionOptions, RegionReport,
} from '@scanmate/diff'
export type {
  ApproximateMatch, ContentResult, ExpectedContent, FindOptions, FindReport, FoundBy, Occurrence, PageFind,
  SearchOptions,
} from '@scanmate/find'
export type {
  Affine, Embedding, MarkOptions, MarkResult, MergedPage, MergeOptions, MergeResult, OpenPdfOptions,
  PageGeometry, PageMark, PageSize, Placement, ResolvedSource, SourceKind,
} from '@scanmate/merge'
export type {
  AuditedPage, AuditFinding, AuditOptions, AuditReport, CalibrationGrid, CalibrationLabel, CalibrationPoint,
  CalibrationReport, CalibrationSample, CalibrationThresholds, Correlation, CorrelationInput,
  ExplainedDifference, FindingKind, PageAudit, SampledFinding, SampledPage, Settlement, SettlementInput,
  Verdict,
} from '@scanmate/audit'

// --- Building blocks ---

export { MissingStageError, loadedStages } from './stage-loading'
export { fingerprint } from './stage-caching'
export { SharedEngine } from './reading-engine'
export type { EngineLease } from './reading-engine'
