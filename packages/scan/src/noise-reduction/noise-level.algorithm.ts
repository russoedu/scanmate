import type { GrayImage } from '@scanmate/ink'

/**
 * How noisy a page is, without a clean copy to compare it to (Immerkær, 1996).
 *
 * The mean absolute response of a Laplacian-difference kernel, scaled so that
 * stationary Gaussian noise of standard deviation `sigma` scores `sigma`. Text
 * and edges occupy a small share of a page and noise is everywhere, so on a
 * document the noise dominates: a clean digital render scores close to zero, a
 * speckled scan or photocopy far higher. On the `[0, 1]` grey scale.
 */
export function estimateNoiseSigma (gray: GrayImage): number {
  const { width, height, data } = gray
  if (width < 3 || height < 3) return 0

  let sum = 0
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      const laplacian = data[p - width - 1] - 2 * data[p - width] + data[p - width + 1] -
        2 * data[p - 1] + 4 * data[p] - 2 * data[p + 1] +
        data[p + width - 1] - 2 * data[p + width] + data[p + width + 1]
      sum += Math.abs(laplacian)
    }

  return sum * Math.sqrt(Math.PI / 2) / (6 * (width - 2) * (height - 2))
}
