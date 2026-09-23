/**
 * Audits a labelled corpus once, then sweeps every threshold over what it saw.
 *
 * Auditing is the slow part - the reading, the pixel comparison, the settled
 * disputes - and what a threshold decides on is a few numbers per page. So the
 * samples are written out: a corpus audited overnight can be re-swept in
 * milliseconds with any thresholds, by this script or by `calibrateAudit`.
 *
 *   node tools/calibration/run-calibration.mjs [--corpus corpus]
 *
 * The audit runs with the area thresholds set **low**, because the pixel
 * comparison reports nothing below its own thresholds and a sweep cannot
 * discover what a lower one would have seen. Raise, never lower.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { Scanmate } from '@scanmate/scan'

const { values } = parseArgs({ options: { corpus: { type: 'string', default: 'corpus' } } })
const { original, cases } = JSON.parse(readFileSync(join(values.corpus, 'cases.json'), 'utf8'))
const started = Date.now()

const { report, samples } = await Scanmate.calibrate(
  cases.map(one => ({
    id:       one.id,
    genuine:  one.genuine,
    original,
    scanned:  readFileSync(one.file),
    // One page of the original against the one page this case was cut from.
    options:  { extract: { pages: [one.page] } },
  })),
  {
    diff:   { minChangeArea: 0.5, minMissingArea: 2 },
    onCase: ({ index, id, sample }) =>
      console.log(`${index}/${cases.length} ${id.padEnd(28)} pages ${sample.pages.map(page => `${page.verdict}@${page.textScore.toFixed(2)}`).join(',')}`),
  },
)

writeFileSync(join(values.corpus, 'samples.json'), JSON.stringify(samples, null, 1))
writeFileSync(join(values.corpus, 'report.json'), JSON.stringify(report, null, 1))

const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`\naudited ${cases.length} documents in ${seconds} s | genuine ${report.documents.genuine}, altered ${report.documents.altered}`)

const percent = rate => `${(rate * 100).toFixed(0)}%`
console.log('\nthresholds                                  false accepts  false reviews')
for (const point of report.points.slice(0, 8)) {
  const { minTextScore, minChangeArea, minMissingArea } = point.thresholds
  const accepts = `${String(point.falseAccepts.length).padStart(6)} (<=${percent(point.falseAcceptUpper)})`
  const reviews = `${String(point.falseReviews.length).padStart(6)} (<=${percent(point.falseReviewUpper)})`
  console.log(`score>=${minTextScore} change>=${minChangeArea}mm2 missing>=${minMissingArea}mm2  ${accepts}  ${reviews}`)
}

console.log('\nbest:', JSON.stringify(report.best?.thresholds),
  '| false accepts', report.best?.falseAccepts.length,
  '| false reviews', report.best?.falseReviews.length, report.best?.falseReviews.join(','))
