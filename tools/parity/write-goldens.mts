/**
 * Writes the golden values the Python port is measured against.
 *
 * The goldens are produced by running the REAL TypeScript build, never by
 * restating the algorithm here — a golden written by hand only proves that two
 * copies of the same misunderstanding agree. Each package's built `dist` is the input, so
 * this must run after a build.
 *
 * Determinism is the whole point: `scanmate-ink` is a parallel port, and the
 * only useful definition of "correct" is that it produces the same numbers as
 * the TypeScript it parallels, bit for bit. Where a value is a float, the
 * goldens carry its full round-trippable decimal form, because a port that is
 * right to six places and wrong in the last bit will diverge the moment the
 * value is fed back into the generator.
 *
 * `npm run parity:goldens` writes them; `npm run parity:check` regenerates and
 * diffs, so drift in the TypeScript fails CI rather than being discovered when
 * a Python test mysteriously starts failing.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDENTITY,
  createRandom,
  createBinary,
  createGray,
  createSyntheticDocument,
  createRaster,
  decodeImage,
  decompose,
  drawLabel,
  drawLine,
  drawSignature,
  drawTick,
  downscaleGray,
  encodeImage,
  estimateSkew,
  fillRect,
  foldConfusables,
  foldDiacritics,
  fft1d,
  fft2d,
  gaussian,
  growBy,
  hasBleed,
  invert,
  isPlausible,
  labelSize,
  isPowerOfTwo,
  jacobiEigen,
  mapRectCorners,
  multiply,
  nextPowerOfTwo,
  normaliseText,
  normalize,
  readImageMetadata,
  DEFAULT_BLEED,
  rebase,
  reprojectionError,
  resolveBleed,
  resolveRegionBleed,
  similarity,
  simulateScan,
  smallestEigenvector,
  solve,
  strokeRect,
  tokenise,
  binarize,
  boxBlur,
  boxBlurRaster,
  coverage,
  contentExtent,
  DEFAULT_NORMALISE,
  correlation,
  diacriticsMap,
  dilate,
  grayToRaster,
  inkMap,
  integralImage,
  intersectionOverUnion,
  mean,
  otsuThreshold,
  profileSharpness,
  resizeGray,
  sampleGrayBilinear,
  toGrayscale,
  warpGray,
  warpRaster,
} from '../../packages/ink/dist/index.esm.js'
import type { Bleed, GrayImage, Matrix3, Raster, ScanOptions, TransformModel } from '../../packages/ink/dist/src/index.d.ts'
import {
  alignScan,
  prefers,
  estimateCoarse,
  detectAndDescribe,
  hamming,
  matchFeatures,
  popcount,
  phaseCorrelate,
  findInliers,
  fitAffine,
  fitHomography,
  fitModel,
  fitSimilarity,
  minimumSamples,
  ransac,
} from '../../packages/align/dist/index.esm.js'
import type { Correspondence } from '../../packages/align/dist/src/index.d.ts'

const here = dirname(fileURLToPath(import.meta.url))
const goldenDir = join(here, 'goldens')

/**
 * Seeds chosen to cover the edges of the 32-bit state, not just "some numbers":
 * zero, one, an arbitrary mid value, a large one, and both 32-bit boundaries.
 * mulberry32 is `state = (state + 0x6D2B79F5) >>> 0`, so the wrap at 2^32 is
 * the behaviour a port is most likely to get wrong.
 */
const SEEDS = [0, 1, 42, 123_456_789, 2_147_483_647, 4_294_967_295]

/** How many draws per seed. Enough to walk past the first wrap for the large seeds. */
const DRAWS = 8

const prng: Record<string, number[]> = {}
for (const seed of SEEDS) {
  const random = createRandom(seed)
  prng[String(seed)] = Array.from({ length: DRAWS }, () => random())
}

/**
 * Box-Muller draws two uniforms per value, so its goldens also pin that the
 * port consumes the generator in the same ORDER — a port that swapped `u` and
 * `v` would still look like a Gaussian and never match.
 */
const boxMuller: Record<string, number[]> = {}
for (const seed of [1, 42]) {
  const random = createRandom(seed)
  boxMuller[String(seed)] = Array.from({ length: 6 }, () => gaussian(random))
}

mkdirSync(goldenDir, { recursive: true })
writeFileSync(
  join(goldenDir, 'prng.json'),
  `${JSON.stringify({ createRandom: prng, gaussian: boxMuller }, undefined, 2)}\n`,
)
process.stdout.write(`wrote ${join(goldenDir, 'prng.json')}\n`)

/*
 * The raster goldens. The page is BUILT from the PRNG rather than read from a
 * fixture, because no binary fixtures exist in this repository - so the input
 * is reproducible from a seed, and the Python port can rebuild the identical
 * page with the generator it has already been proved to match.
 *
 * Only what survives the crossing is pinned. PNG is lossless and libvips and
 * Pillow agree on it byte for byte - measured, on this very page. Resize and
 * blur do NOT agree: Pillow's LANCZOS differs from libvips' lanczos3 on 78.8%
 * of pixels, and libvips' blur is an integer APPROXIMATION of a Gaussian
 * rather than a Gaussian, differing on 100%. They are deliberately absent
 * rather than pinned to numbers a port could only meet by accident.
 */
const RASTER_WIDTH = 64
const RASTER_HEIGHT = 48
const RASTER_SEED = 20_260_923

const page = createRaster(RASTER_WIDTH, RASTER_HEIGHT)
const pixelRandom = createRandom(RASTER_SEED)
for (let offset = 0; offset < page.data.length; offset += 4) {
  page.data[offset] = Math.floor(pixelRandom() * 256)
  page.data[offset + 1] = Math.floor(pixelRandom() * 256)
  page.data[offset + 2] = Math.floor(pixelRandom() * 256)
  page.data[offset + 3] = 255
}

const png = await encodeImage(page, { format: 'png' })
const decoded = await decodeImage(png)
if (Buffer.compare(Buffer.from(page.data), Buffer.from(decoded.data)) !== 0) {
  throw new Error('PNG did not round-trip in the TypeScript - the goldens would be meaningless')
}

writeFileSync(
  join(goldenDir, 'raster.json'),
  JSON.stringify({
    seed:      RASTER_SEED,
    width:     RASTER_WIDTH,
    height:    RASTER_HEIGHT,
    pixels:    [...page.data],
    pngBase64: Buffer.from(png).toString('base64'),
    metadata:  await readImageMetadata(png),
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'raster.json') + '\n')

/*
 * The plane-geometry goldens.
 *
 * Two kinds of value, and the split is the point. Everything built from
 * additions, multiplications and divisions alone is reproducible EXACTLY in
 * Python. Everything that reaches for hypot, atan2, cos or log is not:
 * measured across 169 argument pairs, Python and V8 disagree by at most one
 * unit in the last place on each of those, so those goldens are compared to
 * within 1 ULP rather than exactly. The Python tests carry that distinction
 * per function rather than applying one blanket tolerance.
 */
const A: Matrix3 = [2, 0.5, -3, 0.25, 1.5, 7, 0.001, -0.002, 1]
const B: Matrix3 = [0.9, -0.1, 4, 0.2, 1.1, -6, 0.0005, 0.0015, 1]

const geometrySeed = createRandom(77_777)
const symmetric = (n: number): number[] => {
  const raw = Array.from({ length: n * n }, () => geometrySeed() * 2 - 1)
  const out = Array.from({ length: n * n })
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) out[r * n + c] = raw[r * n + c] + raw[c * n + r]
  }

  return out
}

const ASSOC_A: Matrix3 = [1, 1e16, -1e16, 0, 1, 0, 0, 0, 1]
const ASSOC_B: Matrix3 = [1, 0, 0, 1, 0, 0, 1, 0, 1]

const solveA = [4, -2, 1, -2, 4, -2, 1, -2, 4]
const solveB = [11, -16, 17]
const symmetric4 = symmetric(4)
const symmetric6 = symmetric(6)
const eigen4 = jacobiEigen(Float64Array.from(symmetric4), 4)

// Hoisted out of the object literal below: inlining them nests calls four deep,
// which `unicorn/max-nested-calls` rejects, and named steps read better anyway.
const solved = solve(Float64Array.from(solveA), Float64Array.from(solveB), 3)
const singularA = Float64Array.from([1, 2, 2, 4])
const singularB = Float64Array.from([1, 2])
const symmetric6Input = Float64Array.from(symmetric6)
const corners = mapRectCorners(A, { x: 3, y: 5, width: 40, height: 25 })

