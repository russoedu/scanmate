/** `D:20260921143000+01'00'` - a PDF date, or `null` when it is missing or malformed. */
export function pdfDate (written: string | null): Date | null {
  if (written === null) return null
  const parts = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Z])(\d{2})'?(\d{2})?)?/.exec(written.trim())
  if (parts === null) return null
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', sign, offsetHours = '00', offsetMinutes = '00'] = parts
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  const offset = sign === undefined || sign === 'Z' ? 0 : (Number(offsetHours) * 60 + Number(offsetMinutes)) * (sign === '-' ? -1 : 1)
  const when = new Date(utc - offset * 60_000)

  return Number.isNaN(when.getTime()) ? null : when
}
