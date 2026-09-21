/** How often the audit's thresholds pass an altered document or hold up a genuine one, measured on a labelled corpus. */

export { calibrateAudit, DEFAULT_CALIBRATION_GRID, documentPasses } from './calibrate-audit.use-case'
export { sampleAudit } from './sample-audit.mapper'
export type { CalibrationGrid, CalibrationLabel, CalibrationPoint, CalibrationReport, CalibrationSample, CalibrationThresholds, SampledFinding, SampledPage } from './calibration.contract'
