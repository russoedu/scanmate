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
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRandom,
  createBinary,
  createGray,
  createRaster,
  decodeImage,
  decompose,
  downscaleGray,
  encodeImage,
  fft1d,
  fft2d,
  gaussian,
  invert,
  isPlausible,
  isPowerOfTwo,
  jacobiEigen,
  mapRectCorners,
  multiply,
  nextPowerOfTwo,
  normalize,
  readImageMetadata,
  rebase,
  reprojectionError,
  similarity,
  smallestEigenvector,
  solve,
  binarize,
  boxBlur,
  boxBlurRaster,
  coverage,
  correlation,
  dilate,
  grayToRaster,
  inkMap,
  integralImage,
  intersectionOverUnion,
  mean,
  otsuThreshold,
  resizeGray,
  sampleGrayBilinear,
  toGrayscale,
  warpGray,
  warpRaster,
} from '../../packages/ink/dist/index.esm.js'
import type { Matrix3 } from '../../packages/ink/dist/src/index.d.ts'

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
