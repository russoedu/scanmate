/**
 * `@scanmate/seal` - is a signed PDF still the document that was signed?
 *
 * ```ts
 * import { verifySignatures } from '@scanmate/seal'
 *
 * const report = await verifySignatures(await readFile('agreement.pdf'))
 * report.unbroken                      // every signature intact, and the last covers the whole file
 * report.signatures[0].signer?.subject  // CN=A Person, O=A Company
 * report.signatures[0].problems         // why not, when not
 * ```
 *
 * The rest of this suite compares a returned document with the one that was
 * issued. This asks the other question, of a born-digital return: has the file
 * changed since it was signed? A signature answers that in its own bytes, and
 * nothing else in the suite can.
 *
 * It does not say a signature is legally valid. See the README for the line
 * between the two, and for what is deliberately not checked.
 */

export { findSignatureFields } from './signature-fields'
export type { SignatureField } from './signature-fields'
export { verifySignatures } from './signature-verification'
export type { SealReport, SignatureCheck, SignatureProblem, Signer } from './signature-verification'