writeFileSync(
  join(goldenDir, 'plane-geometry.json'),
  JSON.stringify({
    exact: {
      multiply:       multiply(A, B),
      invert:         invert(A),
      normalize:      normalize([2, 4, 6, 8, 10, 12, 14, 16, 2]),
      rebase:         rebase(A, 0.25, 0.5),
      mapRectCorners: corners.map(p => [p.x, p.y]),
      solve:          [...(solved ?? [])],
      solveSingular:  solve(singularA, singularB, 2) === null,
      jacobiValues:   [...eigen4.values],
      jacobiVectors:  [...eigen4.vectors],
      smallestEigen:  [...smallestEigenvector(symmetric6Input, 6)],
    },
    withinOneUlp: {
      similarity:        similarity(1.25, 0.31, { x: 100, y: 200 }, { x: 310, y: 90 }),
      decompose:         decompose(A, 'homography'),
      reprojectionError: reprojectionError(A, { x: 11, y: 13 }, { x: 17, y: 19 }),
      isPlausible:       [A, B, [1, 0, 0, 0, -1, 0, 0, 0, 1], [1e9, 0, 0, 0, 1e9, 0, 0, 0, 1]].map(
        m => isPlausible(m as Matrix3),
      ),
    },
    /*
     * A pair chosen so that floating-point ASSOCIATION matters: the first term
     * of the product is 1 + 1e16 + -1e16, which is 0 summed left to right and
     * 1 summed right to left. Without it the exact-equality assertions pass
     * just as happily on a reassociated `multiply` - measured, by reversing
     * that sum and watching all 84 tests stay green. This is the input that
     * makes `==` mean "the same operation order" rather than "the same maths".
     */
    associativity: {
      inputs:  [ASSOC_A, ASSOC_B],
      product: multiply(ASSOC_A, ASSOC_B),
    },
    inputs: { A, B, solveA, solveB, symmetric4, symmetric6 },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'plane-geometry.json') + '\n')

/*
 * The ink-separation goldens.
 *
 * `GrayImage` is a Float32Array, and that is the whole difficulty: every stage
 * computes in float64 and ROUNDS TO FLOAT32 on store. A port that keeps
 * everything in float64, or that lets numpy carry float32 through the
 * arithmetic instead of only at the store, diverges immediately - so the
 * goldens carry the stored float32 values, and the Python compares with `==`.
 *
 * The page is the same PRNG-built one the raster goldens use, so nothing here
 * needs a fixture either.
 */
const inkPage = createRaster(RASTER_WIDTH, RASTER_HEIGHT)
const inkRandom = createRandom(RASTER_SEED)
for (let offset = 0; offset < inkPage.data.length; offset += 4) {
  inkPage.data[offset] = Math.floor(inkRandom() * 256)
  inkPage.data[offset + 1] = Math.floor(inkRandom() * 256)
  inkPage.data[offset + 2] = Math.floor(inkRandom() * 256)
  // Vary alpha too, so the compositing over white is actually exercised.
  inkPage.data[offset + 3] = offset % 37 === 0 ? 128 : 255
}

const gray = toGrayscale(inkPage)
const integral = integralImage(gray)
const blurred = boxBlur(gray, 3)
const ink = inkMap(gray)
const threshold = otsuThreshold(ink)
const mask = binarize(ink)
const dilated = dilate(mask, 2)

writeFileSync(
  join(goldenDir, 'ink-separation.json'),
  JSON.stringify({
    width:          RASTER_WIDTH,
    height:         RASTER_HEIGHT,
    seed:           RASTER_SEED,
    alphaEvery:     37,
    gray:           [...gray.data],
    integral:       [...integral],
    boxBlurRadius3: [...blurred.data],
    boxBlurRadius0: [...boxBlur(gray, 0).data],
    inkMap:         [...ink.data],
    grayToRaster:   [...grayToRaster(gray).data],
    otsuThreshold:  threshold,
    binarize:       [...mask.data],
    dilateRadius2:  [...dilated.data],
    coverageAll:    coverage(mask),
    coverageWindow: coverage(mask, 5.4, 6.7, 40.2, 30.9),
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'ink-separation.json') + '\n')

/*
 * The geometric-transform goldens.
 *
 * Unlike the codec's resize, THIS resampler is scanmate's own - plain
 * arithmetic on typed arrays, not libvips - so it can be, and is, matched bit
 * for bit. That distinction is the reason `resample_raster` is deliberately
 * absent from the Python raster codec while `resize_gray` is fully ported.
 *
 * Both resize branches are pinned in one file: `ratio > 1` takes the
 * area-average path and `ratio <= 1` the bilinear one, and `resizeGray` picks
 * per axis, so the mixed case below exercises both inside a single call.
 *
 * The warps pin all three interpolations, the prefilter on both sides of its
 * `sqrt(|det|) > 1.25` threshold, and the background fill that a destination
 * pixel falling outside the source gets.
 */
const MINIFYING: Matrix3 = [2.1, 0.1, 3, -0.15, 2.05, 5, 0.0004, -0.0002, 1]
const MAGNIFYING: Matrix3 = [0.4, 0.02, 1, -0.03, 0.42, 2, 0, 0, 1]
/*
 * Shifted left far enough that roughly the left half of the destination reaches
 * outside the source. Without it the background and fill goldens pin NOTHING -
 * measured, by counting how many pixels of the first attempt actually carried
 * the fill: zero of 1200, for both the raster background and the gray fill.
 */
const PARTLY_OUTSIDE: Matrix3 = [0.4, 0.02, -8, -0.03, 0.42, 2, 0, 0, 1]
/* Every `w` is zero, so every destination pixel takes the early background branch. */
const DEGENERATE: Matrix3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
const WARP_WIDTH = 40
const WARP_HEIGHT = 30

const shrunk = resizeGray(gray, 21, 17)
const grown = resizeGray(gray, 100, 60)
const mixed = resizeGray(gray, 20, 90)
const identity = resizeGray(gray, RASTER_WIDTH, RASTER_HEIGHT)
const downscaled = downscaleGray(gray, 20)
const untouched = downscaleGray(gray, 1000)

const warpedGray = warpGray(gray, MINIFYING, WARP_WIDTH, WARP_HEIGHT)
const warpedGrayFilled = warpGray(gray, PARTLY_OUTSIDE, WARP_WIDTH, WARP_HEIGHT, 0.25)
const warpedGrayDegenerate = warpGray(gray, DEGENERATE, WARP_WIDTH, WARP_HEIGHT, 0.75)

/*
 * Sample positions chosen for their EDGES rather than their interiors: one
 * dead centre, one on a pixel centre, one in each corner's clamped half-pixel,
 * and four outside - because `sampleGrayBilinear` returns `fill` on `<= -1`
 * and `>= width`, and an off-by-one in either bound is invisible anywhere else.
 */
const SAMPLES: Array<[number, number]> = [
  [0, 0], [-0.5, -0.5], [-1, -1], [-0.999, 3.5], [31.5, 23.5],
  [63, 47], [63.5, 47.5], [64, 48], [12.25, 9.75], [0.5, 47.999],
  /*
   * Three positions found by SEARCH, not by taste: at each of them
   * `p * (1 - fx) * (1 - fy)` and `p * ((1 - fx) * (1 - fy))` - the same
   * algebra, bracketed the two ways this file's two bilinear readers bracket
   * it - give different doubles. Without them a port that unified the two
   * readers into one helper matched every golden above.
   */
  [31.786540314351058, 26.014375547501146],
  [38.589995069200938, 2.0652743741850181],
  [2.2478575627365567, 24.199774552754402],
]

/*
 * A strong downscale on ONE axis, because this is the only shape tried where
 * the area average's ACCUMULATION ORDER survives to the output. Summing the
 * overlap terms pairwise instead of left to right agrees exactly at the four
 * and five terms the other goldens produce; at the eight that 64 -> 9 produces
 * it disagrees on 91 of 432 samples in float64, and on 1 of them after the
 * narrowing to float32. The height is deliberately left at 48: a second area
 * pass down the columns averages that one sample away again, which is why
 * 9x9 - the obvious choice - pins nothing.
 */
const STRONG_SHRINK_WIDTH = 9
const STRONG_SHRINK_HEIGHT = 48

/* Rounds to 13 rather than 12.5, and to a realised scale of 0.325 rather than the requested 0.3125. */
const ROUNDING_SENSITIVE = resizeGray(gray, 40, 64)

/* u lands on exactly `x + 0.5` at every pixel, where Math.round and round-half-to-even part company. */
const HALFWAY: Matrix3 = [1, 0, 0.5, 0, 1, 0.5, 0, 0, 1]
/* sqrt(|det|) is exactly 4, so the prefilter radius is round(1.5) = 2 rather than round(3) = 3. */
const STRONGLY_MINIFYING: Matrix3 = [4, 0, 1, 0, 4, 1, 0, 0, 1]
const SMALL_WIDTH = 16
const SMALL_HEIGHT = 12

const roundingSensitive = downscaleGray(ROUNDING_SENSITIVE, 20)
const strongShrink = resizeGray(gray, STRONG_SHRINK_WIDTH, STRONG_SHRINK_HEIGHT)

writeFileSync(
  join(goldenDir, 'geometric-transform.json'),
  JSON.stringify({
    matrices:   { minifying: MINIFYING, magnifying: MAGNIFYING, partlyOutside: PARTLY_OUTSIDE, degenerate: DEGENERATE, halfway: HALFWAY, stronglyMinifying: STRONGLY_MINIFYING },
    warpWidth:  WARP_WIDTH,
    warpHeight: WARP_HEIGHT,
    resizeGray: {
      shrink:   { width: 21, height: 17, data: [...shrunk.data] },
      grow:     { width: 100, height: 60, data: [...grown.data] },
      mixed:    { width: 20, height: 90, data: [...mixed.data] },
      identity: [...identity.data],
      strong:   { width: STRONG_SHRINK_WIDTH, height: STRONG_SHRINK_HEIGHT, data: [...strongShrink.data] },
    },
    downscaleGray: {
      to20:              { width: downscaled.image.width, height: downscaled.image.height, scale: downscaled.scale, data: [...downscaled.image.data] },
      untouched:         { width: untouched.image.width, height: untouched.image.height, scale: untouched.scale },
      roundingSensitive: { sourceWidth: 40, sourceHeight: 64, width: roundingSensitive.image.width, height: roundingSensitive.image.height, scale: roundingSensitive.scale, data: [...roundingSensitive.image.data] },
    },
    boxBlurRaster: {
      radius2: [...boxBlurRaster(inkPage, 2).data],
      radius0: [...boxBlurRaster(inkPage, 0).data],
    },
    sampleGrayBilinear: SAMPLES.map(([u, v]) => [u, v, sampleGrayBilinear(gray, u, v), sampleGrayBilinear(gray, u, v, -7)]),
    warpGray:           {
      minifying:             [...warpedGray.data],
      partlyOutsideWithFill: [...warpedGrayFilled.data],
      degenerateWithFill:    [...warpedGrayDegenerate.data],
    },
    warpRaster: {
      bilinear:            [...warpRaster(inkPage, MINIFYING, WARP_WIDTH, WARP_HEIGHT).data],
      bilinearNoPrefilter: [...warpRaster(inkPage, MINIFYING, WARP_WIDTH, WARP_HEIGHT, { prefilter: false }).data],
      nearest:             [...warpRaster(inkPage, MAGNIFYING, WARP_WIDTH, WARP_HEIGHT, { interpolation: 'nearest' }).data],
      bicubic:             [...warpRaster(inkPage, MAGNIFYING, WARP_WIDTH, WARP_HEIGHT, { interpolation: 'bicubic' }).data],
      background:          [...warpRaster(inkPage, PARTLY_OUTSIDE, WARP_WIDTH, WARP_HEIGHT, { background: [7, 11, 13, 17] }).data],
      degenerate:          [...warpRaster(inkPage, DEGENERATE, WARP_WIDTH, WARP_HEIGHT, { background: [7, 11, 13, 17] }).data],
      nearestHalfway:      [...warpRaster(inkPage, HALFWAY, WARP_WIDTH, WARP_HEIGHT, { interpolation: 'nearest' }).data],
      stronglyMinifying:   { width: SMALL_WIDTH, height: SMALL_HEIGHT, data: [...warpRaster(inkPage, STRONGLY_MINIFYING, SMALL_WIDTH, SMALL_HEIGHT).data] },
    },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'geometric-transform.json') + '\n')

/*
 * The frequency-analysis goldens - the ONLY ones in this file that a port
 * cannot match exactly, and the reason is worth recording rather than
 * tolerating.
 *
 * The FFT is additions, multiplications and divisions except for its twiddle
 * bases, which are `Math.cos` and `Math.sin` of `+/- 2 * PI / len`. That is 24
 * distinct values for every size up to 4096, and 23 of them agree with Python
 * to the last bit. The exception is `sin(+/- PI / 4)`: V8 returns
 * -0.7071067811865475 where the correctly rounded double is
 * -0.7071067811865476, so V8 is the one that is 1 ULP wrong and the port is
 * the one that is right. Every transform of 8 or more points runs a `len = 8`
 * stage, whose twiddle RECURRENCE then multiplies that error forward into
 * every later stage.
 *
 * So these goldens are compared to a measured bound rather than with `==`, and
 * the Python test states the bound it measured. `angles` is carried so the
 * test can check the twiddle bases themselves rather than inferring the
 * disagreement from a whole transform.
 */
const FFT_SIZES = [1, 2, 4, 8, 16, 64]
const fftRandom = createRandom(31_337)
const fftInput = (n: number): { re: number[], im: number[] } => ({
  re: Array.from({ length: n }, () => fftRandom() * 2 - 1),
  im: Array.from({ length: n }, () => fftRandom() * 2 - 1),
})

const transforms: Record<string, unknown> = {}
for (const n of FFT_SIZES) {
  const input = fftInput(n)
  const re = Float64Array.from(input.re)
  const im = Float64Array.from(input.im)
  fft1d(re, im)

  const backRe = Float64Array.from(re)
  const backIm = Float64Array.from(im)
  fft1d(backRe, backIm, true)

  transforms[String(n)] = {
    input,
    forward:   { re: [...re], im: [...im] },
    roundTrip: { re: [...backRe], im: [...backIm] },
  }
}

/* Non-square, and deliberately not square-transposed either, so a port that swapped width and height fails. */
const FFT_WIDTH = 8
const FFT_HEIGHT = 16
const planar = fftInput(FFT_WIDTH * FFT_HEIGHT)
const planeRe = Float64Array.from(planar.re)
const planeIm = Float64Array.from(planar.im)
fft2d(planeRe, planeIm, FFT_WIDTH, FFT_HEIGHT)
const planeBackRe = Float64Array.from(planeRe)
const planeBackIm = Float64Array.from(planeIm)
fft2d(planeBackRe, planeBackIm, FFT_WIDTH, FFT_HEIGHT, true)

const twiddleAngles: Array<[number, number, number, number, number]> = []
for (let len = 2; len <= 4096; len <<= 1)
  for (const sign of [-1, 1]) {
    const angle = (sign * 2 * Math.PI) / len
    twiddleAngles.push([len, sign, angle, Math.cos(angle), Math.sin(angle)])
  }

writeFileSync(
  join(goldenDir, 'frequency-analysis.json'),
  JSON.stringify({
    nextPowerOfTwo: [0, 1, 2, 3, 5, 9, 17, 100, 1000, 4096, 4097].map(n => [n, nextPowerOfTwo(n)]),
    isPowerOfTwo:   [-4, -1, 0, 1, 2, 3, 4, 6, 8, 1024, 1025].map(n => [n, isPowerOfTwo(n)]),
    twiddleAngles,
    fft1d:          transforms,
    fft2d:          {
      width:     FFT_WIDTH,
      height:    FFT_HEIGHT,
      input:     planar,
      forward:   { re: [...planeRe], im: [...planeIm] },
      roundTrip: { re: [...planeBackRe], im: [...planeBackIm] },
    },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'frequency-analysis.json') + '\n')

/*
 * The similarity-scoring goldens.
 *
 * Everything here is a SEQUENTIAL accumulation over every pixel - `sum += x`
 * across 3072 of them - and that is the whole parity risk. `np.sum` reduces
 * pairwise, which is more accurate and a different number, so the Python has
 * to accumulate in running order to match. These goldens are what proves it
 * did, and the pairs below are chosen to span the range rather than to look
 * plausible: a self-correlation that must be exactly 1, an inverted image that
 * must be exactly -1, a flat image with no variance at all, and two genuinely
 * different images in between.
 */
const inverted = createGray(RASTER_WIDTH, RASTER_HEIGHT)
for (let i = 0; i < gray.data.length; i++) inverted.data[i] = 1 - gray.data[i]

const flat = createGray(RASTER_WIDTH, RASTER_HEIGHT)
flat.data.fill(0.5)

const blurredGray = boxBlur(gray, 3)

/*
 * Barely-varying: 0.5 everywhere except one pixel moved by a single float32
 * step. Its variance is 3.55e-15, safely under the 1e-12 floor, so this is the
 * input that distinguishes the floor from a plain `denom > 0` test - with the
 * floor it scores 0, without it the two identical images score 1.
 */
const nearFlat = createGray(RASTER_WIDTH, RASTER_HEIGHT)
nearFlat.data.fill(0.5)
nearFlat.data[0] = Math.fround(0.5) + Math.pow(2, -24)
const scoringWarp = warpGray(gray, MINIFYING, RASTER_WIDTH, RASTER_HEIGHT)
const emptyGray = { width: 0, height: 0, data: new Float32Array(0) }

const dilatedMask = dilate(mask, 2)
const invertedMask = createBinary(RASTER_WIDTH, RASTER_HEIGHT)
for (let i = 0; i < mask.data.length; i++) invertedMask.data[i] = mask.data[i] === 0 ? 1 : 0
const emptyMask = createBinary(RASTER_WIDTH, RASTER_HEIGHT)

writeFileSync(
  join(goldenDir, 'similarity-scoring.json'),
  JSON.stringify({
    correlation: {
      selfSame:     correlation(gray, gray),
      inverted:     correlation(gray, inverted),
      blurred:      correlation(gray, blurredGray),
      ink:          correlation(gray, ink),
      warped:       correlation(gray, scoringWarp),
      flatSecond:   correlation(gray, flat),
      /*
       * Cross pairs with genuinely UNEQUAL variances, because `sqrt(a * b)`
       * and `sqrt(a) * sqrt(b)` differ on about a third of random pairs and
       * the self-similar cases above happened to dodge every one of them.
       */
      inkBlurred:   correlation(ink, blurredGray),
      invertedInk:  correlation(inverted, ink),
      blurredWarp:  correlation(blurredGray, scoringWarp),
      nearFlatSelf: correlation(nearFlat, nearFlat),
      flatBoth:     correlation(flat, flat),
      empty:        correlation(emptyGray, emptyGray),
    },
    intersectionOverUnion: {
      selfSame: intersectionOverUnion(mask, mask),
      dilated:  intersectionOverUnion(mask, dilatedMask),
      inverted: intersectionOverUnion(mask, invertedMask),
      empty:    intersectionOverUnion(emptyMask, emptyMask),
      maskOnly: intersectionOverUnion(mask, emptyMask),
    },
    mean: {
      gray:     mean(gray),
      ink:      mean(ink),
      inverted: mean(inverted),
      flat:     mean(flat),
      nearFlat: mean(nearFlat),
      empty:    mean(emptyGray),
    },
    /* Carried so the Python can rebuild the exact second operands rather than trusting its own. */
    operands: {
      inverted: [...inverted.data],
      blurred:  [...blurredGray.data],
      warped:   [...scoringWarp.data],
      nearFlat: [...nearFlat.data],
      dilated:  [...dilatedMask.data],
    },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'similarity-scoring.json') + '\n')

/*
 * The content-geometry goldens - the riskiest in this file, and the reason is
 * a `Math.floor` rather than anything about the arithmetic.
 *
 * Both functions project ink into integer bins by flooring a product of a
 * coordinate with `Math.cos` or `Math.sin` of an arbitrary angle. Those two
 * are NOT correctly rounded, so Python and V8 can differ in the last bit, and
 * a floor turns a last-bit difference into a whole bin. `estimateSkew` then
 * takes an argmax over those scores, which can turn one flipped bin into a
 * different answer entirely. Nothing about that is gradual.
 *
 * So the input is a page with a REAL skew rather than the noise page the other
 * goldens use: stripes of ink laid down at a known slope, which give the
 * argmax a clear peak instead of a field of near-ties. A near-tie is exactly
 * the situation where a one-bin difference would change the result, and
 * measuring parity against one would be measuring luck.
 *
 * `sharpness` carries the score at every angle the search actually visits, so
 * the Python can be checked angle by angle rather than only on the answer -
 * if they ever diverge, this says at which angle and by how much.
 */
const STRIPE_SLOPE = 0.1
const STRIPE_PERIOD = 6
const skewed = createGray(RASTER_WIDTH, RASTER_HEIGHT)
for (let y = 0; y < RASTER_HEIGHT; y++)
  for (let x = 0; x < RASTER_WIDTH; x++) {
    const band = Math.floor((y - STRIPE_SLOPE * x) / STRIPE_PERIOD)
    skewed.data[y * RASTER_WIDTH + x] = band % 3 === 0 ? 0.85 : 0
  }

const TO_RAD = Math.PI / 180
const visitedDegrees: number[] = []
for (let deg = -12; deg <= 12; deg += 1) visitedDegrees.push(deg)
const coarseBest = 6
for (const [span, step] of [[1, 0.2], [0.2, 0.04]] as const)
  for (let deg = coarseBest - span; deg <= coarseBest + span + 1e-9; deg += step)
    visitedDegrees.push(deg)

/*
 * A blank page scores exactly zero at EVERY angle, which is the only input
 * that makes the argmax's tie-breaking visible. `score > bestScore` keeps the
 * first angle tried and returns -12 degrees; `>=` would keep the last and
 * return +12. On any page with real ink the scores differ and both rules agree,
 * so without this the comparison could be flipped unnoticed.
 */
const blankPage = createGray(RASTER_WIDTH, RASTER_HEIGHT)

const skewOfSkewed = estimateSkew(skewed)
const skewOfInk = estimateSkew(ink)

writeFileSync(
  join(goldenDir, 'content-geometry.json'),
  JSON.stringify({
    stripe: { slope: STRIPE_SLOPE, period: STRIPE_PERIOD, data: [...skewed.data] },
    /* Every angle the two-stage search visits, and what cos/sin gave for it. */
    angles: visitedDegrees.map(deg => [
      deg, deg * TO_RAD, Math.cos(deg * TO_RAD), Math.sin(deg * TO_RAD),
    ]),
    sharpness: {
      skewed: visitedDegrees.map(deg => profileSharpness(skewed, deg * TO_RAD)),
      ink:    visitedDegrees.map(deg => profileSharpness(ink, deg * TO_RAD)),
    },
    estimateSkew: {
      skewed:      skewOfSkewed,
      skewedDeg:   skewOfSkewed / TO_RAD,
      ink:         skewOfInk,
      narrowRange: estimateSkew(skewed, { maxAngleDeg: 2 }),
      blank:       estimateSkew(blankPage),
      blankDeg:    estimateSkew(blankPage) / TO_RAD,
    },
    contentExtent: {
      inkUnrotated:  contentExtent(ink),
      inkAtSkew:     contentExtent(ink, skewOfInk),
      skewedAtSkew:  contentExtent(skewed, skewOfSkewed),
      skewedNoTrim:  contentExtent(skewed, 0, 0),
      skewedBigTrim: contentExtent(skewed, 0, 0.2),
      /* A zeroed image takes the nothing-printed branch: the whole frame, density 0. */
      blank:         contentExtent(blankPage),
    },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'content-geometry.json') + '\n')

/*
 * The region-bleed goldens. No floating point anywhere in this slice, so
 * nothing here is about the last bit - it is about one operator.
 *
 * Every side is chosen with `??`, which falls through on null and undefined
 * and NOT on zero. Python's `or` falls through on zero too, so a port written
 * the obvious way turns "no room on this side" into "the default six points"
 * and silently widens every region that asked for none. Most of the cases
 * below exist to make that substitution fail: a zero in every position where
 * one can legally appear.
 */
const bleedBase = resolveBleed({ bleed: 5, bleedBottom: 11 })
const bleedCases: Array<[string, Bleed, number | undefined]> = [
  ['empty', {}, undefined],
  ['fallbackOnly', {}, 10],
  ['allZero', { bleed: 0 }, undefined],
  ['allZeroOverFallback', { bleed: 0 }, 10],
  ['sidedOverAll', { bleed: 4, bleedBottom: 14 }, undefined],
  ['zeroTopOverFallback', { bleedTop: 0 }, 5],
  ['zeroSideOverAll', { bleed: 7, bleedRight: 0 }, undefined],
  ['allBeatsFallback', { bleed: 3 }, 99],
  ['everySideNamed', { bleedTop: 1, bleedRight: 2, bleedBottom: 3, bleedLeft: 4 }, 99],
  ['fallbackZero', {}, 0],
]
const regionCases: Array<[string, Bleed]> = [
  ['emptyRegion', {}],
  ['regionAllZero', { bleed: 0 }],
  ['regionZeroLeft', { bleedLeft: 0 }],
  ['regionSidedOverAll', { bleed: 2, bleedTop: 9 }],
  ['regionAllOnly', { bleed: 8 }],
  ['regionEverySide', { bleedTop: 0, bleedRight: 0, bleedBottom: 0, bleedLeft: 0 }],
]

const rejected = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return (error as Error).message
  }

  return 'DID NOT THROW'
}

const bleedRect = { x: 12, y: 30, width: 100, height: 40 }

/*
 * Hoisted rather than nested inside the object literal below: `growBy` of
 * `resolveBleed` of a literal is three calls deep, which the lint rejects, and
 * naming each one says what it is for.
 */
const uniformSides = resolveBleed()
const zeroSides = resolveBleed({ bleed: 0 })
/*
 * Four DISTINCT sides. Every other `growBy` case here is symmetric left to
 * right, so a port widening by `left + left` instead of `left + right` matched
 * all of them - measured, by making exactly that change and watching all 32
 * tests stay green.
 */
const asymmetricSides = resolveBleed({ bleedTop: 1, bleedRight: 17, bleedBottom: 9, bleedLeft: 3 })
const oneSideSides = resolveBleed({ bleed: 0, bleedTop: 1 })
const lastSideSides = resolveBleed({ bleed: 0, bleedLeft: 1 })

const resolvedCases = bleedCases.map(([name, bleed, fallback]) => {
  const resolved = fallback === undefined ? resolveBleed(bleed) : resolveBleed(bleed, fallback)

  return [name, { bleed, fallback, resolved }] as const
})
const resolvedRegionCases = regionCases.map(([name, region]) => {
  const resolved = resolveRegionBleed(region, bleedBase)

  return [name, { region, resolved }] as const
})

writeFileSync(
  join(goldenDir, 'region-bleed.json'),
  JSON.stringify({
    defaultBleed:       DEFAULT_BLEED,
    base:               bleedBase,
    resolveBleed:       Object.fromEntries(resolvedCases),
    resolveRegionBleed: Object.fromEntries(resolvedRegionCases),
    /* The message names the FIRST offending side, in top/right/bottom/left order. */
    rejects:            {
      negativeAll:    rejected(() => resolveBleed({ bleed: -1 })),
      negativeSide:   rejected(() => resolveBleed({ bleedBottom: -0.5 })),
      notFinite:      rejected(() => resolveBleed({ bleed: Infinity })),
      notANumber:     rejected(() => resolveBleed({ bleedLeft: NaN })),
      negativeRegion: rejected(() => resolveRegionBleed({ bleedRight: -2 }, bleedBase)),
      twoBadSides:    rejected(() => resolveBleed({ bleedRight: -1, bleedLeft: -2 })),
    },
    growBy: {
      rect:       bleedRect,
      uniform:    growBy(bleedRect, uniformSides),
      sided:      growBy(bleedRect, bleedBase),
      zero:       growBy(bleedRect, zeroSides),
      asymmetric: growBy(bleedRect, asymmetricSides),
    },
    hasBleed: {
      uniform:  hasBleed(uniformSides),
      zero:     hasBleed(zeroSides),
      oneSide:  hasBleed(oneSideSides),
      lastSide: hasBleed(lastSideSides),
    },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'region-bleed.json') + '\n')

/*
 * The text-normalisation goldens.
 *
 * The corpus is adversarial on purpose. Each entry targets a specific way the
 * two languages disagree rather than a plausible sentence, because a plausible
 * sentence is exactly where a port looks right: JavaScript's `\s` and
 * Python's are different sets in BOTH directions, `\p{L}` has no equivalent
 * in Python's `re` at all, and the two runtimes are on different Unicode
 * versions - and not consistently so: CPython is on 15.1, the Node that
 * generated these was on 16.0, and CI's Node is on 17.0. They agree on every
 * value here regardless, across that 16-to-17 gap included.
 *
 * `runtime` also carries what V8 itself produced for `toLowerCase` and NFKC on
 * every entry, so the Python can check the two RUNTIMES against each other
 * rather than inferring a disagreement from a whole pipeline.
 */
const U = (...codes: number[]): string => String.fromCodePoint(...codes)

/*
 * The corpus is adversarial on purpose. Each entry targets a specific way the
 * two languages disagree rather than a plausible sentence - plausible
 * sentences are where a port looks right.
 */
const CORPUS = {
  plain:            '  The  Quick  Brown  FOX  ',
  nbsp:             `a${U(0xA0)}b`,
  bom:              `x${U(0x200B)}y${U(0xFEFF)}z`,
  zwj:              `a${U(0x200D)}b${U(0x200C)}c${U(0x2060)}d`,
  pythonOnlySpace:  `a${U(0x1C)}b${U(0x85)}c`,
  lineSeparators:   `a${U(0x2028)}b${U(0x2029)}c`,
  ogham:            `a${U(0x1680)}b`,
  ligature:         `${U(0xFB01)}ne ${U(0xFB02)}ag`,
  fullWidth:        `${U(0xFF21)}${U(0xFF22)}${U(0xFF43)}`,
  circled:          `${U(0x24B6)}${U(0x24D0)}`,
  accents:          `caf${U(0xE9)} ${U(0xC6)}ther na${U(0xEF)}ve`,
  sharpS:           `Stra${U(0xDF)}e GRO${U(0x1E9E)}`,
  turkishDotted:    `${U(0x130)}stanbul ${U(0x131)}`,
  quotes:           `${U(0x2018)}q${U(0x2019)} ${U(0x201C)}d${U(0x201D)} ${U(0x2032)}p${U(0x2033)}`,
  dashes:           `a${U(0x2010)}b${U(0x2013)}c${U(0x2014)}d${U(0x2212)}e`,
  ellipsis:         `wait${U(0x2026)}now`,
  hyphenWrap:       'informa-\ntion',
  hyphenWrapCrLf:   'informa-\r\ntion',
  hyphenWrapSpaces: 'informa-  \n  tion',
  softHyphenWrap:   `informa${U(0xAD)}\ntion`,
  hyphenBeforeCaps: 'wrap-\nPing',
  hyphenAfterDigit: '5-\nx',
  hyphenNoBreak:    'in-line',
  noise:            'a | b ___ c ~ . 5',
  currency:         `${U(0x24)}5 ${U(0xA3)}6 ${U(0x20AC)}7 ${U(0xA5)}8`,
  /* BARE signs: every token above also carries a digit, so they survive even without Sc. */
  bareCurrency:     `${U(0x24)} ${U(0xA3)} ${U(0x20AC)} ${U(0xA5)}`,
  /* U+0085 at BOTH EDGES: whitespace to Python, not to JavaScript, so a final
   * `strip()` on Python's set would trim what JavaScript keeps. */
  pythonSpaceEdges: `${U(0x85)}edge${U(0x85)}`,
  numbers:          '1,250.00 and 3.14',
  romanNumeral:     `${U(0x2160)}${U(0x2161)}`,
  fractionVulgar:   `${U(0xBD)} cup`,
  confusable:       'rn1 cli vv0 5ale |8 !6 2ip',
  empty:            '',
  onlyNoise:        ' | ___ ~~ ',
  onlySpace:        `  ${U(0xA0)}${U(0x3000)} `,
  mixedScript:      `Hello ${U(0x41F)}${U(0x440)}${U(0x438)} 123`,
  combining:        `e${U(0x301)}cole`,
  emoji:            `a ${U(0x1F600)} b`,
}

const VARIANTS = {
  defaults:         {},
  noNfkc:           { nfkc: false },
  noTypography:     { typography: false },
  noDehyphenate:    { dehyphenate: false },
  noDiacritics:     { diacritics: false },
  noCase:           { caseFold: false },
  noDropNoise:      { dropNoise: false },
  stripPunctuation: { stripPunctuation: true },
  confusables:      { confusables: true },
  everythingOff:    {
    nfkc:        false,
    typography:  false,
    dehyphenate: false,
    diacritics:  false,
    caseFold:    false,
    dropNoise:   false,
  },
  everythingOn: { stripPunctuation: true, confusables: true },
}

const normalised: Record<string, Record<string, string>> = {}
const tokenised: Record<string, Record<string, string[]>> = {}
for (const [variant, options] of Object.entries(VARIANTS)) {
  normalised[variant] = {}
  tokenised[variant] = {}
  for (const [name, text] of Object.entries(CORPUS)) {
    normalised[variant][name] = normaliseText(text, options)
    tokenised[variant][name] = tokenise(text, options)
  }
}

/*
 * `c1` and `c!` are the only entries here that pin PAIRS-before-SINGLES.
 * Measured: `rn1` and `cli` - the obvious choices - fold to `ml` and `dl`
 * under either order. `c1` folds to `cl` when the pairs run first and to `d`
 * when the singles do, because the single turns the `1` into an `l` and
 * manufactures a `cl` that was never in the text.
 *
 * The order AMONG the pairs, by contrast, does not matter at all - checked
 * exhaustively over every string up to length five in the alphabet they
 * touch, zero differ - so nothing here pretends to pin it.
 */
const CONFUSABLE_ONLY = [
  'rn', 'cl', 'vv', 'rn1', 'cli', 'vvi', '0o', '1l', 'i|!', '586', '2z', 'rnrn', 'ccll',
  'c1', 'c!', 'c1c1',
]
const DIACRITIC_ONLY = [
  `caf${U(0xE9)}`, U(0xC6), U(0x1F1), U(0xFF21), U(0x24B6), U(0x152), U(0x1E9E), `e${U(0x301)}`,
]

/*
 * Hoisted out of the object literal below: each is a `fromEntries` of a `map`
 * of a call, one level past what the lint allows - and naming them says what
 * each is for anyway.
 */
const corpusEntries = Object.entries(CORPUS)
const foldedConfusables = Object.fromEntries(CONFUSABLE_ONLY.map(t => [t, foldConfusables(t)]))
const foldedDiacritics = Object.fromEntries(DIACRITIC_ONLY.map(t => [t, foldDiacritics(t)]))
const lowerCasedCorpus = Object.fromEntries(corpusEntries.map(([n, t]) => [n, t.toLowerCase()]))
const nfkcCorpus = Object.fromEntries(corpusEntries.map(([n, t]) => [n, t.normalize('NFKC')]))

writeFileSync(
  join(goldenDir, 'text-normalisation.json'),
  JSON.stringify({
    defaults:        DEFAULT_NORMALISE,
    corpus:          CORPUS,
    variants:        VARIANTS,
    normaliseText:   normalised,
    tokenise:        tokenised,
    foldConfusables: foldedConfusables,
    foldDiacritics:  foldedDiacritics,
    diacriticsMap:   [...diacriticsMap()],
    /*
     * What V8 itself produced, so the Python can check the two RUNTIMES against
     * each other rather than inferring a disagreement from a whole pipeline.
     *
     * `process.versions.unicode` used to be here and is deliberately gone. A
     * golden has to be a function of the SOURCE, not of the host: the machine
     * that last regenerated these reports Unicode 16.0 and CI's Node reports
     * 17.0, so recording it made `parity:check` fail everywhere except the one
     * machine. Caught on the guard's first CI run.
     *
     * Nothing is lost by dropping it. Every value below is IDENTICAL under
     * both versions - measured, by that same failure, which changed exactly
     * one line out of the whole file - so the agreement these pin is the
     * substantive claim and the version string was only a label on it.
     */
    runtime:         {
      lowerCased: lowerCasedCorpus,
      nfkc:       nfkcCorpus,
    },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'text-normalisation.json') + '\n')

/*
 * The pipeline-contract goldens.
 *
 * This slice is types and nothing else, so there are no values to compare -
 * the types are erased before anything runs. What CAN drift is the SHAPE: a
 * field added to a TypeScript interface and forgotten on the Python dataclass
 * would break nothing here and everything downstream.
 *
 * So the members are read out of the emitted `.d.ts` files, which are the
 * build's own statement of what each interface holds. Extracted rather than
 * listed by hand for the same reason the diacritics table is generated rather
 * than retyped: a hand-kept list is a second thing to forget.
 *
 * Comments are stripped first, because a doc comment for a field mentions the
 * field's own name and would otherwise be read as a member of it.
 */
const contractDir = join(here, '..', '..', 'packages', 'ink', 'dist', 'src', 'pipeline-contract')
const CONTRACT_FILES = [
  'page-region.contract.d.ts',
  'scan-page.contract.d.ts',
  'stage-event.contract.d.ts',
  'text-run.contract.d.ts',
]

/**
 * Strip block and line comments.
 *
 * Done first because a doc comment for a field mentions the field's own name,
 * and would otherwise be read as a member.
 *
 * @param source - The declaration file's text.
 * @returns The same text with comments blanked out.
 */
function withoutComments (source: string): string {
  let out = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2)
      index = close === -1 ? source.length : close + 2
      continue
    }
    if (source.startsWith('//', index)) {
      const close = source.indexOf('\n', index)
      index = close === -1 ? source.length : close
      continue
    }
    out += source[index]
    index++
  }

  return out
}

/**
 * The balanced `{ ... }` starting at `open`, and where it ends.
 *
 * Scanned rather than matched with a regex because a member can itself be an
 * object type - `baseline?: { x: number, y: number }` - and `[^}]*` stops at
 * the INNER brace. That is not hypothetical: it is what the first version of
 * this did, and it reported `TextRun` as holding a field called `y`.
 *
 * @param source - The text to scan.
 * @param open - Index of the opening brace.
 * @returns The body between the braces, and the index just past the close.
 */
function balanced (source: string, open: number): { body: string, end: number } {
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    if (source[index] === '}') {
      depth--
      if (depth === 0) return { body: source.slice(open + 1, index), end: index + 1 }
    }
  }

  throw new Error('unbalanced braces in a declaration file at ' + String(open))
}

/**
 * How far the brace and parenthesis depth moves over one character.
 *
 * Angle brackets are deliberately NOT counted: an arrow type's `=>` would be
 * read as a closing one, and `ProgressCallback` swallowed its own terminating
 * semicolon when they were.
 *
 * @param character - One character.
 * @returns 1, -1 or 0.
 */
function depthChange (character: string): number {
  if (character === '{' || character === '(') return 1

  return character === '}' || character === ')' ? -1 : 0
}

/**
 * The text from `from` up to the next semicolon at depth zero.
 *
 * @param source - The text to scan.
 * @param from - Where to start.
 * @returns The text, not including the semicolon.
 */
function untilSemicolon (source: string, from: number): string {
  let depth = 0
  let text = ''
  for (let index = from; index < source.length; index++) {
    const character = source[index]
    depth += depthChange(character)
    if (character === ';' && depth === 0) return text
    text += character
  }

  return text
}

/**
 * Members of one interface body, as `[name, optional]`.
 *
 * Split on semicolons at depth zero only, for the same reason `balanced`
 * exists: a member can itself be an object type.
 *
 * @param body - The text between the interface's braces.
 * @returns Each member's name and whether it is optional.
 */
function membersOf (body: string): Array<[string, boolean]> {
  const found: Array<[string, boolean]> = []
  const terminated = body + ';'
  let depth = 0
  let current = ''
  for (const character of terminated) {
    depth += depthChange(character)
    if (character === ';' && depth === 0) {
      const match = /^\s*(\w+)(\??)\s*:/u.exec(current)
      if (match !== null) found.push([match[1], match[2] === '?'])
      current = ''
    } else {
      current += character
    }
  }

  return found
}

const interfaces: Record<string, { extends: string[], members: Array<[string, boolean]> }> = {}
const aliases: Record<string, string> = {}
for (const file of CONTRACT_FILES) {
  const source = withoutComments(readFileSync(join(contractDir, file), 'utf8'))

  for (const match of source.matchAll(/export interface (\w+)(?:<[^>]*>)?\s*(?:extends ([^{]+))?\{/gu)) {
    const { body } = balanced(source, match.index + match[0].length - 1)
    const inherited = match[2] === undefined
      ? []
      : match[2].split(',').map(part => part.trim().replace(/<.*/u, '')).filter(Boolean)

    interfaces[match[1]] = { extends: inherited, members: membersOf(body) }
  }

  for (const match of source.matchAll(/export type (\w+)(?:<[^>]*>)?\s*=/gu))
    aliases[match[1]] = untilSemicolon(source, match.index + match[0].length).replaceAll(/\s+/gu, ' ').trim()
}

writeFileSync(
  join(goldenDir, 'pipeline-contract.json'),
  JSON.stringify({ interfaces, aliases }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'pipeline-contract.json') + '\n')

/*
 * The synthetic-document goldens.
 *
 * A default page is 850x1100, which is 3.7 MB of pixels - too much to commit
 * and far too much to read. So the pixel dumps are of a SMALL page, and the
 * default-sized one is pinned by a SHA-256 of its bytes instead. A hash proves
 * the whole path without shipping it, and the small page is what a failure can
 * actually be debugged against.
 *
 * `drawLine` is the risky one here and not for an obvious reason: its step
 * count is `ceil(hypot(dx, dy)) + 1`, and `hypot` is not correctly rounded.
 * A last-bit difference on an exact integer distance changes the number of
 * steps by one and every stamped square after it, so the goldens include
 * lines whose lengths are exact integers - 3/4/5 and 5/12/13 triangles - and
 * one that is not.
 */
const PAGE_WIDTH = 170
const PAGE_HEIGHT = 220
const sha = (raster: Raster): string => createHash('sha256').update(Buffer.from(raster.data)).digest('hex')

const smallDoc = createSyntheticDocument({ width: PAGE_WIDTH, height: PAGE_HEIGHT })
const defaultDoc = createSyntheticDocument()
const seededDoc = createSyntheticDocument({ width: PAGE_WIDTH, height: PAGE_HEIGHT, seed: 99 })

const signed = createSyntheticDocument({ width: PAGE_WIDTH, height: PAGE_HEIGHT })
drawSignature(signed.raster, signed.regions.signature)
drawTick(signed.raster, signed.regions['tick-2'])

const blank = (): Raster => ({
  width:  40,
  height: 30,
  data:   new Uint8ClampedArray(40 * 30 * 4).fill(255),
})

/* Starts fully TRANSPARENT, so a `fillRect` that forgets the alpha channel shows. */
const transparent = (): Raster => ({
  width:  40,
  height: 30,
  data:   new Uint8ClampedArray(40 * 30 * 4),
})

const filled = blank()
fillRect(filled, { x: 3.4, y: 2.6, width: 10.2, height: 8.9 }, 33)
fillRect(filled, { x: -5, y: -5, width: 12, height: 12 }, 77)
fillRect(filled, { x: 34, y: 24, width: 20, height: 20 }, 11)

const overTransparent = transparent()
fillRect(overTransparent, { x: 4, y: 4, width: 10, height: 8 }, 90)

/*
 * A page whose aspect ratio is NOT the nominal 850:1100. Every other page here
 * is proportional, so `Math.min(width / 850, height / 1100)` and `Math.max` of
 * the same two give the same number and the layout scale could be either.
 */
const wideDoc = createSyntheticDocument({ width: 300, height: 220 })

const stroked = blank()
strokeRect(stroked, { x: 2, y: 2, width: 20, height: 14 }, 3, 44)

/* Two exact-integer distances and one irrational, for the `ceil(hypot)` cliff. */
const LINES: Array<[number, number, number, number, number, number]> = [
  [2, 2, 5, 6, 1, 10],
  [1, 1, 6, 13, 2, 20],
  [0, 0, 39, 29, 1.5, 30],
  [5, 5, 5, 5, 3, 40],
  [30, 5, 5, 25, 2, 50],
]
const lined = LINES.map(([x0, y0, x1, y1, thickness, value]) => {
  const canvas = blank()
  drawLine(canvas, x0, y0, x1, y1, thickness, value)

  return { line: [x0, y0, x1, y1, thickness, value], steps: Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1, data: [...canvas.data] }
})

const SCANS: Array<[string, ScanOptions]> = [
  ['identity', {}],
  ['rotated', { rotationDeg: 4.5 }],
  ['scaledUp', { scale: 1.5 }],
  ['scaledDown', { scale: 0.6 }],
  ['translated', { translateX: 7, translateY: -4 }],
  ['blurred', { blur: 2 }],
  ['lit', { illumination: 0.3 }],
  ['noisy', { noise: 0.05, seed: 2024 }],
  ['everything', { rotationDeg: -3, scale: 1.2, translateX: 5, translateY: 6, blur: 1, illumination: 0.25, noise: 0.03, seed: 7 }],
  ['fixedCanvas', { scale: 2, canvas: { width: 90, height: 70 } }],
]
const scans = Object.fromEntries(SCANS.map(([name, options]) => {
  const result = simulateScan(smallDoc.raster, options)

  return [name, {
    options,
    matrix: result.matrix,
    width:  result.raster.width,
    height: result.raster.height,
    sha:    sha(result.raster),
    data:   result.raster.width * result.raster.height <= 6000 ? [...result.raster.data] : null,
  }]
}))

const LABELS = [
  'Scanmate', 'PAGE 1/3', 'x', '', 'a-b, c: d (e) 100%', "IT'S 50/50", 'unknown éè',
  /*
   * Short enough to FIT the 40px canvas, unlike the one above - which is why
   * that one never exercised the unknown-glyph fallback at all: its accented
   * characters were clipped off the right edge before they were drawn.
   */
  'éx', '~=+',
  /*
   * Uppercases to two characters in both runtimes, so the drawn glyph count
   * and the reported width disagree - which is the TypeScript's behaviour,
   * since `labelSize` measures the ORIGINAL text and `drawLabel` iterates the
   * uppercased one.
   */
  'ßa',
]
const labelled = LABELS.map(text => {
  const canvas = blank()
  const box = drawLabel(canvas, text, { x: 2, y: 3 })

  return { text, box, size: labelSize(text), sizeAtFour: labelSize(text, { scale: 4 }), sha: sha(canvas) }
})

const labelScales = [0, 0.4, 1, 2.5, 3].map(scale => {
  const canvas = blank()
  const box = drawLabel(canvas, 'AB', { x: 1.6, y: 2.4 }, { scale })

  return { scale, box, sha: sha(canvas) }
})

const coloured = blank()
drawLabel(coloured, 'OK', { x: 1, y: 1 }, { scale: 2, color: [10, 200, 30, 128] })

writeFileSync(
  join(goldenDir, 'synthetic-document.json'),
  JSON.stringify({
    small:                   { width: PAGE_WIDTH, height: PAGE_HEIGHT, regions: smallDoc.regions, data: [...smallDoc.raster.data] },
    wide:                    { width: 300, height: 220, regions: wideDoc.regions, sha: sha(wideDoc.raster) },
    seeded:                  { seed: 99, regions: seededDoc.regions, sha: sha(seededDoc.raster) },
    signed:                  { sha: sha(signed.raster) },
    /* The real thing, pinned by hash: 3.7 MB of pixels is not a diff anyone reads. */
    defaultSize:             { width: defaultDoc.raster.width, height: defaultDoc.raster.height, regions: defaultDoc.regions, sha: sha(defaultDoc.raster) },
    fillRect:                [...filled.data],
    fillRectOverTransparent: [...overTransparent.data],
    strokeRect:              [...stroked.data],
    drawLine:                lined,
    simulateScan:            scans,
    drawLabel:               labelled,
    labelScales,
    colouredLabel:           { sha: sha(coloured), data: [...coloured.data] },
  }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'synthetic-document.json') + '\n')

/*
 * The package surface itself.
 *
 * Every other golden here checks that a function AGREES with its TypeScript
 * counterpart. None of them checks that the counterpart was ported at all - a
 * whole export could be missing and every test in the package would still
 * pass. So the last golden is the surface: every name `@scanmate/ink` exports,
 * read out of its own built `index.d.ts`.
 *
 * The Python side then has to account for each one, either by exporting it or
 * by recording why it does not. Two are deliberately absent and always will
 * be - `resampleRaster` and `blurRaster` go through libvips, and Pillow
 * disagrees with it on 78.8% of pixels - and that absence is a decision worth
 * failing over if it is ever made silently.
 */
/*
 * `dist/index.d.ts` is a one-line re-export stub - `export * from './src/index.js'`
 * - so reading IT finds no named exports at all and this golden collapses to an
 * empty list, which then "passes" against a Python package exporting anything
 * whatsoever. That is what the first version of this did, and `parity:check`
 * caught it on its first real run against a clean build. The declarations are
 * one level down.
 */
const indexSource = withoutComments(
  readFileSync(join(here, '..', '..', 'packages', 'ink', 'dist', 'src', 'index.d.ts'), 'utf8'),
)
const exported = new Set<string>()
for (const match of indexSource.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gu)) {
  const names = match[1].split(',')
  // `a as b` re-exports under a new name; the SOURCE name is the one a port
  // has to provide, so that is what is recorded.
  for (const part of names)
    if (part.trim() !== '') exported.add(part.trim().split(/\s+as\s+/u, 1)[0].trim())
}

writeFileSync(
  join(goldenDir, 'package-surface.json'),
  JSON.stringify({ exports: [...exported].sort((a, b) => a.localeCompare(b)) }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'package-surface.json') + '\n')

/* ===========================================================================
 * Math.hypot
 *
 * Its own golden, because it is its own hazard. `Math.hypot` and CPython's
 * `math.hypot` are different algorithms answering the same question, and they
 * disagree in the last bit on 16% of inputs — CPython is written to be
 * correctly rounded, V8 computes a scaled square root. `numpy.hypot` is a
 * third algorithm again and disagrees on 17%.
 *
 * "More accurate" is still different, and the difference is not cosmetic:
 * `decompose` reports a scale through it, and `isPlausible` GATES on it, so a
 * 1-ULP move can flip an accept into a reject and change which RANSAC
 * candidates survive.
 *
 * This golden exists because the ink goldens had this hole and did not know
 * it: every plane-geometry value agreed, 1,227 Python tests passed, and the
 * divergence only surfaced from `@scanmate/align`'s RANSAC goldens, where a
 * mean over 40 reprojection errors came out one ULP low. The lesson is in the
 * pairs below — they are drawn across the magnitudes a page pipeline actually
 * produces, not the tidy ones a hand-written test reaches for.
 * ========================================================================= */

/** `Infinity` and `NaN` as strings, since JSON has no literal for either. */
function encodeNonFinite (value: number): number | string {
  return Number.isFinite(value) ? value : String(value)
}

/** Magnitudes a page pipeline really sees, plus both ends of the range. */
const HYPOT_SCALES = [1e-8, 1e-3, 1, 10, 1e3, 1e6, 1e12, 1e150, 1e-150]

const hypotRandom = createRandom(20_260_924)
const hypotPairs: [number, number][] = []
for (let i = 0; i < 2000; i++) {
  const sa = HYPOT_SCALES[Math.floor(hypotRandom() * HYPOT_SCALES.length)]
  const sb = HYPOT_SCALES[Math.floor(hypotRandom() * HYPOT_SCALES.length)]
  hypotPairs.push([(hypotRandom() * 2 - 1) * sa, (hypotRandom() * 2 - 1) * sb])
}

/*
 * The edges, named rather than left to the sweep to find: zero (which
 * short-circuits before the scaling divides by it), a single zero component,
 * a negative (the result is a magnitude), equal components (where the scaled
 * sum is exactly 2), and an infinity, which must come back as Infinity rather
 * than the NaN the scaling would otherwise produce.
 */
const HYPOT_EDGES: [number, number][] = [
  [0, 0], [0, 5], [5, 0], [-3, -4], [3, 4], [1, 1],
  [Number.MIN_VALUE, Number.MIN_VALUE],
  [Number.MAX_VALUE, Number.MAX_VALUE],
  [Infinity, 1], [1, Infinity], [Infinity, Infinity],
]

writeFileSync(
  join(goldenDir, 'js-hypot.json'),
  JSON.stringify(
    {
      pairs:  hypotPairs,
      values: hypotPairs.map(([a, b]) => Math.hypot(a, b)),
      /*
       * Encoded, because `JSON.stringify(Infinity)` is `null` and a golden
       * that says `null` where it means Infinity is a golden a port passes by
       * returning the wrong thing. The overflow case is the whole reason the
       * scaling exists, so it is not one to drop.
       */
      edges:  HYPOT_EDGES.map(([a, b]) => ({
        a:     encodeNonFinite(a),
        b:     encodeNonFinite(b),
        hypot: encodeNonFinite(Math.hypot(a, b)),
      })),
      // Three arguments, so a port cannot get away with the two-argument
      // simplification alone: with three summands the Kahan compensation is no
      // longer zero, and `sqrt(x^2 + y^2 + z^2)` parts company with the answer.
      three: [
        { values: [3, 4, 12], hypot: Math.hypot(3, 4, 12) },
        { values: [1e-8, 1e8, 1], hypot: Math.hypot(1e-8, 1e8, 1) },
        { values: [0.1, 0.2, 0.3], hypot: Math.hypot(0.1, 0.2, 0.3) },
      ],
    },
    undefined,
    2,
  ) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'js-hypot.json') + '\n')

/* ===========================================================================
 * @scanmate/align
 *
 * A separate package, so a separate set of goldens and a separate surface
 * file. The fitters are pure numerics over correspondences, which makes them
 * the easiest thing here to pin exactly and the easiest to get subtly wrong —
 * `fitHomography` in particular runs a Jacobi eigen solve whose iteration
 * ORDER decides the last bits of every entry.
 * ========================================================================= */

/*
 * Correspondence sets built from a KNOWN transform, so each fitter is asked a
 * question it should get exactly right and a question it should refuse.
 *
 * Points sit on a deliberately lopsided grid rather than a symmetric one: a
 * port that transposes a matrix, or swaps source and target, still fits a
 * symmetric point cloud plausibly well. An asymmetric one it cannot.
 */
const ALIGN_GRID: readonly (readonly [number, number])[] = [
  [10, 20], [310, 35], [120, 400], [480, 520], [55, 610],
  [640, 90], [275, 250], [700, 700], [15, 730], [590, 305],
]

function through (m: Matrix3, x: number, y: number): { x: number, y: number } {
  const w = m[6] * x + m[7] * y + m[8]

  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w }
}

function correspondences (m: Matrix3, count = ALIGN_GRID.length): Correspondence[] {
  return ALIGN_GRID.slice(0, count).map(([x, y]) => ({ source: { x, y }, target: through(m, x, y) }))
}

/**
 * A similarity: 12 degrees about the middle of the page, scaled 1.04, and the
 * middle landed 37 across and 19 up from where it was.
 *
 * Built with `similarity`'s own four-argument shape (scale, angle, pivot,
 * target) rather than composed out of translations, because that IS the shape
 * the coarse stage hands the fitters, and a pivot away from the origin is what
 * makes the translation column non-trivial.
 */
const SIMILARITY_TRUTH: Matrix3 = similarity(
  1.04,
  (12 * Math.PI) / 180,
  { x: 400, y: 400 },
  { x: 437, y: 381 },
)

/** The similarity above with one axis stretched and sheared: affine, not similarity. */
const AFFINE_TRUTH: Matrix3 = multiply(SIMILARITY_TRUTH, [1.07, 0.031, 0, 0, 0.96, 0, 0, 0, 1])

/** The affine with real perspective in both axes: a full homography. */
const HOMOGRAPHY_TRUTH: Matrix3 = multiply(AFFINE_TRUTH, [1, 0, 0, 0, 1, 0, 0.00021, -0.00014, 1])

const repeated = (count: number): Correspondence[] =>
  Array.from({ length: count }, () => ({ source: { x: 5, y: 5 }, target: { x: 9, y: 2 } }))

const alignFits: Record<string, unknown> = {
  minimumSamples: {
    similarity: minimumSamples('similarity'),
    affine:     minimumSamples('affine'),
    homography: minimumSamples('homography'),
  },
  // Each fitter against the transform it can represent exactly...
  similarityExact:       fitSimilarity(correspondences(SIMILARITY_TRUTH)),
  affineExact:           fitAffine(correspondences(AFFINE_TRUTH)),
  homographyExact:       fitHomography(correspondences(HOMOGRAPHY_TRUTH)),
  // ...and against one it cannot, where the least-squares compromise is itself
  // a number the port has to reproduce.
  similarityOnAffine:    fitSimilarity(correspondences(AFFINE_TRUTH)),
  affineOnHomography:    fitAffine(correspondences(HOMOGRAPHY_TRUTH)),
  // `indices` selects a subset, which is the path RANSAC actually uses. Given
  // out of order, because the fitters must honour the order they are handed.
  similarityFromIndices: fitSimilarity(correspondences(SIMILARITY_TRUTH), [7, 2]),
  affineFromIndices:     fitAffine(correspondences(AFFINE_TRUTH), [9, 0, 4]),
  homographyFromIndices: fitHomography(correspondences(HOMOGRAPHY_TRUTH), [1, 8, 3, 6]),
  // fitModel must dispatch to exactly the same three.
  viaFitModelSimilarity: fitModel('similarity', correspondences(SIMILARITY_TRUTH)),
  viaFitModelAffine:     fitModel('affine', correspondences(AFFINE_TRUTH)),
  viaFitModelHomography: fitModel('homography', correspondences(HOMOGRAPHY_TRUTH)),
  // Refusals. Each returns null for a DIFFERENT reason, and a port that
  // collapses them into one guard passes every happy path above and fails here.
  tooFewForSimilarity:   fitSimilarity(correspondences(SIMILARITY_TRUTH, 1)),
  tooFewForAffine:       fitAffine(correspondences(AFFINE_TRUTH, 2)),
  tooFewForHomography:   fitHomography(correspondences(HOMOGRAPHY_TRUTH, 3)),
  // Every source point identical: zero spread, so similarity's `norm`
  // underflows and homography's Hartley normaliser refuses.
  degenerateSimilarity:  fitSimilarity(repeated(4)),
  degenerateHomography:  fitHomography(repeated(4)),
  // Collinear sources: the affine normal matrix is singular, so `solve` fails.
  collinearAffine:       fitAffine(
    [0, 1, 2, 3].map(i => ({ source: { x: i * 10, y: i * 10 }, target: { x: i * 11, y: i * 9 } })),
  ),
}

/*
 * RANSAC, whose entire answer is a function of the PRNG call sequence. The
 * goldens carry `iterations` alongside the matrix for that reason: a port that
 * draws the same numbers in a different order, or calls `random()` a different
 * number of times per sample, lands somewhere else entirely — and the
 * iteration count says so long before the matrix does.
 */
const OUTLIER_SEED = 0xBADF00D

/** True correspondences, with the first `outliers` of them replaced by nonsense. */
function withOutliers (m: Matrix3, total: number, outliers: number): Correspondence[] {
  const random = createRandom(OUTLIER_SEED)
  const out: Correspondence[] = []
  for (let i = 0; i < total; i++) {
    const x = Math.floor(random() * 800)
    const y = Math.floor(random() * 800)
    const honest = through(m, x, y)
    // Both draws happen for every point, outlier or not, so the set is a pure
    // function of the seed and the two counts — nothing depends on which
    // branch a given index takes.
    const dx = random() * 400 - 200
    const dy = random() * 400 - 200
    out.push(
      i < outliers
        ? { source: { x, y }, target: { x: honest.x + dx, y: honest.y + dy } }
        : { source: { x, y }, target: honest },
    )
  }

  return out
}

const cleanSet = withOutliers(SIMILARITY_TRUTH, 40, 0)
const dirtySet = withOutliers(SIMILARITY_TRUTH, 40, 14)
const hopelessSet = withOutliers(SIMILARITY_TRUTH, 40, 39)

const alignRansac: Record<string, unknown> = {
  clean:            ransac(cleanSet, { model: 'similarity', threshold: 2 }),
  dirty:            ransac(dirtySet, { model: 'similarity', threshold: 2 }),
  // Almost nothing is real, so this must REFUSE rather than return a confident
  // fit to whichever handful of outliers happen to agree.
  hopeless:         ransac(hopelessSet, { model: 'similarity', threshold: 2 }),
  // A different seed walks a different search, and must still land on the
  // right answer from the same input.
  dirtyOtherSeed:   ransac(dirtySet, { model: 'similarity', threshold: 2, seed: 99 }),
  // A tight budget cuts the search short, which pins that the port spends its
  // iterations at the same rate rather than merely reaching the same place.
  // 4, not 12: the unbudgeted search above finishes at 11, so a budget of 12
  // never binds and the golden would be a duplicate of `dirty` that proves
  // nothing. Measured rather than guessed.
  dirtyBudgeted:    ransac(dirtySet, { model: 'similarity', threshold: 2, maxIterations: 4 }),
  // More parameters over the same dirty input: a larger minimal sample takes a
  // different path through the PRNG, and more freedom fits more noise.
  dirtyHomography:  ransac(dirtySet, { model: 'homography', threshold: 2 }),
  dirtyAffine:      ransac(dirtySet, { model: 'affine', threshold: 3 }),
  // A threshold wide enough that everything is an inlier exercises the
  // `ratio >= 1` early exit, which is its own branch.
  everythingFits:   ransac(dirtySet, { model: 'similarity', threshold: 10_000 }),
  // Fewer matches than the model needs at all.
  tooFew:           ransac(cleanSet.slice(0, 1), { model: 'similarity', threshold: 2 }),
  // An explicit floor the best consensus cannot clear.
  unreachableFloor: ransac(dirtySet, { model: 'similarity', threshold: 2, minInliers: 39 }),
  findInliers:      {
    exact: findInliers(cleanSet, SIMILARITY_TRUTH, 1e-6),
    dirty: findInliers(dirtySet, SIMILARITY_TRUTH, 2),
    wide:  findInliers(dirtySet, SIMILARITY_TRUTH, 10_000),
    none:  findInliers(dirtySet, IDENTITY, 0.5),
  },
}

writeFileSync(
  join(goldenDir, 'align-transform-fitting.json'),
  JSON.stringify(
    {
      truth:  { similarity: SIMILARITY_TRUTH, affine: AFFINE_TRUTH, homography: HOMOGRAPHY_TRUTH },
      sets:   { clean: cleanSet, dirty: dirtySet, hopeless: hopelessSet },
      fits:   alignFits,
      ransac: alignRansac,
    },
    undefined,
    2,
  ) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'align-transform-fitting.json') + '\n')

