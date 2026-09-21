import type { ScanmateBinarySource } from '@scanmate/ink'

import { inspectDocument } from '../document-inspection'
import type { FieldSpec, LocatablePage, LocatedFields, LocateOptions } from './field-location.contract'
import { resolveFields } from './resolve-fields.use-case'

/**
 * Where a PDF's fields are, found from the labels it prints.
 *
 * ```ts
 * const { regions, problems } = await locateFields('fw9.pdf', [
 *   { anchor: 'Signature of U.S. person', fields: { signature: { dx: 44, dy: -3.8, width: 262, height: 22 } } },
 * ])
 * ```
 *
 * Reads the text layer and renders nothing. The regions are in points from the
 * top-left of each page as displayed - the frame `markPages` draws in and
 * `@scanmate/diff` measures in - so they go straight to either. When every spec
 * names its page, only those pages are read.
 */
export async function locateFields (pdf: ScanmateBinarySource, specs: readonly FieldSpec[], options: LocateOptions = {}): Promise<LocatedFields> {
  const named = specs.map(s => s.page)
  const pages = named.every(p => p !== undefined) && named.length > 0 ? [...new Set(named)] : undefined
  const inspection = await inspectDocument(pdf, { metadata: true, ...(pages && { pages }) })

  const locatable: LocatablePage[] = inspection.pages.map(p => ({
    page:      p.page,
    width:     p.displayWidth,
    height:    p.displayHeight,
    textItems: p.metadata?.textItems ?? [],
  }))

  return resolveFields(locatable, specs, options)
}
