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

    // The dictionary /ByteRange belongs to, found by balancing brackets rather
    // than by taking the nearest `<<`. A real signature dictionary holds nested
    // dictionaries - /Prop_Build names the signing software, and inside it /App
    // names the application - so the nearest `<<` is usually one of those, and
    // everything the enclosing dictionary says, /SubFilter included, would be
    // missed. Measured: on two real signed PDFs, one signed through Adobe Sign,
    // the nearest-`<<` reading found no /SubFilter at all.
    const start = enclosingDictionary(text, match.index)
    if (start === null) continue
    const end = closingBracket(text, start)
    if (end === null) continue
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

/** Where the dictionary containing `at` begins: backwards, counting brackets. */
function enclosingDictionary (text: string, at: number): number | null {
  let depth = 0
  for (let i = at - 2; i >= 0; i--) {
    const pair = text.slice(i, i + 2)
    // Each bracket is consumed whole: a run of `>>>>` closes two dictionaries,
    // and counting it as three - which reading every position does - leaves the
    // depth permanently wrong. PDFs are full of such runs.
    if (pair === '>>') {
      depth++
      i--
    } else if (pair === '<<') {
      if (depth === 0) return i
      depth--
      i--
    }
  }

  return null
}

/** Where that dictionary ends: forwards from its `<<`, counting brackets. */
function closingBracket (text: string, start: number): number | null {
  let depth = 0
  for (let i = start; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2)
    if (pair === '<<') {
      depth++
      i++
    } else if (pair === '>>') {
      depth--
      if (depth === 0) return i
      i++
    }
  }

  return null
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