/* ---------------------------------------------------------------------------
 * @scanmate/align: phase correlation
 *
 * This one CANNOT be held to `==` throughout, and the reason is already
 * written down in `packages/ink/src/frequency-analysis`: `sin(±π/4)` differs
 * by one unit in the last place between MSVC's libm (correctly rounded) and
 * glibc's (which agrees with V8), and every transform of eight or more points
 * carries that bit forward through repeated twiddle multiplication. Phase
 * correlation runs two forward transforms and one inverse, so `dx`, `dy` and
 * `peak` all sit on that seam.
 *
 * The golden therefore separates what can be exact from what cannot, and the
 * Python tests treat the two differently. A single loose tolerance over
 * everything would also pass a port that had genuinely lost the plot.
 *
 *   - `cos` below pins the libm seam ON ITS OWN, at exactly the arguments the
 *     Hann window uses. Without it, a `Math.cos` disagreement would be
 *     indistinguishable from the FFT's, and the tolerance would quietly be
 *     covering two faults instead of one.
 *   - Which PIXEL the spike lands on is held to `==` for every case. The
 *     surface only wobbles by a fraction of an ULP, which cannot move which
 *     sample is largest - and if it ever did, the answer would be a whole
 *     pixel out, which no tolerance should ever absorb.
 *   - `dx`, `dy` and `peak` are held to an absolute 1e-12, the same bar the
 *     FFT's own tests use. Measured worst case on Windows: 2.22e-16, one ULP
 *     at this magnitude.
 *
 * An earlier draft of this claimed whole-pixel shifts would be exact on `dx`
 * and `dy`. They are not: the parabolic vertex fires for them too - the
 * windowed, noisy surface is not symmetric about the peak - so `dx` for a
 * requested shift of 7 comes out 7.003108, and carries the seam like
 * everything else. Measured, then corrected.
 * ------------------------------------------------------------------------- */

