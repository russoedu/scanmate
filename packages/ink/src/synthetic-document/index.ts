/** Synthetic pages and simulated scans, for tests and deployment smoke checks. */

export { createSyntheticDocument, drawLine, drawSignature, drawTick, fillRect, simulateScan, strokeRect } from './synthetic-document.use-case'
export type { DocumentOptions, ScanOptions, SimulatedScan, SyntheticDocument } from './synthetic-document.use-case'
export { drawLabel, labelSize } from './draw-label.use-case'
export type { LabelOptions } from './draw-label.use-case'
