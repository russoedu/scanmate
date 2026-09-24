import type { ScanmateRect } from '../plane-geometry'
import type { Bleed, ResolvedBleed } from './bleed.contract'

/**
 * The room around a region when nothing says otherwise.
 *
 * Six points, about two millimetres: enough for a pen that overshoots its line,
 * not so much that neighbouring fields start claiming each other's ink. It was
 * the uniform margin the pixel comparison used before a bleed could be set per
 * side, so leaving every bleed unset reproduces exactly what that did.
 */
export const DEFAULT_BLEED = 6

/**
 * Every side of a bleed decided: the named side if given, else `bleed`, else
 * `fallback`.
 *
 * One rule, used everywhere a region's room is decided - so the region a
 * reviewer is shown and the region the comparison actually measures cannot
 * drift apart. That is the whole reason it lives here rather than beside each
 * of them.
 */
export function resolveBleed (bleed: Bleed = {}, fallback: number = DEFAULT_BLEED): ResolvedBleed {
  const all = bleed.bleed ?? fallback

  return checked({
    top:    bleed.bleedTop ?? all,
    right:  bleed.bleedRight ?? all,
    bottom: bleed.bleedBottom ?? all,
    left:   bleed.bleedLeft ?? all,
  })
}

/**
 * One region's room, over the room every region gets: the region's named side,
 * else its own `bleed`, else `base`'s side.
 *
 * `base` is already resolved, so the options' rule and the region's rule are
 * the same rule applied twice, and a region that says nothing claims exactly
 * what the options say - which is what every region did before a region could
 * speak for itself.
 */
export function resolveRegionBleed (region: Bleed, base: ResolvedBleed): ResolvedBleed {
  return checked({
    top:    region.bleedTop ?? region.bleed ?? base.top,
    right:  region.bleedRight ?? region.bleed ?? base.right,
    bottom: region.bleedBottom ?? region.bleed ?? base.bottom,
    left:   region.bleedLeft ?? region.bleed ?? base.left,
  })
}

// A negative bleed would shrink the region, so ink inside the very box it was
// drawn for could be reported as unexpected. Refuse it rather than obey it.
function checked (sides: ResolvedBleed): ResolvedBleed {
  for (const [side, value] of Object.entries(sides))
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`bleed ${side} must be a finite, non-negative number of points, and is ${value}`)

  return sides
}

/** A region with its bleed around it. Top-left origin, so the top side moves up. */
export function growBy (rect: ScanmateRect, sides: ResolvedBleed): ScanmateRect {
  return {
    x:      rect.x - sides.left,
    y:      rect.y - sides.top,
    width:  rect.width + sides.left + sides.right,
    height: rect.height + sides.top + sides.bottom,
  }
}

/** Whether a bleed leaves any room at all, so there is a band worth drawing. */
export function hasBleed (sides: ResolvedBleed): boolean {
  return sides.top > 0 || sides.right > 0 || sides.bottom > 0 || sides.left > 0
}
