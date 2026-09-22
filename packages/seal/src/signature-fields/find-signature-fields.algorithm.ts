import type { SignatureField } from './signature-field.contract'

/**
 * Every signature dictionary in a PDF, read from the file's own bytes.
 *
 * A signature is the one part of a PDF that cannot be hidden from a reader like
 * this, and that is by construction rather than by luck: `/Contents` holds the
 * signature over the file's bytes, so it cannot be compressed into an object
 * stream or encrypted without the offsets in `/ByteRange` ceasing to mean
 * anything. Every signed PDF therefore carries its signature dictionaries in
 * plain sight, which is why this needs no PDF parser and no PDF library - and
 * why it still works on a file a parser would refuse, which matters when the
 * question is whether the file was tampered with.
 *
 * What is read here is only what the file claims. Nothing is trusted until
 * `verifySignatures` has checked the bytes against the signature.
 */
export function findSignatureFields (pdf: Uint8Array): SignatureField[] {
  const text = new TextDecoder('latin1').decode(pdf)
  const fields: SignatureField[] = []

  for (const match of text.matchAll(/\/ByteRange\s*\[([^\]]*)\]/g)) {
    const numbers = match[1].trim().split(/\s+/).map(Number)
    if (numbers.length !== 4 || numbers.some(n => !Number.isFinite(n))) continue

    // The dictionary the /ByteRange belongs to: from the nearest `<<` before it
    // to the `>>` that closes it, which is where /Contents and the rest live.
    const start = text.lastIndexOf('<<', match.index)
    const end = text.indexOf('>>', match.index)
    if (start === -1 || end === -1) continue
    const dictionary = text.slice(start, end)
    const contents = /\/Contents\s*<([\da-fA-F\s]*)>/.exec(dictionary)
    if (contents === null) continue

    fields.push({
      byteRange: numbers as [number, number, number, number],
      contents:  hex(contents[1]),
      subFilter: name(dictionary, 'SubFilter'),
      name:      literal(dictionary, 'Name'),
      signedAt:  literal(dictionary, 'M'),
      reason:    literal(dictionary, 'Reason'),
      location:  literal(dictionary, 'Location'),
      offset:    start,
    })
  }

  return fields
}

/** `/Key /Value` - a name, as `/SubFilter` is. */
function name (dictionary: string, key: string): string | null {
  return new RegExp(String.raw`/${key}\s*/([^\s/<>\]]+)`).exec(dictionary)?.[1] ?? null
}

/** `/Key (value)` or `/Key <hex>` - a string, as `/Name` and `/M` are. */
function literal (dictionary: string, key: string): string | null {
  const plain = new RegExp(String.raw`/${key}\s*\(((?:\\.|[^\\)])*)\)`).exec(dictionary)
  if (plain !== null) return plain[1].replaceAll(/\\([()\\])/g, '$1')
  const encoded = new RegExp(String.raw`/${key}\s*<([\da-fA-F\s]*)>`).exec(dictionary)
  if (encoded === null) return null
  const bytes = hex(encoded[1])

  // A hex string is UTF-16BE when it starts with a byte-order mark, else PDFDoc.
  return bytes[0] === 0xFE && bytes[1] === 0xFF
    ? new TextDecoder('utf-16be').decode(bytes.subarray(2))
    : new TextDecoder('latin1').decode(bytes)
}

function hex (source: string): Uint8Array {
  const digits = source.replaceAll(/\s/g, '')
  const even = digits.length % 2 === 0 ? digits : `${digits}0`
  const out = new Uint8Array(even.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(even.slice(i * 2, i * 2 + 2), 16)

  return out
}
