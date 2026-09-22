/**
 * `@scanmate/ink` - the pixel and geometry kernel the rest of ScanMate is built on.
 *
 * ## The two shapes
 *
 * Everything here speaks {@link Raster} (8-bit RGBA, the layout a canvas
 * `ImageData` uses) or {@link GrayImage} (one float per pixel). Float, not byte,
 * because the pipeline divides by an estimated background and then correlates the
 * result; doing that in 8 bits throws away the faint strokes that OCR cares about.
 *
 * ## Why the algorithms are hand-written
 *
 * `sharp` owns the codec, and stops there. It cannot express the 8-DOF
 * homography {@link warpGray} is built for, it cannot render onto a fixed output
 * canvas, it has no image-by-image division so no {@link inkMap}, no Otsu, and no
 * clipped-area box mean - and it has no synchronous API, while every estimator
 * below runs in a synchronous hot loop. So the boundary is exactly the codec, and
 * the numerics stay here.
 *
 * ## Naming
 *
 * Paths follow the workspace ADR: capability -> subfeature -> flat role-suffixed
 * files. The one documented departure is that this package's subfeatures are named
 * for a *pixel concern* rather than a business outcome, because a kernel has no
 * business outcome. See the ADR exception note in the README.
 */

// --- Images: the shapes, their constructors, and the codec ---

export { cloneRaster, createBinary, createGray, createRaster, isRaster } from './raster-codec'
export type { BinaryImage, GrayImage, ImageWithResolution, Raster, Rgba, ScanmateBinarySource, ScanmateSource } from './raster-codec'

/**
 * The codec: libvips through sharp, so asynchronous. Roughly 20x faster at
 * encoding a page than the pure-JavaScript codec it replaces, and the only path
 * that reads TIFF, HEIF, WebP or AVIF or honours EXIF orientation.
 */
export { blurRaster, countPages, decodeImage, encodeImage, readImageMetadata, resampleRaster } from './raster-codec'
export type { DecodeOptions, EncodeOptions, ImageFormat, ImageMetadata, ResampleOptions } from './raster-codec'

// --- Ink: greyscale to ink, ink to mask ---

export { binarize, boxBlur, coverage, dilate, grayToRaster, inkMap, integralImage, otsuThreshold, toGrayscale } from './ink-separation'
export type { InkOptions } from './ink-separation'

// --- Resampling ---

export { boxBlurRaster, downscaleGray, resizeGray, sampleGrayBilinear, warpGray, warpRaster } from './geometric-transform'
export type { Interpolation, WarpOptions } from './geometric-transform'

// --- Geometry: the transform, and the shapes it moves ---

export {
  applyPoint,
  conjugateScale,
  decompose,
  determinant,
  IDENTITY,
  invert,
  isPlausible,
  mapRectCorners,
  multiply,
  normalize,
  rebase,
  reprojectionError,
  scaling,
  similarity,
  translation,
} from './plane-geometry'
export type { Matrix3, Point, PointMatch, ScanmateOrientedRect, ScanmateRect, TransformModel, TransformSummary } from './plane-geometry'

/** Linear algebra behind the model fitters. Consumed by `@scanmate/align`. */
export { jacobiEigen, smallestEigenvector, solve } from './plane-geometry'

// --- Measurement ---

export { correlation, intersectionOverUnion, mean } from './similarity-scoring'
export { contentExtent, estimateSkew, profileSharpness } from './content-geometry'
export type { ContentExtent, SkewOptions } from './content-geometry'

/** FFT behind phase correlation. Consumed by `@scanmate/align`. */
export { fft1d, fft2d, isPowerOfTwo, nextPowerOfTwo } from './frequency-analysis'

/** Seeded PRNG behind RANSAC sampling and the BRIEF pattern. Consumed by `@scanmate/align`. */
export { createRandom, gaussian } from './deterministic-sampling'

// --- Pipeline contracts: what the stages hand one another ---

export type { AlignedImage, AlignedPage, PageImage, PageRegion, PdfTextRun, PipelineStage, ProgressCallback, ReadablePage, ScanPage, StageEvent, TextRun } from './pipeline-contract'
export { DEFAULT_BLEED, growBy, hasBleed, resolveBleed } from './region-bleed'
export { DEFAULT_NORMALISE, diacriticsMap, foldConfusables, foldDiacritics, normaliseText, tokenise } from './text-normalisation'
export type { NormaliseOptions } from './text-normalisation'
export type { Bleed, ResolvedBleed } from './region-bleed'

// --- Test fixtures, also useful for smoke-testing a deployment ---

export { createSyntheticDocument, drawSignature, drawTick, simulateScan } from './synthetic-document'
export type { DocumentOptions, ScanOptions, SimulatedScan, SyntheticDocument } from './synthetic-document'

/** Drawing primitives for building fixtures. Consumed by sibling specs and the pixel comparison. */
export { drawLabel, drawLine, fillRect, labelSize, strokeRect } from './synthetic-document'
export type { LabelOptions } from './synthetic-document'
