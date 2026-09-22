/** Who a certificate says it belongs to, and when it was valid. */
export interface Signer {
  /** The certificate's subject, as written: `CN=A Person, O=A Company, C=GB`. */
  subject:      string
  /** Who issued it. Equal to `subject` when the certificate signed itself. */
  issuer:       string
  serialNumber: string
  notBefore:    Date
  notAfter:     Date
  /** Its own issuer: nothing above it vouches for it. */
  selfSigned:   boolean
}

export type SignatureProblem =
  /** The signature does not match the bytes it covers: the document changed after signing, or is not what was signed. */
  | { kind: 'digest-mismatch' } |
  /** The signature is not valid for the certificate's key. */
  { kind: 'signature-invalid' } |
  /** Bytes of the file lie outside every `/ByteRange`: something was appended or changed after signing. */
  { kind: 'not-covered', bytes: number } |
  /** The certificate was not valid when the file says it was signed. */
  { kind: 'certificate-expired', signedAt: Date } |
  /** The signature could not be read at all. */
  { kind: 'unreadable', because: string }

/** One signature, checked. */
export interface SignatureCheck {
  /** `/Name`, what the signing software recorded. The certificate is the evidence; this is a label. */
  name:      string | null
  /** `/SubFilter`: how the signature is packaged. */
  subFilter: string | null
  reason:    string | null
  location:  string | null
  /** When the signing software says it signed, `null` when it said nothing or wrote nonsense. */
  signedAt:  Date | null
  /**
   * The bytes this signature covers verify against it: the document is, byte
   * for byte, what this signature was made over.
   */
  intact:    boolean
  /**
   * It covers the whole file. A PDF may be signed and then added to - a second
   * signature, a form filled - and those later bytes are outside this
   * signature. Intact and not whole means "this much of the file is vouched
   * for, and there is more".
   */
  whole:     boolean
  /** Bytes of the file this signature does not cover. */
  uncovered: number
  /** The certificate that signed, when one could be read. */
  signer:    Signer | null
  /** Everything wrong. Empty when the signature is intact, whole and in date. */
  problems:  SignatureProblem[]
}

export interface SealReport {
  /** The file carries at least one signature dictionary. */
  signed:     boolean
  /** Every signature, in the order the file holds them. */
  signatures: SignatureCheck[]
  /** Every signature is intact, and the last of them covers the whole file. */
  unbroken:   boolean
}
