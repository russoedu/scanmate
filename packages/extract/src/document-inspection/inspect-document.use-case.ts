import { inspectPage } from '../page-inspection'
import type { PageMetadata } from '../page-inspection'
import { selectPages } from '../page-extraction'
import { openPdf } from '../pdf-document'
import type { OpenedPdf } from '../pdf-document'
import type { DocumentInfo, DocumentInspection, InspectedPage, InspectOptions } from './document-inspection.contract'
import type { ScanmateBinarySource } from '@scanmate/ink'

/**
 * What a PDF is, before anything is rendered: how many pages, what size, which
 * way up, and who made it.
 *
 * This is the fail-fast step. A signed copy with the wrong page count, a page
 * with no size, or a file that will not open is known here in milliseconds, not
 * after a minute of rendering and aligning. A file that cannot be parsed throws,
 * as does a page whose size is not a positive finite number - nothing later can
 * make sense of it.
 */
export async function inspectDocument (pdf: ScanmateBinarySource, options: InspectOptions = {}): Promise<DocumentInspection> {
  const { pages: selection, metadata = false } = options

  const opened = await openPdf(pdf)
  try {
    const { document } = opened
    const pages: InspectedPage[] = []

    for (const number of selectPages(selection, document.numPages)) {
      const page = await document.getPage(number)
      try {
        const [x0, y0, x1, y1] = page.view
        const pointWidth = x1 - x0
        const pointHeight = y1 - y0
        if ([pointWidth, pointHeight].some(v => !Number.isFinite(v) || v <= 0))
          throw new RangeError(`page ${number} has no usable size (${pointWidth} x ${pointHeight} points)`)

        const rotation = normaliseRotation(page.rotate)
        const sideways = rotation === 90 || rotation === 270
        const meta: PageMetadata | null = metadata ? await inspectPage(page) : null

        pages.push({
          page:          number,
          pointWidth,
          pointHeight,
          rotation,
          displayWidth:  sideways ? pointHeight : pointWidth,
          displayHeight: sideways ? pointWidth : pointHeight,
          box:           { x: x0, y: y0, width: pointWidth, height: pointHeight },
          metadata:      meta,
        })
      } finally {
        page.cleanup()
      }
    }

    return { pageCount: document.numPages, byteLength: opened.byteLength, info: await readInfo(opened.document), pages }
  } finally {
    await opened.close()
  }
}

async function readInfo (document: OpenedPdf['document']): Promise<DocumentInfo> {
  let fields: Record<string, unknown> = {}
  try {
    const metadata = await document.getMetadata()
    fields = metadata.info as Record<string, unknown>
  } catch {
    // A damaged info dictionary says nothing about the pages; report it empty.
  }
  const text = (key: string): string | null => {
    const value = fields[key]

    return typeof value === 'string' && value.trim() !== '' ? value : null
  }

  return {
    title:            text('Title'),
    author:           text('Author'),
    subject:          text('Subject'),
    creator:          text('Creator'),
    producer:         text('Producer'),
    pdfVersion:       text('PDFFormatVersion'),
    creationDate:     text('CreationDate'),
    modificationDate: text('ModDate'),
  }
}

function normaliseRotation (rotate: number): InspectedPage['rotation'] {
  const r = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360

  return r as InspectedPage['rotation']
}
