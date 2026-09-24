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
  createRaster,
  decodeImage,
  decompose,
  encodeImage,
  gaussian,
  invert,
  isPlausible,
  jacobiEigen,
  mapRectCorners,
  multiply,
  normalize,
  readImageMetadata,
  rebase,
  reprojectionError,
  similarity,
  smallestEigenvector,
  solve,
  binarize,
  boxBlur,
  coverage,
  dilate,
  grayToRaster,
  inkMap,
  integralImage,
  otsuThreshold,
  toGrayscale,
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