/** Shifts chosen to cover both regimes, and both signs. */
const PHASE_SHIFTS: readonly { label: string, dx: number, dy: number }[] = [
  { label: 'still', dx: 0, dy: 0 },
  { label: 'right', dx: 7, dy: 0 },
  { label: 'down', dx: 0, dy: 5 },
  { label: 'diagonal', dx: 6, dy: 9 },
  // Negative, which exercises `wrap`: the spike comes back near the far edge
  // and has to be read as a negative shift rather than a large positive one.
  { label: 'back', dx: -4, dy: -3 },
  // Sub-pixel, so the parabolic vertex is doing real work rather than
  // returning 0.
  { label: 'subPixel', dx: 3.4, dy: -2.7 },
  /*
   * NOT included: a shift of exactly half the padded width, which is the one
   * input where `wrap`'s `>` and `>=` differ. It was tried, and this texture
   * repeats every 16 pixels, so a 32-pixel shift aliases onto nothing
   * findable - peak 0.166, answer (8.08, -8.05). A golden that records a
   * meaningless number is worse than no golden. That boundary is pinned by a
   * contract test on `wrap` instead; see the Python side.
   */
]

const PHASE_WIDTH = 64
const PHASE_HEIGHT = 48

/** A page with enough structure that the correlation has a real peak to find. */
function phaseSource (width: number, height: number): GrayImage {
  const image = createGray(width, height)
  const random = createRandom(4_242)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Blocky texture plus a little noise: structured enough to correlate,
      // and the noise breaks the ties a purely periodic pattern would leave
      // all over the correlation surface.
      const block = ((x >> 3) + (y >> 3)) % 2 === 0 ? 0.82 : 0.18
      image.data[y * width + x] = Math.min(1, Math.max(0, block + (random() - 0.5) * 0.2))
    }

  return image
}

