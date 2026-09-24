import { pdfDate } from './pdf-date.mapper'

describe('pdfDate', () => {
  it('reads a UTC date as written', () => {
    expect(pdfDate('D:20260922120000Z')?.toISOString()).toBe('2026-09-22T12:00:00.000Z')
  })

  it('applies an offset, minutes and all', () => {
    expect(pdfDate("D:20260921143000+01'30'")?.toISOString()).toBe('2026-09-21T13:00:00.000Z')
  })

  it('fills in what a shorter date leaves out, and refuses what is not a date at all', () => {
    expect(pdfDate('D:2026')?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(pdfDate('yesterday')).toBeNull()
    expect(pdfDate(null)).toBeNull()
  })
})
