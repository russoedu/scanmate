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