/** `source` shifted by (dx, dy), sampled bilinearly so a fractional shift is real. */
function phaseShifted (source: GrayImage, dx: number, dy: number): GrayImage {
  const out = createGray(source.width, source.height)
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++)
      out.data[y * source.width + x] = sampleGrayBilinear(source, x - dx, y - dy)

  return out
}

const phaseBase = phaseSource(PHASE_WIDTH, PHASE_HEIGHT)

/*
 * Two degenerate pages, correlated with themselves. Both are the case this
 * algorithm exists FOR - a mostly blank form is precisely where feature
 * matching has nothing to work with - and both reach branches no textured
 * image does:
 *
 *   - a uniform grey page drives the cross-power magnitude below 1e-12 on
 *     1,495 of 4,096 bins, which is the guard that zeroes them;
 *   - an all-zero page does it on ALL 4,096, and leaves a correlation surface
 *     where every one of the 4,096 samples ties for largest. That is the only
 *     input here that can tell "first maximum wins" from "last maximum wins",
 *     and the two answers are a whole page apart.
 *
 * Both were added after a mutation run: with only the textured cases, a port
 * that dropped the guard or took the last maximum passed everything.
 */
const phaseDegenerate = [
  { label: 'uniform', fill: 0.5 },
  { label: 'empty', fill: 0 },
].map(({ label, fill }) => {
  const image = createGray(PHASE_WIDTH, PHASE_HEIGHT)
  image.data.fill(fill)

  return { label, pixels: [...image.data], result: phaseCorrelate(image, image) }
})

