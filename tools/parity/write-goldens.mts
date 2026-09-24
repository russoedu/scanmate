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
import type { Bleed, Matrix3, Raster, ScanOptions } from '../../packages/ink/dist/src/index.d.ts'

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
 * versions - V8 on 16.0 against CPython's 15.1 at the time of writing, which
 * `runtime.unicodeVersion` records so a future reader can see whether that
 * still holds.
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
    /* What V8 itself reports, so the Python can check the runtime rather than guess. */
    runtime:         {
      unicodeVersion: process.versions.unicode,
      lowerCased:     lowerCasedCorpus,
      nfkc:           nfkcCorpus,
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
