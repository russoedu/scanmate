import type { AuditReport } from '@scanmate/audit'
import type { ReadablePage } from '@scanmate/ink'
import type { PageDiff } from '@scanmate/diff'
import type { OcrEngine, OcrReport } from '@scanmate/ocr'

/**
 * What an audit already worked out, pulled back out of its report.
 *
 * `auditPages` runs the reading and the pixel comparison itself, and keeps both
 * on the report it returns - `PageAudit.text` is the whole `PageOcr`,
 * `PageAudit.pixels` the whole `PageDiff`. So a session that audits first has
 * already paid for `ocr()` and `diff()`, and should hand the answers over
 * rather than compute them twice.
 *
 * The catch, and the reason this is a mapper with a comment rather than two
 * lines inline: audit runs its own diff with `sideBySide: false`, and drops the
 * masks afterwards. A projected `PageDiff` therefore always has
 * `sideBySideRaster: null` and `masks: null`. Handed to a caller who asked for
 * either, that is a `null` where they asked for a picture - a wrong answer,
 * silently. So the session only files the pixels when its diff settings ask for
 * neither; the reading has no such catch, since audit reads with exactly the
 * settings it was given.
 */

export function readingFromAudit<Page extends ReadablePage> (report: AuditReport<Page>, engine: OcrEngine): OcrReport<Page> {
  const pages = report.pages.map(page => ({ ...page, text: page.audit.text }))
  const readings = pages.map(page => page.text)

  return {
    score:    report.textScore,
    pageMean: readings.length === 0 ? 1 : readings.reduce((sum, reading) => sum + reading.score, 0) / readings.length,
    pages,
    engine:   { name: engine.name, version: engine.version, languages: engine.languages },
  }
}

export function pixelsFromAudit<Page extends ReadablePage> (report: AuditReport<Page>): Array<Page & { diff: PageDiff }> {
  return report.pages.map(page => ({ ...page, diff: page.audit.pixels }))
}
