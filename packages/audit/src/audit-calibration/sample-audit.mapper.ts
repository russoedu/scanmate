import { DEFAULT_MIN_CHANGE_AREA, DEFAULT_MIN_MISSING_AREA } from '@scanmate/diff'
import type { ReadablePage } from '@scanmate/ink'

import type { AuditFinding } from '../finding-correlation'
import type { AuditOptions, AuditReport } from '../page-audit'
import type { CalibrationLabel, CalibrationSample, SampledFinding } from './calibration.contract'

/**
 * An audit, reduced to what calibration needs, with the label a person gave it.
 *
 * Pass the options the audit ran with, so the sample knows which area
 * thresholds it was measured at.
 */
export function sampleAudit (report: AuditReport<ReadablePage>, label: CalibrationLabel, options: Pick<AuditOptions, 'diff'> = {}): CalibrationSample {
  return {
    id:      label.id,
    genuine: label.genuine,
    pages:   report.pages.map(({ audit }) => ({
      page:      audit.page,
      textScore: audit.text.score,
      findings:  audit.findings.map(finding => sampleFinding(finding)),
      verdict:   audit.verdict,
    })),
    floor: {
      minChangeArea:  options.diff?.minChangeArea ?? DEFAULT_MIN_CHANGE_AREA,
      minMissingArea: options.diff?.minMissingArea ?? DEFAULT_MIN_MISSING_AREA,
    },
  }
}

function sampleFinding (finding: AuditFinding): SampledFinding {
  const { kind, pixels, text } = finding
  // A mark added or ink lost carries a Change; an expected region's result has an id instead.
  const sized = (kind === 'unexpected-mark' || kind === 'missing-ink') && pixels !== null && !('id' in pixels)

  return { kind, inkArea: sized ? pixels.inkArea : null, hasText: text.length > 0 }
}
