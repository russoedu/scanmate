/** The transform itself: matrix algebra, linear solves, plausibility. */

export type { Matrix3, Point, PointMatch, ScanmateOrientedRect, ScanmateRect, TransformModel, TransformSummary } from './geometry.model'
export { isPlausible } from './is-plausible.policy'
export { IDENTITY, applyPoint, conjugateScale, decompose, determinant, invert, mapRectCorners, multiply, normalize, rebase, reprojectionError, scaling, similarity, translation } from './matrix3.mapper'
export { jacobiEigen, smallestEigenvector, solve } from './solve.use-case'
