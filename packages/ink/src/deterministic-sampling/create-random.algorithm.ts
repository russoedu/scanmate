/**
 * A seeded PRNG, so that two runs on the same bytes give the same matrix.
 *
 * RANSAC samples at random and the BRIEF pattern is drawn at random; with
 * `Math.random` the library would return a slightly different answer every
 * time, which makes a regression test a coin toss and a production bug
 * impossible to reproduce from the inputs alone. mulberry32 is 32 bits of
 * state and passes the statistical tests that matter at this scale.
 */
export function createRandom (seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller, used to draw the BRIEF sampling pattern from a Gaussian around the patch centre. */
export function gaussian (random: () => number): number {
  const u = Math.max(random(), Number.EPSILON)
  const v = random()

  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