const phaseCases = PHASE_SHIFTS.map(({ label, dx, dy }) => {
  const shifted = phaseShifted(phaseBase, dx, dy)

  return {
    label,
    requested: { dx, dy },
    // Whether the requested shift was a whole number of pixels. Recorded
    // rather than re-derived in the test, so the two cannot disagree.
    integer:   Number.isSafeInteger(dx) && Number.isSafeInteger(dy),
    shifted:   [...shifted.data],
    result:    phaseCorrelate(phaseBase, shifted),
  }
})

/*
 * `Math.cos` at exactly the Hann window's arguments, for every length these
 * cases use, plus the two that are special: 1 (where the window is [1] and
 * `n - 1` is never divided by) and 2 (where the whole window is [0, 0],
 * because cos(0) and cos(2π) are both 1 — a port that "helpfully" avoided the
 * zero would fail against it).
 *
 * The window itself is private to the algorithm, so goldening it would mean
 * restating it here — and a golden written by hand only proves that two copies
 * of the same misunderstanding agree. Its inputs are not private: they are
 * `Math.cos` of a number, and that is what gets pinned.
 */
const HANN_LENGTHS = [1, 2, 3, 8, PHASE_HEIGHT, PHASE_WIDTH]
const hannCos = Object.fromEntries(
  HANN_LENGTHS.filter(n => n > 1).map(n => [
    String(n),
    Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * i) / (n - 1))),
  ]),
)

writeFileSync(
  join(goldenDir, 'align-phase-correlation.json'),
  JSON.stringify(
    {
      size:       { width: PHASE_WIDTH, height: PHASE_HEIGHT },
      // The input pixels themselves, so a Python failure means the
      // CORRELATION diverged rather than the fixture. Float32 on both sides.
      base:       [...phaseBase.data],
      cases:      phaseCases,
      degenerate: phaseDegenerate,
      cos:        hannCos,
    },
    undefined,
    2,
  ) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'align-phase-correlation.json') + '\n')

/* ---------------------------------------------------------------------------
 * @scanmate/align: feature matching
 *
 * The densest slice in the port for JavaScript semantics, as opposed to
 * arithmetic — four of them, and each changes the ANSWER rather than its last
 * bit. So the goldens are layered, smallest unit first, because a failure in
 * `detectAndDescribe` alone would say almost nothing about which of the four
 * moved:
 *
 *   1. `popcount` over values chosen to include negatives, because `^` and
 *      `>>` in JavaScript coerce to SIGNED 32-bit and a descriptor word with
 *      its top bit set arrives there negative.
 *   2. `hamming` over whole descriptors, including the all-ones word that
 *      `1 << 31` produces.
 *   3. `detectAndDescribe` end to end, whose per-keypoint `score` and `angle`
 *      keep FAST's float32 score array and the centroid's `atan2`
 *      distinguishable even though neither can be goldened on its own.
 *   4. `matchFeatures` over the descriptors that produces.
 *
 * The whole-descriptor goldens are the ones that would catch `Math.round`
 * rounding a half the wrong way: it decides the sampling pattern's integer
 * offsets, so a single half-value rounded to even instead of up moves one
 * sample point and flips bits that no smaller test would see.
 * ------------------------------------------------------------------------- */

/*
 * Values covering both signs, both ends of the 32-bit range, and the patterns
 * SWAR is most likely to be transcribed wrongly for: alternating bits, nibble
 * boundaries, and the sign bit on its own.
 */
const POPCOUNT_INPUTS = [
  0, 1, 2, 3, 255, 256, 0x0F0F0F0F, 0x55555555, 0x33333333, 0xAAAAAAAA,
  0xFFFFFFFF, 0x80000000, 0x7FFFFFFF, 0xFFFF0000, 0x0000FFFF, 123_456_789,
  -1, -2, -2_147_483_648, 2_147_483_647,
]

const featureGoldens: Record<string, unknown> = {
  popcount: POPCOUNT_INPUTS.map(value => ({ value, bits: popcount(value) })),
}

/*
 * `hamming` over descriptors built by hand, so the distances are known
 * independently of any detector: identical, complementary (256 bits apart),
 * one bit apart, and a word whose top bit is set — which is the one `1 << 31`
 * produces and the one a port is most likely to lose.
 */
const emptyDescriptor = new Uint32Array(8)
const fullDescriptor = new Uint32Array(8).fill(0xFFFFFFFF)
const singleBitDescriptor = new Uint32Array(8)
singleBitDescriptor[0] = 1
const topBitDescriptor = new Uint32Array(8)
topBitDescriptor[7] = 0x80000000
const mixedDescriptor = Uint32Array.from([1, 2, 4, 8, 0x80000000, 0xFFFFFFFF, 0x0F0F0F0F, 0xAAAAAAAA])

