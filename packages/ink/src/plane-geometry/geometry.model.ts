/**
 * Geometry types: the transform itself, and the shapes it moves.
 */

/**
 * A row-major 3x3 matrix in homogeneous coordinates:
 *
 * ```text
 * [ m0 m1 m2 ]
 * [ m3 m4 m5 ]
 * [ m6 m7 m8 ]
 * ```
 */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number]

export interface Point {
  x: number
  y: number
}

/** An axis-aligned rectangle in pixel coordinates. `x`/`y` are the top-left corner. */
export interface ScanmateRect {
  x:      number
  y:      number
  width:  number
  height: number
}

/**
 * A rectangle that may be turned.
 *
 * Only quarter turns mean anything downstream: a column profile can be read
 * along either axis, but anything between would need the crop resampled, and
 * the glyph checks leave those unverifiable rather than guess.
 */
export interface ScanmateOrientedRect extends ScanmateRect {
  /** Degrees clockwise from left-to-right. Absent or `0` for ordinary text. */
  angle?: number
}

/** Which family of transform to fit. Fewer degrees of freedom is more robust; more is more expressive. */
export type TransformModel =
  /** 4 DOF: uniform scale, rotation, translation. A flatbed scan of a flat page. */
  | 'similarity' |
  /** 6 DOF: adds non-uniform scale and shear. A scan whose feed stretched one axis. */
  'affine' |
  /** 8 DOF: full projective warp. A photograph taken off-axis. */
  'homography'

/** The geometric meaning of a fitted matrix, pulled apart into numbers a human can sanity-check. */
export interface TransformSummary {
  model:       TransformModel
  /** Scale along the scan's x axis. `1` means the scan matches the original's pixel scale. */
  scaleX:      number
  scaleY:      number
  /** Rotation in degrees, counter-clockwise positive in image coordinates. */
  rotationDeg: number
  /** Residual shear in degrees. Non-zero only for `affine` and `homography`. */
  shearDeg:    number
  /** Where the original's top-left corner lands in the scan. */
  translation: Point
  /** Perspective terms (`m6`, `m7`). Non-zero only for `homography`. */
  perspective: Point
}

/** One `(original, scanned)` correspondence produced by feature matching. */
export interface PointMatch {
  source:   Point
  target:   Point
  /** Hamming distance between the two descriptors. Lower is a better match. */
  distance: number
}
