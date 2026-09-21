import { encodeImage, resampleRaster } from '@scanmate/ink'
import type { ReadablePage } from '@scanmate/ink'
import type { PDFFont, PDFPage } from '@cantoo/pdf-lib'

import type { FindingKind } from '../finding-correlation'
import type { AuditReport, PageAudit } from '../page-audit'
import type { EvidencePdfOptions } from './evidence-document.contract'
import { drawable, wrap } from './text-layout.policy'
import type { Measure } from './text-layout.policy'

/** A4 landscape: the evidence image is three pages wide. */
const SHEET = { width: 841.89, height: 595.28 }
const MARGIN = 36
const BODY = 10
const LEADING = 13
/** Most of the sheet the evidence image may take, leaving the rest for what it shows. */
const IMAGE_SHARE = 0.68

const INK = { r: 0.1, g: 0.1, b: 0.1 }
const QUIET = { r: 0.4, g: 0.4, b: 0.4 }
const PASS = { r: 0.1, g: 0.5, b: 0.2 }
const REVIEW = { r: 0.75, g: 0.1, b: 0.1 }

const KIND_NAMES: Readonly<Record<FindingKind, readonly [string, string]>> = {
  'unexpected-mark':     ['unexpected mark', 'unexpected marks'],
  'missing-ink':         ['loss of printed ink', 'losses of printed ink'],
  'text-changed':        ['text changed', 'texts changed'],
  'text-unsettled':      ['reading that could not be settled', 'readings that could not be settled'],
  'text-missing':        ['text missing', 'texts missing'],
  'text-added':          ['text added', 'texts added'],
  'expected-empty':      ['field left empty', 'fields left empty'],
  'expected-overfilled': ['field covered over', 'fields covered over'],
  'checkbox-mismatch':   ['box not as required', 'boxes not as required'],
  'checkbox-struck':     ['box inked over', 'boxes inked over'],
  'checkbox-cleared':    ['box cleared', 'boxes cleared'],
}

/**
 * The audit as one PDF, for whoever reviews it.
 *
 * A cover says the verdict and, page by page, why; then each audited page gets
 * a sheet with its evidence image - the original, the scan and the overlay,
 * findings drawn - and what to look at in words, as real text that can be
 * searched and copied, running on to further sheets when there is a lot. It is
 * one file to store beside the returned document, instead of a folder of
 * images and a report that has to be read in code.
 *
 * The PDF library is loaded when this is called, and not before: auditing on
 * its own never loads it.
 */