const hammingPairs: [string, Uint32Array, Uint32Array][] = [
  ['identical', emptyDescriptor, emptyDescriptor],
  ['complementary', emptyDescriptor, fullDescriptor],
  ['singleBitDescriptor', emptyDescriptor, singleBitDescriptor],
  ['topBitDescriptor', emptyDescriptor, topBitDescriptor],
  ['mixedAgainstOnes', mixedDescriptor, fullDescriptor],
  ['mixedAgainstItself', mixedDescriptor, mixedDescriptor],
]
featureGoldens.hamming = hammingPairs.map(([label, a, b]) => ({
  label,
  a:        [...a],
  b:        [...b],
  distance: hamming(a, 0, b, 0),
}))

/*
 * A page with the kind of structure FAST actually fires on: filled rectangles
 * (whose corners are the case the COMPASS_MINIMUM comment in the detector is
 * about), rules, and text-like blocks. Deterministic, and small enough that
 * the golden stays readable.
 */
const FEATURE_WIDTH = 160
const FEATURE_HEIGHT = 120

function featurePage (): GrayImage {
  const page = createGray(FEATURE_WIDTH, FEATURE_HEIGHT)
  page.data.fill(0.05)
  const random = createRandom(9_137)

  const put = (x0: number, y0: number, w: number, h: number, value: number): void => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++)
        if (x >= 0 && y >= 0 && x < FEATURE_WIDTH && y < FEATURE_HEIGHT)
          page.data[y * FEATURE_WIDTH + x] = value
  }

  // Two filled boxes and a rule: corners with unambiguous orientation.
  put(20, 18, 34, 26, 0.9)
  put(96, 60, 28, 30, 0.85)
  put(12, 96, 136, 3, 0.8)
  // Text-like runs, which is what most of a real page's corners come from.
  for (let row = 0; row < 5; row++)
    for (let word = 0; word < 7; word++) {
      const x = 16 + word * 20
      const y = 54 + row * 7
      put(x, y, 4 + Math.floor(random() * 9), 4, 0.75)
    }
  // A little noise, so no two scores are exactly equal by construction — ties
  // are covered deliberately elsewhere rather than by accident here.
  for (let i = 0; i < page.data.length; i++)
    page.data[i] = Math.min(1, Math.max(0, page.data[i] + (random() - 0.5) * 0.03))

  return page
}

const featureBase = featurePage()

/*
 * NOT goldened separately: `detectFast` and `orientation`. Both are exported
 * from their own module but not from the package, so this writer cannot reach
 * them through the built bundle — and reimplementing them here to get a golden
 * would only prove that two copies of the same misunderstanding agree.
 *
 * They are covered through `detectAndDescribe`, which is the honest position
 * but a weaker one: a failure there does not say whether FAST's float32 score
 * array or the centroid's `atan2` moved. The keypoint goldens below carry
 * `score` and `angle` per keypoint for exactly that reason, so the two can
 * still be told apart by eye.
 */

/*
 * The whole detector, and then the matcher against a shifted copy of the same
 * page. `maxFeatures` is held down so the golden stays a readable size while
 * still crossing every pyramid level.
 */
const FEATURE_OPTIONS = { maxFeatures: 120, levels: 2, gridSize: 4 }
const featureShifted = createGray(FEATURE_WIDTH, FEATURE_HEIGHT)
for (let y = 0; y < FEATURE_HEIGHT; y++)
  for (let x = 0; x < FEATURE_WIDTH; x++)
    featureShifted.data[y * FEATURE_WIDTH + x] = sampleGrayBilinear(featureBase, x - 5, y - 3)

const detectedBase = detectAndDescribe(featureBase, FEATURE_OPTIONS)
const detectedShifted = detectAndDescribe(featureShifted, FEATURE_OPTIONS)

featureGoldens.detectAndDescribe = {
  options:     FEATURE_OPTIONS,
  keypoints:   detectedBase.keypoints,
  descriptors: [...detectedBase.descriptors],
}

/*
 * Two more detector fixtures, both added after a mutation run showed the page
 * above could not reach the branch they cover.
 *
 * `oddWidth` is 161 pixels across with a scale factor of exactly 2, so level 1
 * asks for `161 / 2 = 80.5` pixels. `Math.round` gives 81 and Python's `round`
 * gives 80, and that one pixel changes every corner found at that level. It is
 * the only place in this slice where JavaScript's round-half-up is reachable
 * at all: the sampling pattern rounds 32,768 values and not one of them lands
 * on an exact half.
 *
 * `rule` is a page whose feature is a one-pixel horizontal line. Every
 * interior pixel along it sees an identical ring, so their FAST scores are
 * exactly equal - which is the only way to tell the non-maximum suppression's
 * `>` from a `>=`. With `>` the whole run survives; with `>=` none of it does.
 * A rule is also what half the corners on a real form come from, so this is
 * not a contrived page.
 */
const ODD_WIDTH = 161
/* Odd in BOTH axes, so `height / 2` is a half too. A mutation run caught the
 * first version of this: 161 x 120 pins the rounding of the width and leaves
 * the height's own `Math.round` free to be wrong. */
const ODD_HEIGHT = 121

function oddWidthPage (): GrayImage {
  const page = createGray(ODD_WIDTH, ODD_HEIGHT)
  for (let y = 0; y < ODD_HEIGHT; y++)
    for (let x = 0; x < ODD_WIDTH; x++)
      page.data[y * ODD_WIDTH + x] =
        featureBase.data[Math.min(y, FEATURE_HEIGHT - 1) * FEATURE_WIDTH +
          Math.min(x, FEATURE_WIDTH - 1)]

  return page
}

function rulePage (): GrayImage {
  const page = createGray(FEATURE_WIDTH, FEATURE_HEIGHT)
  page.data.fill(0.05)
  for (let x = 30; x < 130; x++) page.data[60 * FEATURE_WIDTH + x] = 0.9

  return page
}

featureGoldens.moreDetectors = [
  {
    label:   'oddWidth',
    width:   ODD_WIDTH,
    height:  ODD_HEIGHT,
    options: { maxFeatures: 60, levels: 2, gridSize: 4, scaleFactor: 2 },
    pixels:  [...oddWidthPage().data],
  },
  {
    label:   'rule',
    width:   FEATURE_WIDTH,
    height:  FEATURE_HEIGHT,
    options: { maxFeatures: 60, levels: 1, gridSize: 4 },
    pixels:  [...rulePage().data],
  },
  /*
   * A budget that does not divide by the level count. `perLevel` is
   * `Math.ceil(maxFeatures / levels)`, so 5 over 2 levels is 3 each and the
   * total can come to 6 — `maxFeatures` is a per-level allowance here, not a
   * global cap, and reproducing that means reproducing the ceiling. Every
   * other case uses a budget that divides exactly, where a floor would give
   * the same answer; a mutation run is what noticed.
   */
  {
    label:   'indivisibleBudget',
    width:   FEATURE_WIDTH,
    height:  FEATURE_HEIGHT,
    options: { maxFeatures: 5, levels: 2, gridSize: 4 },
    pixels:  [...featureBase.data],
  },
].map(({ label, width, height, options, pixels }) => {
  const image = createGray(width, height)
  image.data.set(pixels)
  const detected = detectAndDescribe(image, options)

  return {
    label,
    width,
    height,
    options,
    pixels,
    keypoints:   detected.keypoints,
    descriptors: [...detected.descriptors],
  }
})

featureGoldens.matchFeatures = [
  { label: 'defaults', options: {} },
  // Cross-check off keeps the asymmetric bests, which is a different set.
  { label: 'noCrossCheck', options: { crossCheck: false } },
  // A ratio this strict rejects almost everything on a page of repeated
  // letterforms, which is the case the ratio test exists for.
  { label: 'strictRatio', options: { ratio: 0.5 } },
  // The displacement gate, set just above and just below the real shift of
  // (5, 3) — about 5.83 pixels.
  { label: 'gateAbove', options: { maxDisplacement: 12 } },
  { label: 'gateBelow', options: { maxDisplacement: 3 } },
].map(({ label, options }) => ({
  label,
  options,
  matches: matchFeatures(detectedBase, detectedShifted, options),
}))

writeFileSync(
  join(goldenDir, 'align-feature-matching.json'),
  JSON.stringify(
    {
      size:    { width: FEATURE_WIDTH, height: FEATURE_HEIGHT },
      base:    [...featureBase.data],
      shifted: [...featureShifted.data],
      ...featureGoldens,
    },
    undefined,
    2,
  ) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'align-feature-matching.json') + '\n')

/* ---------------------------------------------------------------------------
 * @scanmate/align: coarse estimation
 *
 * The first slice that is a USE CASE rather than an algorithm: it guesses three
 * ways, nudges each with phase correlation, warps all of them and keeps
 * whichever scores best. So what has to agree is not one number but a
 * decision — which strategy wins — and the matrix that comes with it.
 *
 * It inherits everything phase correlation inherits, since it calls it. The
 * inheritance is narrower than it looks, though, and the Python tests say so:
 * the seam reaches the POLISHED candidates' matrices and their scores, but the
 * gap between the winning score and the runner-up is enormous compared to a
 * ULP, so `strategy` is exact.
 *
 * The cases are built from `createSyntheticDocument` + `simulateScan`, which is
 * what the real pipeline does, and each one is a different reason the coarse
 * stage exists:
 *
 *   - `clean`      a scan at the same size, barely rotated. The easy case.
 *   - `rescaled`   1.5x, which is roughly 300 dpi against a 200 dpi render —
 *                  the exact blind spot BRIEF has and this stage exists to fix.
 *   - `rotated`    a real skew, so `deskew` has something to beat `content` with.
 *   - `margins`    a bigger canvas with the page shifted inside it, which is
 *                  what makes `frame` wrong and `content` right. Without it,
 *                  every strategy agrees and the choice between them is untested.
 *   - `noisy`      sensor noise and an illumination ramp on top of a rescale.
 * ------------------------------------------------------------------------- */

/** sha256 of a grey image's raw float32 bytes, so a fixture drift is legible. */
function digestOf (image: GrayImage): string {
  return createHash('sha256').update(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)).digest('hex')
}

/*
 * 170 x 220 at a working size of 128, not 425 x 550 at the default 512.
 *
 * The size is a test-runtime decision, measured rather than guessed: the first
 * version ran the Python side in 6m16s, because phase correlation at a 512
 * working size is three 512x512 transforms of pure-Python loops per candidate.
 * At 128 the same five cases still pick three different strategies and still
 * exercise both the polished and unpolished paths, which is everything this
 * golden is for.
 */
const COARSE_PAGE = createSyntheticDocument({ width: 170, height: 220, seed: 42 })
const COARSE_OPTIONS = { workingSize: 128 }

const COARSE_CASES: readonly { label: string, scan: ScanOptions }[] = [
  { label: 'clean', scan: { rotationDeg: 0.4, seed: 7 } },
  { label: 'rescaled', scan: { scale: 1.5, rotationDeg: 0.8, seed: 11 } },
  { label: 'rotated', scan: { rotationDeg: 6.5, seed: 13 } },
  {
    label: 'margins',
    scan:  {
      scale:       0.72,
      rotationDeg: 1.2,
      translateX:  40,
      translateY:  55,
      canvas:      { width: 425, height: 550 },
      seed:        17,
    },
  },
  {
    label: 'noisy',
    scan:  { scale: 1.35, rotationDeg: 2.2, noise: 0.05, illumination: 0.25, seed: 23 },
  },
  /*
   * A canvas with a DIFFERENT ASPECT RATIO to the page, which is the only way
   * the frame guess's pivot and target are ever different points.
   *
   * Everywhere else they are the same point, and not by accident: `simulateScan`
   * defaults its canvas to the page scaled, so both images have the same shape
   * and `downscaleGray` takes both to the same working size. A mutation run
   * used that - swapping the frame candidate's pivot and target changed
   * nothing on any of the five cases above, because the swap was a no-op every
   * time. A scan on a wider platen is an ordinary thing and this is it.
   */
  {
    label: 'wideCanvas',
    scan:  {
      scale:       1.1,
      rotationDeg: 1.6,
      translateX:  55,
      translateY:  10,
      canvas:      { width: 300, height: 220 },
      seed:        29,
    },
  },
]

const coarseCases = COARSE_CASES.map(({ label, scan }) => {
  const simulated = simulateScan(COARSE_PAGE.raster, scan)
  // `inkMap` takes grey, not colour, so the greyscale step is part of the
  // fixture rather than something the Python side has to reproduce.
  const originalInk = inkMap(toGrayscale(COARSE_PAGE.raster))
  const scannedInk = inkMap(toGrayscale(simulated.raster))
  const result = estimateCoarse(originalInk, scannedInk, COARSE_OPTIONS)

  return {
    label,
    scan,
    options:   COARSE_OPTIONS,
    truth:     simulated.matrix,
    /*
     * A HASH of each ink map, not the pixels.
     *
     * The first version of this shipped both maps for all five cases and came
     * to 43 MB, which is not a file to put in a repository. The Python side
     * rebuilds them instead, from the same synthetic document and the same
     * scan options - every step of which (`createSyntheticDocument`,
     * `simulateScan`, `toGrayscale`, `inkMap`) is already pinned by the ink
     * goldens, so rebuilding proves more than shipping would: it shows the
     * whole chain agrees, not just that two arrays were copied correctly.
     *
     * The hash is what keeps a fixture divergence legible. Without it, an ink
     * map that drifted would surface as a coarse-estimation failure, and the
     * search for the cause would start in the wrong slice.
     */
    inkDigest: {
      original: digestOf(originalInk),
      scanned:  digestOf(scannedInk),
    },
    size: {
      original: { width: originalInk.width, height: originalInk.height },
      scanned:  { width: scannedInk.width, height: scannedInk.height },
    },
    result,
  }
})

