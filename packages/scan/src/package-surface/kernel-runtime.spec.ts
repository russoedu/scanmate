import * as scan from '../index'

/**
 * That a type this package hands out can also be made through it.
 *
 * `@scanmate/scan` is documented as the front door, and for a long time it was
 * a window: every `@scanmate/ink` *type* was re-exported and none of the
 * runtime, so a caller could name a `SyntheticDocument` or a `Raster` here and
 * still had to add `@scanmate/ink` to their own manifest to build one. A
 * consumer's end-to-end tests found it - forging a digit and writing a
 * signature into a field needs `createRaster`, `drawSignature`, `warpRaster`
 * and `applyPoint`, and none of them were reachable.
 *
 * Named one by one rather than counted, so a failure says what went missing.
 */

const SHAPES = ['createRaster', 'cloneRaster', 'createGray', 'createBinary', 'isRaster'] as const
const CODEC = ['decodeImage', 'encodeImage', 'readImageMetadata', 'resampleRaster', 'blurRaster', 'countPages'] as const
const INK = ['binarize', 'boxBlur', 'coverage', 'dilate', 'grayToRaster', 'inkMap', 'integralImage', 'otsuThreshold', 'toGrayscale'] as const
const WARP = ['warpRaster', 'warpGray', 'boxBlurRaster', 'downscaleGray', 'resizeGray', 'sampleGrayBilinear'] as const
const GEOMETRY = ['applyPoint', 'invert', 'multiply', 'scaling', 'similarity', 'translation', 'decompose', 'determinant', 'normalize', 'rebase', 'conjugateScale', 'isPlausible', 'mapRectCorners', 'reprojectionError'] as const
const MEASURE = ['contentExtent', 'estimateSkew', 'profileSharpness', 'correlation', 'intersectionOverUnion', 'mean', 'growBy', 'hasBleed', 'resolveBleed', 'resolveRegionBleed'] as const
const TEXT = ['normaliseText', 'tokenise', 'foldDiacritics', 'foldConfusables'] as const
const SYNTHESIS = ['createSyntheticDocument', 'simulateScan', 'drawSignature', 'drawTick', 'drawLabel', 'drawLine', 'fillRect', 'strokeRect', 'labelSize'] as const

describe("the kernel's runtime, through the front door", () => {
  it.each([
    ['image shapes', SHAPES], ['the codec', CODEC], ['ink separation', INK], ['resampling and warps', WARP],
    ['geometry', GEOMETRY], ['measurement and bleed', MEASURE], ['text normalisation', TEXT], ['synthesis', SYNTHESIS],
  ])('exports %s', (_group, names) => {
    const missing = names.filter(name => typeof (scan as Record<string, unknown>)[name] !== 'function')

    expect(missing).toStrictEqual([])
  })

  it('exports the constants beside them', () => {
    expect(scan.IDENTITY).toBeDefined()
    expect(scan.DEFAULT_BLEED).toBeDefined()
    expect(scan.DEFAULT_NORMALISE).toBeDefined()
    expect(scan.diacriticsMap).toBeDefined()
  })

  it('leaves the numerics that belong to a stage to that stage', () => {
    // Ink documents these as consumed by `@scanmate/align`: the eigen solvers,
    // the FFT, the seeded PRNG. A caller who genuinely wants them should depend
    // on ink and say so, rather than find them here by accident.
    const internal = ['jacobiEigen', 'smallestEigenvector', 'solve', 'fft1d', 'fft2d', 'isPowerOfTwo', 'nextPowerOfTwo', 'createRandom', 'gaussian']
    const exported = new Set(Object.keys(scan))
    const leaked = internal.filter(name => exported.has(name))

    expect(leaked).toStrictEqual([])
  })
})
