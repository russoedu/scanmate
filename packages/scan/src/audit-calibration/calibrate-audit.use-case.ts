import { DEFAULT_MIN_CHANGE_AREA, DEFAULT_MIN_MISSING_AREA } from '../change-detection'

import { DEFAULT_MIN_TEXT_SCORE } from '../page-audit'
import type { CalibrationGrid, CalibrationPoint, CalibrationReport, CalibrationSample, CalibrationThresholds, SampledFinding, SampledPage } from './calibration.contract'

/**
 * The thresholds tried when none are given: the audit's defaults, and a few
 * steps either side of each. Area thresholds only step up - a sweep cannot see
 * a mark smaller than the audit reported.
 */
export const DEFAULT_CALIBRATION_GRID: Required<CalibrationGrid> = {
  minTextScore:   [0.75, 0.8, DEFAULT_MIN_TEXT_SCORE, 0.9, 0.95],
  minChangeArea:  [DEFAULT_MIN_CHANGE_AREA, 2, 4, 8],
  minMissingArea: [DEFAULT_MIN_MISSING_AREA, 8, 16],
}

/** 95% two-sided. */
const Z = 1.959_964

/**
 * How often a set of thresholds would pass an altered document, and how often
 * it would send a genuine one to review, measured on a labelled corpus.
 *
 * Automatic acceptance is only as safe as the thresholds behind it, and "0.85
 * looks right" is not something anyone can sign off. This replays each
 * sample's findings under every combination in `grid` and counts both mistakes
 * **by document** - a document passes only when every page does, which is how
 * it is accepted - with an upper bound on each rate that says how far a small
 * corpus can be trusted.
 *
 * Replaying is exact for what a threshold decides: a page goes to review when
 * its text score is below `minTextScore`, or when it has a finding that clears
 * its threshold. A mark added or ink lost clears it by its area, unless the
 * reading saw words there too; every other finding always counts.
 */
export function calibrateAudit (samples: readonly CalibrationSample[], grid: CalibrationGrid = {}): CalibrationReport {
  const tried = { ...DEFAULT_CALIBRATION_GRID, ...grid }
  const floorChange = Math.max(0, ...samples.map(s => s.floor.minChangeArea))
  const floorMissing = Math.max(0, ...samples.map(s => s.floor.minMissingArea))

  const unreachable: Partial<CalibrationGrid> = {}
  const changeAreas = tried.minChangeArea.filter(v => v >= floorChange)
  const missingAreas = tried.minMissingArea.filter(v => v >= floorMissing)
  if (changeAreas.length < tried.minChangeArea.length) unreachable.minChangeArea = tried.minChangeArea.filter(v => v < floorChange)
  if (missingAreas.length < tried.minMissingArea.length) unreachable.minMissingArea = tried.minMissingArea.filter(v => v < floorMissing)

  const genuine = samples.filter(s => s.genuine)
  const altered = samples.filter(s => !s.genuine)
  const points: CalibrationPoint[] = []
  for (const minTextScore of tried.minTextScore)
    for (const minChangeArea of changeAreas)
      for (const minMissingArea of missingAreas) {
        const thresholds = { minTextScore, minChangeArea, minMissingArea }
        const falseAccepts = altered.filter(s => documentPasses(s, thresholds)).map(s => s.id)
        const falseReviews = genuine.filter(s => !documentPasses(s, thresholds)).map(s => s.id)
        points.push({
          thresholds,
          falseAccepts,
          falseReviews,
          falseAcceptRate:  rate(falseAccepts.length, altered.length),
          falseReviewRate:  rate(falseReviews.length, genuine.length),
          falseAcceptUpper: upperBound(falseAccepts.length, altered.length),
          falseReviewUpper: upperBound(falseReviews.length, genuine.length),
        })
      }

  points.sort((a, b) => a.falseAccepts.length - b.falseAccepts.length || a.falseReviews.length - b.falseReviews.length)
  const safe = points.filter(p => p.falseAccepts.length === 0)

  return {
    documents: { genuine: genuine.length, altered: altered.length },
    points,
    best:      altered.length > 0 && safe.length > 0 ? safe[0] : null,
    unreachable,
  }
}

/** Whether a sampled document would pass at these thresholds: every page must. */
export function documentPasses (sample: CalibrationSample, thresholds: CalibrationThresholds): boolean {
  return sample.pages.every(page => pagePasses(page, thresholds))
}

function pagePasses (page: SampledPage, thresholds: CalibrationThresholds): boolean {
  return page.textScore >= thresholds.minTextScore && page.findings.every(f => !counts(f, thresholds))
}

function counts (finding: SampledFinding, thresholds: CalibrationThresholds): boolean {
  if (finding.inkArea === null || finding.hasText) return true

  return finding.inkArea >= (finding.kind === 'missing-ink' ? thresholds.minMissingArea : thresholds.minChangeArea)
}

function rate (events: number, trials: number): number | null {
  return trials === 0 ? null : events / trials
}

/** The upper end of the 95% Wilson score interval for `events` in `trials`. */
function upperBound (events: number, trials: number): number | null {
  if (trials === 0) return null
  const p = events / trials
  const z2 = Z * Z
  const centre = p + z2 / (2 * trials)
  const spread = Z * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials))

  return Math.min(1, (centre + spread) / (1 + z2 / trials))
}
