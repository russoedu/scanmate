/**
 * How far beyond a marked region ink still belongs to it, in the same units as
 * the region itself - PDF points unless a caller says otherwise.
 *
 * A signature does not stay inside its box. The field is where it is meant to
 * go; the bleed is the room around it where a stroke that ran over the line is
 * still counted as part of the signature rather than as an unexpected mark on
 * the page.
 *
 * `bleed` sets every side at once; a named side overrides it. So
 * `{ bleed: 6, bleedBottom: 14 }` is six points of room above and to either
 * side, and fourteen below - where a signature's descenders go.
 *
 * **Default: 6 points on every side** - about 2 mm - when nothing is set.
 *
 * It is given in two places, and the nearer one wins. On the options of a
 * comparison or a marking it is the room for every region; on a region itself
 * (`PageRegion`, so an `ExpectedChange` or a `PageMark`) it is that region's
 * own, side by side: a region's named side, else its `bleed`, else the
 * options' side. A signature box can have twenty points below while the date
 * beside it keeps the six.
 */
export interface Bleed {
  /** Every side, unless that side is given on its own. */
  bleed?:       number
  bleedTop?:    number
  bleedRight?:  number
  bleedBottom?: number
  bleedLeft?:   number
}

/** A bleed with every side decided. */
export interface ResolvedBleed {
  top:    number
  right:  number
  bottom: number
  left:   number
}
