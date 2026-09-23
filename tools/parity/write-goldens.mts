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
  encodeImage,
  gaussian,
  readImageMetadata,
} from '../../packages/ink/dist/index.esm.js'

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
