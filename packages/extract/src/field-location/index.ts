/** Field regions placed from the labels a document prints: found in its text layer, checked, and ready to mark or measure. */

export type { AnchorCorner, AnchorMatch, FieldOffset, FieldSpec, LocatablePage, LocatedAnchor, LocatedFields, LocateOptions, LocationProblem } from './field-location.contract'
export { locateAnchor, MAX_WORD_GAP } from './locate-anchor.algorithm'
export { locateFields } from './locate-fields.use-case'
export { placeField, resolveFields } from './resolve-fields.use-case'