export async function writeEvidencePdf (report: AuditReport<ReadablePage>, options: EvidencePdfOptions = {}): Promise<Uint8Array> {
  const { title = 'Audit evidence', pages = 'all', format = 'jpeg', quality = 85, dpi = 200, createdAt = new Date() } = options
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib')
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const drawn = new Set(regular.getCharacterSet())

  document.setTitle(drawable(title, measure(regular, BODY, drawn)))
  document.setSubject(`Verdict: ${report.verdict}`)
  document.setProducer('@scanmate/audit')
  document.setCreationDate(createdAt)
  document.setModificationDate(createdAt)

  /** A sheet being written, top to bottom; a new one is started when this one is full. */
  let sheet: PDFPage = document.addPage([SHEET.width, SHEET.height])
  let y = SHEET.height - MARGIN
  let continuing = ''
  const newSheet = (): void => {
    sheet = document.addPage([SHEET.width, SHEET.height])
    y = SHEET.height - MARGIN
    if (continuing !== '') write(`${continuing} (continued)`, { font: bold, size: 12 })
  }
  function write (text: string, style: { font?: PDFFont, size?: number, color?: typeof INK, indent?: number } = {}): void {
    const { font = regular, size = BODY, color = INK, indent = 0 } = style
    const metric = measure(font, size, drawn)
    const leading = size * (LEADING / BODY)
    const lines = wrap(drawable(text, metric), SHEET.width - 2 * MARGIN - indent, metric)
    for (const line of lines) {
      if (y - leading < MARGIN) newSheet()
      y -= leading
      sheet.drawText(line, { x: MARGIN + indent, y, size, font, color: rgb(color.r, color.g, color.b) })
    }
  }
  const gap = (points: number): void => {
    y -= points
  }

  // --- the cover ---
  const audited = report.pages.map(page => page.audit)
  const reviewed = audited.filter(page => page.verdict === 'review')
  write(title, { font: bold, size: 20 })
  gap(6)
  write(
    report.verdict === 'pass' ? 'Verdict: PASS - nothing for anyone to look at' : `Verdict: REVIEW - ${reviewed.length} of ${audited.length} ${audited.length === 1 ? 'page needs' : 'pages need'} a look`,
    { font: bold, size: 14, color: report.verdict === 'pass' ? PASS : REVIEW },
  )
  write(`Text score ${report.textScore.toFixed(2)} - audited ${createdAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`, { color: QUIET })
  gap(8)
  write(tally(report.summary.findings), { font: bold })
  if (report.summary.corroborated > 0) write(`${report.summary.corroborated} seen by both the reading and the pixel comparison.`, { color: QUIET })
  gap(10)
  for (const page of audited) {
    const first = page.reasons[0]
    const more = page.reasons.length > 1 ? ` (and ${page.reasons.length - 1} more)` : ''
    write(`Page ${page.page}   ${page.verdict === 'pass' ? 'pass' : 'REVIEW'}${first === undefined ? '' : `   ${first}${more}`}`, {
      color: page.verdict === 'pass' ? INK : REVIEW,
    })
  }

  // --- a sheet per page ---
  const sheets = pages === 'review' ? reviewed : audited
  for (const page of sheets) {
    continuing = ''
    newSheet()
    continuing = `Page ${page.page}`
    write(`Page ${page.page} - ${page.verdict === 'pass' ? 'pass' : 'REVIEW'}`, { font: bold, size: 14, color: page.verdict === 'pass' ? PASS : REVIEW })
    write(`Text score ${page.text.score.toFixed(2)} - original | scan | overlay, with every finding drawn`, { color: QUIET })
    gap(6)
    await place(page)
    gap(10)
    describe(page)
  }

  return await document.save()

  /**
   * The evidence image, as large as the sheet allows. It is embedded at `dpi`
   * of the size it is shown at: three pages side by side at the audit's own
   * resolution are several times finer than the sheet can show, and several
   * times the file.
   */
  async function place (page: PageAudit): Promise<void> {
    const raster = page.evidenceRaster
    const room = { width: SHEET.width - 2 * MARGIN, height: (SHEET.height - 2 * MARGIN) * IMAGE_SHARE }
    const scale = Math.min(room.width / raster.width, room.height / raster.height)
    const width = raster.width * scale
    const height = raster.height * scale
    const pixels = Math.round(width / 72 * dpi)
    const shown = raster.width > pixels ? await resampleRaster(raster, pixels, Math.max(1, Math.round(raster.height * pixels / raster.width))) : raster
    const bytes = await encodeImage(shown, { format, quality })
    const image = format === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes)
    y -= height
    sheet.drawImage(image, { x: MARGIN + (room.width - width) / 2, y, width, height })
  }

  /** What to look at on a page, in words. */
  function describe (page: PageAudit): void {
    if (page.reasons.length === 0) write('Nothing to look at on this page.')
    else {
      write('What to look at:', { font: bold })
      for (const reason of page.reasons) write(`- ${reason}`, { indent: 8 })
    }
    if (page.checkboxes.length > 0) {
      gap(4)
      write('Checkboxes:', { font: bold })
      for (const box of page.checkboxes) {
        const asked = box.expect === null ? '' : `, must be ${box.expect}`
        const before = box.original.state === box.scanned.state ? '' : `, ${box.original.state} on the original`
        write(`- ${box.id}: ${box.scanned.state}${before}${asked}`, { indent: 8 })
      }
    }
    if (page.noise.length > 0) {
      gap(4)
      write(`${page.noise.length} ${page.noise.length === 1 ? 'word was' : 'words were'} read differently where the ink is identical, and not counted.`, { color: QUIET })
    }
  }
}

/** The findings, counted in words: "2 texts changed, 1 unexpected mark". */
function tally (counts: Partial<Record<FindingKind, number>>): string {
  const parts = Object.entries(counts)
    .filter((entry): entry is [FindingKind, number] => (entry[1] ?? 0) > 0)
    .map(([kind, count]) => `${count} ${KIND_NAMES[kind][count === 1 ? 0 : 1]}`)

  return parts.length === 0 ? 'No findings.' : `Findings: ${parts.join(', ')}.`
}

function measure (font: PDFFont, size: number, drawn: ReadonlySet<number>): Measure {
  return { width: text => font.widthOfTextAtSize(text, size), covers: codePoint => drawn.has(codePoint) }
}
