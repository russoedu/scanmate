import type { Change, ExpectedResult } from '../change-detection'
import type { CheckboxReading, CheckboxState } from '../checkbox-reading'
import type { TextDifference } from '@scanmate/ocr'

import { correlateFindings } from './correlate-findings.use-case'

const box = (x: number, y: number, width = 60, height = 12) => ({ x, y, width, height })

function text (kind: TextDifference['kind'], at: ReturnType<typeof box>, expected: string | null, found: string | null, reason: TextDifference['reason'] = 'text'): TextDifference {
  return { kind, expected, found, similarity: 0.5, reason, ...at }
}

function change (at: ReturnType<typeof box>): Change {
  return { ...at, inkArea: 12, pixels: 200 }
}

function region (id: string, at: ReturnType<typeof box>, identified: boolean, overfilled = false): ExpectedResult {
  const ink = { changes: identified ? 1 : 0, largestArea: 0, bounds: null, widthRatio: 0, heightRatio: 0, edgeTouch: 0, fill: overfilled ? 0.8 : 0.02, formLines: 0 }

  return { id, identified, addedInk: identified ? 20 : 0, removedInk: 0, score: identified ? 1 : 0, overfilled, ink, ...at }
}

const NONE = { expected: [], unexpected: [], missing: [] }

function checkbox (id: string, original: CheckboxState, scanned: CheckboxState, expect: 'ticked' | 'empty' | null = null): CheckboxReading {
  const side = (state: CheckboxState) => ({ state, ink: state === 'empty' ? 0 : 2, fill: state === 'struck' ? 1 : 0.2, solid: state === 'struck' ? 1 : 0 })

  return {
    id,
    page:      1,
    box:       box(40, 400, 12, 12),
    original:  side(original),
    scanned:   side(scanned),
    changed:   original !== scanned,
    expect,
    satisfied: expect === null ? null : scanned === expect,
  }
}

describe('correlateFindings', () => {
  it('keeps what only the reading saw: a figure changed within the pixel tolerance', () => {
    const { findings } = correlateFindings({ text: [text('changed', box(500, 140), 'Total 1,250.00', 'Total 7,250.00', 'numbers')], pixels: NONE })

    expect(findings).toMatchObject([{ kind: 'text-changed', corroborated: false, summary: 'Printed "Total 1,250.00" reads "Total 7,250.00" - its figures differ' }])
  })

  it('makes a mark both comparisons saw into one finding, corroborated', () => {
    const { findings } = correlateFindings({
      text:   [text('added', box(402, 302, 40, 10), null, 'VOID')],
      pixels: { ...NONE, unexpected: [change(box(400, 300))] },
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'unexpected-mark', corroborated: true, summary: 'Ink added where nothing was expected, reading "VOID"' })
    expect(findings[0].text).toHaveLength(1)
  })

  it('makes lost ink and the text lost with it one finding', () => {
    const { findings } = correlateFindings({
      text:   [text('missing', box(20, 120, 200), 'The Customer may terminate', null)],
      pixels: { ...NONE, missing: [change(box(18, 118, 210, 16))] },
    })

    expect(findings).toMatchObject([{ kind: 'missing-ink', corroborated: true, summary: 'Printed ink lost, and with it "The Customer may terminate"' }])
  })

  it('explains words read inside an expected region, and a label written across in a filled one', () => {
    const signature = region('signature', box(80, 220, 480, 40), true)
    const { findings, explained } = correlateFindings({
      text: [
        text('added', box(200, 230, 40, 12), null, 'Ae dhe'),
        text('changed', box(75, 225, 45, 12), 'Signature', 'Signatune'),
      ],
      pixels: { ...NONE, expected: [signature] },
    })

    expect(findings).toEqual([])
    expect(explained.map(e => [e.difference.found, e.region])).toEqual([['Ae dhe', 'signature'], ['Signatune', 'signature']])
  })

  it('does not explain a changed label under a region left empty', () => {
    const { findings } = correlateFindings({
      text:   [text('changed', box(75, 225, 45, 12), 'Signature', 'Signatune')],
      pixels: { ...NONE, expected: [region('signature', box(80, 220, 480, 40), false)] },
    })

    expect(findings.map(f => f.kind)).toEqual(['text-changed', 'expected-empty'])
  })

  it('reports expected regions left empty or blacked out', () => {
    const { findings } = correlateFindings({ text: [], pixels: { ...NONE, expected: [region('name', box(60, 200), false), region('title', box(320, 200), false, true)] } })

    expect(findings.map(f => [f.kind, f.subject, f.summary])).toEqual([
      ['expected-empty', 'name', '"name" was left empty'],
      ['expected-overfilled', 'title', '"title" is covered, not filled in'],
    ])
  })

  it('reads a box, never calls it a field left empty, and reports only what is wrong with it', () => {
    const boxes = [
      checkbox('optional-empty', 'empty', 'empty'),
      checkbox('optional-ticked', 'empty', 'ticked'),
      checkbox('required', 'empty', 'empty', 'ticked'),
      checkbox('scribbled', 'empty', 'struck'),
      checkbox('pre-ticked-cleared', 'ticked', 'empty'),
      checkbox('pre-ticked-kept', 'ticked', 'ticked'),
    ]
    const { findings } = correlateFindings({
      text:       [],
      pixels:     { ...NONE, expected: boxes.map(b => region(b.id, box(40, 400, 12, 12), b.scanned.state !== 'empty')) },
      checkboxes: boxes,
    })

    expect(findings.map(f => [f.kind, f.subject, f.summary])).toStrictEqual([
      ['checkbox-mismatch', 'required', '"required" must be ticked, and is empty'],
      ['checkbox-struck', 'scribbled', '"scribbled" is inked over: whether it is ticked cannot be told'],
      ['checkbox-cleared', 'pre-ticked-cleared', '"pre-ticked-cleared" was ticked on the original and is empty on the scan'],
    ])
    expect(findings[0].checkbox).toBe(boxes[2])
  })
})