writeFileSync(
  join(goldenDir, 'align-coarse-estimation.json'),
  JSON.stringify({ cases: coarseCases }, undefined, 2) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'align-coarse-estimation.json') + '\n')

/* ---------------------------------------------------------------------------
 * @scanmate/align: scan alignment
 *
 * The whole thing, end to end, and the last slice of the package. What has to
 * agree here is a WHOLE PIPELINE's worth of decisions: which coarse strategy
 * won, how many features each page gave up, how many matches survived, which
 * models RANSAC could fit at all, which one the preference margin selected, and
 * whether the sweep stopped early.
 *
 * `durationMs` is deliberately NOT in the golden. It is wall-clock time, so it
 * is the one field that cannot match, and shipping it would either make the
 * comparison fail forever or teach whoever reads the file that some fields are
 * decorative.
 *
 * The encoded `image` is not either. It is PNG bytes from libvips on one side
 * and Pillow on the other, which are different encoders writing the same
 * pixels - and `raster` is what the pixels are. A digest of the raster is here
 * instead; the codec is ink's business and ink's goldens cover it.
 *
 * Small pages and a small working size, for the reason the coarse goldens
 * already record: this is pure-Python loops on the other side, and the point of
 * a fixture is to discriminate rather than to be large.
 * ------------------------------------------------------------------------- */

const ALIGN_PAGE = createSyntheticDocument({ width: 200, height: 260, seed: 42 })

/** Held down hard. The defaults (1400/512/1200 features) take minutes in Python. */
const ALIGN_BASE = { workingSize: 320, coarseSize: 128, maxFeatures: 150, output: 'none' } as const

const ALIGN_CASES: readonly { label: string, scan: ScanOptions, align: Record<string, unknown> }[] = [
  // The ordinary case: a flatbed scan, slightly turned. `similarity` should win
  // and the sweep should stop before trying the other two.
  { label: 'flatbed', scan: { rotationDeg: 1.1, seed: 31 }, align: {} },
  // Rescaled, which is what the coarse stage exists for.
  { label: 'rescaled', scan: { scale: 1.4, rotationDeg: 2.3, seed: 37 }, align: {} },
  /*
   * `confidenceTarget: 2` is never reachable, so every model is tried and the
   * preference margin has to do real work. Without a case like this the sweep
   * stops at the first model every time and `prefers` is never asked a
   * question with two answers.
   */
  { label: 'fullSweep', scan: { rotationDeg: 1.1, seed: 31 }, align: { confidenceTarget: 2 } },
  // One named model, which skips the sweep entirely.
  { label: 'homographyOnly', scan: { rotationDeg: 1.1, seed: 31 }, align: { model: 'homography' } },
  /*
   * A nearly blank page: few corners, so RANSAC finds no consensus and the
   * coarse estimate has to stand alone. That is the `method: 'coarse'` path,
   * and it is the one a real batch hits on a blank continuation sheet.
   */
  { label: 'coarseFallback', scan: { rotationDeg: 0.9, seed: 41 }, align: { minInliers: 500 } },
  // A model order the default does not use, which `sweepOrder` must preserve.
  {
    label: 'reversedModels',
    scan:  { rotationDeg: 1.1, seed: 31 },
    align: { models: ['homography', 'affine', 'similarity'], confidenceTarget: 2 },
  },
  /*
   * A working size SMALLER than the page, so the feature stage genuinely
   * downscales and `prepared.scale` is not 1.
   *
   * Every case above runs at 320 on a 200x260 page, which `downscaleGray`
   * leaves alone - so `conjugateScale(residual, 1)` is the identity and the
   * step that lifts a residual back to full resolution does nothing. A
   * mutation run found exactly that: removing the scale-back entirely changed
   * no golden. At 160 the scale is 0.615 and the step is load-bearing.
   *
   * It is also the first case where the full-resolution warp MINIFIES enough
   * for `warpRaster`'s prefilter to fire.
   */
  { label: 'downscaled', scan: { scale: 1.6, rotationDeg: 1.1, seed: 31 }, align: { workingSize: 160 } },
  /*
   * A scan twice the page, which is the first case where `warpRaster`'s
   * prefilter does anything.
   *
   * It fires above `sqrt(|det|) > 1.25` and blurs by `(scale - 1) / 2` - which
   * `Math.round`s to a radius of ZERO until the scale reaches 2. So `rescaled`
   * at 1.4 and `downscaled` at 1.6 both trip the condition and both blur by
   * nothing, and a mutation run duly found that turning the prefilter off
   * changed no golden. 2.2 is also an ordinary number here: a 300 dpi scan of a
   * 150 dpi render is about 2.
   */
  { label: 'prefiltered', scan: { scale: 2.2, rotationDeg: 1.1, seed: 31 }, align: {} },
]

const alignCases = await Promise.all(ALIGN_CASES.map(async ({ label, scan, align }) => {
  const simulated = simulateScan(ALIGN_PAGE.raster, scan)
  const result = await alignScan(ALIGN_PAGE.raster, simulated.raster, { ...ALIGN_BASE, ...align })

  return {
    label,
    scan,
    align,
    truth:        simulated.matrix,
    // A digest, not the pixels: a 200x260 RGBA raster is 208,000 bytes and
    // there are six cases. The bytes are what `warpRaster` produced, and that
    // is ink's own tested code.
    rasterDigest: createHash('sha256').update(result.raster.data).digest('hex'),
    result:       {
      width:       result.width,
      height:      result.height,
      dpi:         result.dpi,
      matrix:      result.matrix,
      inverse:     result.inverse,
      transform:   result.transform,
      confidence:  result.confidence,
      method:      result.method,
      // Everything but `durationMs`, which is wall-clock and cannot match.
      diagnostics: {
        coarseScore:           result.diagnostics.coarseScore,
        coarseStrategy:        result.diagnostics.coarseStrategy,
        skewDeg:               result.diagnostics.skewDeg,
        features:              result.diagnostics.features,
        matches:               result.diagnostics.matches,
        inliers:               result.diagnostics.inliers,
        inlierRatio:           result.diagnostics.inlierRatio,
        /*
         * NaN, encoded. `JSON.stringify(NaN)` is `null`, and a golden that
         * says `null` where it means NaN is one a port passes by returning the
         * wrong thing - the same trap the hypot golden above hit with
         * Infinity. A rejected attempt carries NaN here by design, and the
         * coarse fallback carries it at the top level, so both paths need it.
         */
        reprojectionError:     encodeNonFinite(result.diagnostics.reprojectionError),
        correlation:           result.diagnostics.correlation,
        intersectionOverUnion: result.diagnostics.intersectionOverUnion,
        selectedModel:         result.diagnostics.selectedModel,
        attempts:              result.diagnostics.attempts.map(attempt => ({
          ...attempt,
          reprojectionError: encodeNonFinite(attempt.reprojectionError),
        })),
      },
    },
  }
}))

/*
 * Two more cases that need the results of earlier ones, so they are built after
 * the map above rather than inside it.
 *
 * `skewedOriginal` gives the ORIGINAL a skew of its own. Every case above uses
 * the synthetic page unrotated, so `skewDeg.original` is exactly 0 - and 0
 * radians is 0 degrees, which made the radians-to-degrees conversion on that
 * field unobservable. A mutation run found it.
 *
 * `exactTarget` sets `confidenceTarget` to a confidence the sweep actually
 * reaches, taken from `flatbed`'s first attempt rather than typed in. The check
 * is `>=`, so this is the one input where `>` gives a different answer: the
 * sweep stops after one model instead of trying a second.
 */
const skewedOriginalRaster = simulateScan(ALIGN_PAGE.raster, { rotationDeg: 4.5, seed: 53 }).raster
const skewedScan = simulateScan(skewedOriginalRaster, { rotationDeg: -2.2, seed: 59 })
const skewedResult = await alignScan(skewedOriginalRaster, skewedScan.raster, ALIGN_BASE)

const flatbedFirstConfidence = alignCases.find(c => c.label === 'flatbed')
  ?.result.diagnostics.attempts[0]?.confidence
if (typeof flatbedFirstConfidence !== 'number')
  throw new Error('flatbed produced no scored first attempt; the exactTarget case needs one')

const exactTargetScan = simulateScan(ALIGN_PAGE.raster, { rotationDeg: 1.1, seed: 31 })
const exactTargetResult = await alignScan(ALIGN_PAGE.raster, exactTargetScan.raster, {
  ...ALIGN_BASE,
  confidenceTarget: flatbedFirstConfidence,
})

/** The same shape the mapped cases have, so the Python side reads one list. */
function shapeCase (
  label: string,
  scan: ScanOptions,
  align: Record<string, unknown>,
  truth: Matrix3,
  result: Awaited<ReturnType<typeof alignScan>>,
  nested?: ScanOptions,
): unknown {
  return {
    label,
    scan,
    align,
    truth,
    // Present only on `skewedOriginal`: the scan is a scan OF the skewed
    // original, so rebuilding it takes two `simulateScan` calls and the Python
    // side needs both sets of options.
    ...(nested !== undefined && { nested }),
    rasterDigest: createHash('sha256').update(result.raster.data).digest('hex'),
    result:       {
      width:       result.width,
      height:      result.height,
      dpi:         result.dpi,
      matrix:      result.matrix,
      inverse:     result.inverse,
      transform:   result.transform,
      confidence:  result.confidence,
      method:      result.method,
      diagnostics: {
        coarseScore:           result.diagnostics.coarseScore,
        coarseStrategy:        result.diagnostics.coarseStrategy,
        skewDeg:               result.diagnostics.skewDeg,
        features:              result.diagnostics.features,
        matches:               result.diagnostics.matches,
        inliers:               result.diagnostics.inliers,
        inlierRatio:           result.diagnostics.inlierRatio,
        reprojectionError:     encodeNonFinite(result.diagnostics.reprojectionError),
        correlation:           result.diagnostics.correlation,
        intersectionOverUnion: result.diagnostics.intersectionOverUnion,
        selectedModel:         result.diagnostics.selectedModel,
        attempts:              result.diagnostics.attempts.map(attempt => ({
          ...attempt,
          reprojectionError: encodeNonFinite(attempt.reprojectionError),
        })),
      },
    },
  }
}

const extraCases = [
  shapeCase(
    'skewedOriginal',
    { rotationDeg: 4.5, seed: 53 },
    {},
    skewedScan.matrix,
    skewedResult,
    { rotationDeg: -2.2, seed: 59 },
  ),
  shapeCase(
    'exactTarget',
    { rotationDeg: 1.1, seed: 31 },
    { confidenceTarget: flatbedFirstConfidence },
    exactTargetScan.matrix,
    exactTargetResult,
  ),
]

/*
 * `prefers` on its own, which is the one piece of this slice that is pure and
 * can be goldened exhaustively. Every ordering of complexity against every
 * relationship between the two confidences, so the three branches - more
 * complex must beat by the margin, simpler wins within it, equal simply has to
 * win - are each exercised in both directions.
 */
const PREFER_MODELS: readonly TransformModel[] = ['similarity', 'affine', 'homography']
const PREFER_CONFIDENCES = [0, 0.3, 0.5, 0.51, 0.52, 0.53, 0.9, 1]
const preferCases: unknown[] = []
for (const candidateModel of PREFER_MODELS)
  for (const incumbentModel of PREFER_MODELS)
    for (const candidateConfidence of PREFER_CONFIDENCES)
      for (const margin of [0, 0.02, 0.5]) {
        const candidate = { model: candidateModel, confidence: candidateConfidence }
        const incumbent = { model: incumbentModel, confidence: 0.52 }
        preferCases.push({
          candidate,
          incumbent,
          margin,
          prefers: prefers(candidate, incumbent, margin),
        })
      }
// And the first-attempt case, which short-circuits before any comparison.
preferCases.push({
  candidate: { model: 'homography', confidence: 0 },
  incumbent: null,
  margin:    0.02,
  prefers:   prefers({ model: 'homography', confidence: 0 }, null, 0.02),
})

writeFileSync(
  join(goldenDir, 'align-scan-alignment.json'),
  JSON.stringify(
    {
      page:    { width: 200, height: 260, seed: 42 },
      options: ALIGN_BASE,
      cases:   [...alignCases, ...extraCases],
      prefers: preferCases,
    },
    undefined,
    2,
  ) + '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'align-scan-alignment.json') + '\n')

/*
 * `@scanmate/align`'s own surface, for the same reason ink has one: a whole
 * export could go unported and every Python test would still pass.
 *
 * Read from `dist/src/index.d.ts`, never `dist/index.d.ts` — that one is a
 * re-export stub with no named exports in it, and reading it collapses this
 * golden to an empty list which then "passes" against anything at all. That is
 * exactly what the first version of ink's surface golden did.
 */
const alignIndexSource = withoutComments(
  readFileSync(join(here, '..', '..', 'packages', 'align', 'dist', 'src', 'index.d.ts'), 'utf8'),
)
const alignExported = new Set<string>()
for (const match of alignIndexSource.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gu)) {
  const names = match[1].split(',')
  // `a as b` re-exports under a new name; the SOURCE name is the one a port
  // has to provide, so that is what is recorded.
  for (const part of names)
    if (part.trim() !== '') alignExported.add(part.trim().split(/\s+as\s+/u, 1)[0].trim())
}

writeFileSync(
  join(goldenDir, 'align-package-surface.json'),
  JSON.stringify({ exports: [...alignExported].sort((a, b) => a.localeCompare(b)) }, undefined, 2) +
    '\n',
)
process.stdout.write('wrote ' + join(goldenDir, 'align-package-surface.json') + '\n')
