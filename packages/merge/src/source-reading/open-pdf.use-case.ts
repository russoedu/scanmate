import { PDFDocument } from '@cantoo/pdf-lib'

/** A PDF that needs a password to open, which was not given or did not work. */
export class PdfPasswordError extends Error {
  /** Whether a password was given at all - wrong, or missing. */
  readonly given: boolean

  constructor (given: boolean) {
    super(given
      ? 'this PDF is encrypted, and the password given does not open it'
      : 'this PDF is encrypted with a password it needs to be opened - pass `password`')
    this.name = 'PdfPasswordError'
    this.given = given
  }
}

export interface OpenPdfOptions {
  /**
   * The password that opens the document, for a PDF encrypted with one.
   *
   * Not needed for the usual encrypted PDF - a signed or permission-restricted
   * document, locked with an owner password and nothing else - which opens with
   * no password at all and is decrypted as it is read.
   */
  password?: string
}

/**
 * Opens a PDF for writing, decrypting it if it is encrypted.
 *
 * Signed documents usually arrive encrypted: an owner password restricting
 * what may be done with them, and no password needed to read them. pdf-lib
 * refuses those outright, and its own error suggests `ignoreEncryption: true`.
 * That is not taken here, because it is measured to be wrong for anything that
 * writes: the document loads and saves and still opens, with its text intact,
 * but whatever was drawn on it is silently missing - written unencrypted into a
 * file that still declares itself encrypted, so a viewer "decrypts" it into
 * nothing. A helper that draws marks would hand back a clean PDF with no marks
 * and no error.
 *
 * Decrypting instead is correct, and costs a caller nothing in the common case:
 * the empty password opens an owner-password-only document. Only a PDF that
 * needs a password to be read at all needs one given.
 *
 * Nor is the document loaded for incremental update, which would keep the
 * original bytes intact and with them an existing digital signature. That is
 * measured too: on an encrypted document the original page content does not
 * survive it. A marked copy is for looking at; it is not the signed document,
 * and does not pretend to be.
 */
export async function openPdf (bytes: Uint8Array, { password }: OpenPdfOptions = {}): Promise<PDFDocument> {
  // The password given first, then none. A caller's password is for the document
  // that needs one; tried alone it would lock out the owner-password-only PDF that
  // needed nothing - which is what happened when one password was applied to every
  // source of a merge. The empty password opens only what anyone may read anyway.
  const attempts = password === undefined || password === '' ? [''] : [password, '']
  for (const attempt of attempts)
    try {
      // An empty password changes nothing for a document that is not encrypted.
      return await PDFDocument.load(bytes, { password: attempt, updateMetadata: false })
    } catch (error) {
      // pdf-lib reports these as plain errors: "NEEDS PASSWORD", "Password incorrect".
      if (!(error instanceof Error) || !/password/i.test(error.message)) throw error
    }

  throw new PdfPasswordError(password !== undefined)
}
