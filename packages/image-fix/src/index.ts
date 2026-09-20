/**
 * `@scanmate/image-fix` - **deprecated**. Use the focused packages instead.
 *
 * This package has been split. Every export below still works and still means
 * what it meant, but it now comes from one of:
 *
 * | What you used | Where it lives now |
 * |---|---|
 * | `alignScan`, `polishTranslation`, and the estimator building blocks | `@scanmate/align` |
 * | `compareRegions`, `diffDocument`, `renderDiff` | `@scanmate/diff` |
 * | rasters, ink, warps, matrices, scoring, synthetic fixtures | `@scanmate/ink` |
 *
 * Nothing here is a permanent forwarding layer - this barrel exists so the split
 * is not a breaking change on the day it lands, and it will be removed.
 *
 * @deprecated Import from `@scanmate/align`, `@scanmate/diff` or `@scanmate/ink`.
 */

// --- Re-exported from @scanmate/align and @scanmate/diff, unchanged ---

export {
  alignScan,
  detectAndDescribe,
  estimateCoarse,
  findInliers,
  fitAffine,
  fitHomography,
  fitModel,
  fitSimilarity,
  hamming,
  matchFeatures,
  minimumSamples,
  phaseCorrelate,
  polishTranslation,
  popcount,
  ransac,
} from '@scanmate/align'
export type {
  AlignDiagnostics,
  AlignOptions,
  AlignResult,
  CoarseOptions,
  CoarseResult,
  Correspondence,
  FeatureOptions,
  FeatureSet,
  Keypoint,
  MatchOptions,
  PhaseCorrelationResult,
  RansacOptions,
  RansacResult,
} from '@scanmate/align'

export { compareRegions, diffDocument, renderDiff } from '@scanmate/diff'
export type { DocumentDiff, Region, RegionOptions, RegionReport } from '@scanmate/diff'

// --- Re-exported from @scanmate/ink, unchanged ---

export {
  applyPoint,
  binarize,
  boxBlur,
  boxBlurRaster,
  cloneRaster,
  conjugateScale,
  contentExtent,
  correlation,
  coverage,
  createBinary,
  createGray,
  createRaster,
  createSyntheticDocument,
  decodeImage,
  decompose,
  determinant,
  dilate,
  downscaleGray,
  drawSignature,
  drawTick,
  encodeImage,
  estimateSkew,
  grayToRaster,
  IDENTITY,
  inkMap,
  intersectionOverUnion,
  invert,
  isPlausible,
  isRaster,
  mapRectCorners,
  mean,
  multiply,
  normalize,
  otsuThreshold,
  rebase,
  reprojectionError,
  resizeGray,
  sampleGrayBilinear,
  scaling,
  similarity,
  simulateScan,
  toGrayscale,
  translation,
  warpGray,
  warpRaster,
} from '@scanmate/ink'

export type {
  BinaryImage,
  ContentExtent,
  DocumentOptions,
  EncodeOptions,
  GrayImage,
  ImageFormat,
  ScanmateSource,
  InkOptions,
  Interpolation,
  Matrix3,
  Point,
  PointMatch,
  Raster,
  ScanmateRect,
  ScanOptions,
  SimulatedScan,
  SkewOptions,
  SyntheticDocument,
  TransformModel,
  TransformSummary,
  WarpOptions,
} from '@scanmate/ink'
