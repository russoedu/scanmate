/**
 * Characters and pairs OCR mistakes for one another, folded to one form each.
 *
 * Off by default, and deliberately so: `0` for `o` and `5` for `s` are OCR's
 * commonest errors, and the very substitutions someone altering an amount or a
 * reference would make. Folding them raises a score by hiding exactly what a
 * check is for. Use it to compare prose, never figures.
 *
 * Applied after case folding, to lower-case text.
 */

const PAIRS: ReadonlyArray<readonly [RegExp, string]> = [
  [/rn/gu, 'm'],
  [/cl/gu, 'd'],
  [/vv/gu, 'w'],
]

const SINGLES: ReadonlyMap<string, string> = new Map([
  ['0', 'o'],
  ['1', 'l'],
  ['i', 'l'],
  ['|', 'l'],
  ['!', 'l'],
  ['5', 's'],
  ['8', 'b'],
  ['6', 'b'],
  ['2', 'z'],
])

export function foldConfusables (text: string): string {
  let out = text
  for (const [pattern, replacement] of PAIRS) out = out.replaceAll(pattern, () => replacement)

  let folded = ''
  for (const character of out) folded += SINGLES.get(character) ?? character

  return folded
}
