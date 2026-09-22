/** A signature dictionary as the file holds it, before anything is verified. */
export interface SignatureField {
  /**
   * The four numbers of `/ByteRange`: offset and length of the bytes before the
   * signature, then offset and length of the bytes after it. Everything outside
   * them - the signature's own hex string - is what the signature cannot cover.
   */
  byteRange: [number, number, number, number]
  /** The signature itself: the DER of a CMS `SignedData`, from `/Contents`. */
  contents:  Uint8Array
  /** `/SubFilter`: how the signature is packaged, e.g. `adbe.pkcs7.detached` or `ETSI.CAdES.detached`. */
  subFilter: string | null
  /** `/Name`: who the signing software says signed it. Not evidence of anything - the certificate is. */
  name:      string | null
  /** `/M`: when the signing software says it was signed, as written (`D:20260921120000Z`). */
  signedAt:  string | null
  reason:    string | null
  location:  string | null
  /** Where the dictionary starts in the file, for reporting. */
  offset:    number
}
