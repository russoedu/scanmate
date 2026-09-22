# `@scanmate/seal`

Is a signed PDF still the document that was signed?

The rest of this suite compares a returned document with the one that was issued: pixels, words, fields, boxes. This asks the other question, of a document that came back **born-digital and signed**: has the file changed since someone signed it? A signature answers that in its own bytes, and nothing else here can.

## Install

```bash
npm install @scanmate/seal
```

```ts
import { readFile } from 'node:fs/promises'
import { verifySignatures } from '@scanmate/seal'

const report = await verifySignatures(await readFile('agreement-signed.pdf'))

report.signed                          // the file carries a signature at all
report.unbroken                        // every signature intact, and the last covers the whole file
report.signatures[0].signer?.subject   // CN=A Person, O=A Company
report.signatures[0].problems          // why not, when not
```

## What it checks

| | |
|---|---|
| `intact` | The bytes this signature covers digest to what the signature says, and that digest is signed by the key of the certificate it carries. In short: **the document is, byte for byte, what was signed**. |
| `whole` | The signature covers the whole file. A PDF may be signed and then added to - a second signature, a form filled - so `intact` and not `whole` means "this much is vouched for, and there is more". `uncovered` counts the bytes. |
| `signer` | What the certificate says about itself: subject, issuer, serial, validity, and whether it signed itself. |
| `signedAt` | `/M`, what the signing software recorded. Evidence of nothing on its own - a clock the signer controls - but reported, and compared against the certificate's validity. |

Each problem is named rather than lumped into a boolean: `digest-mismatch` (the document changed, or is not what was signed), `signature-invalid`, `not-covered` (bytes appended after signing), `certificate-expired`, `unreadable`.

## What it does not check, and will not claim

**This does not tell you a signature is legally valid.** That question is about trust, and trust is not in the file:

- **No trust list.** Whether the signing certificate chains to a root anyone recognises - Adobe's AATL, the EU trusted lists, your own organisation's - is not checked. A self-signed certificate made five minutes ago verifies here exactly as a qualified one does, and `signer.selfSigned` is how you tell them apart.
- **No revocation.** A certificate revoked the day after signing still verifies. OCSP and CRL are network protocols with their own failure modes, and answering them badly is worse than not answering.
- **No timestamp validation.** A signature timestamp, where one exists, is not checked against a time authority; `signedAt` is only what the file says.
- **It does not sign.** This reads and verifies; it never writes a signature.

What is left is the part that *is* in the file, and it is the part that catches a document edited after signing - which is the question this suite exists to ask. Treat `unbroken: true` as "the bytes are as signed", and answer "should this signer be trusted?" with your own policy, or with a qualified validation service.

## How it reads a PDF

By its bytes, with no PDF library. That is not a shortcut: `/Contents` holds a signature over the file's own bytes, so a signature dictionary cannot be compressed into an object stream or encrypted without the offsets in `/ByteRange` ceasing to mean anything. Every signed PDF therefore carries its signatures in plain sight - and reading them this way still works on a file too damaged for a parser to open, which is exactly the file whose signature you most want to check. A spec covers that case: a wrecked cross-reference table, a signature still read, and the tampering reported.

The cryptography is [`pkijs`](https://pkijs.org) over Node's own WebCrypto. The tests sign for real: a key, a self-signed certificate and a PDF signed over its `/ByteRange`, made in the test rather than committed as a fixture, because a fixture cannot prove a verifier works.

## What it has been tried on

Signatures this package makes itself, in its tests: RSA with SHA-256, one signer, a detached CMS in `adbe.pkcs7.detached`, with the certificate carried in the signature. Those cover the paths that matter - digest, signature, coverage, dates - and each failure is provoked rather than imagined: a byte changed, bytes appended, a certificate out of date, a wrecked cross-reference table.

**It has not yet been run against a signature from Adobe Acrobat, Adobe Sign, DocuSign or a qualified European provider.** Those use the same standards, and `pkijs` implements them - ECDSA and RSA-PSS keys, `ETSI.CAdES.detached`, full certificate chains, signature timestamps - so they are expected to verify. Expected is not measured: until a real signed document has been through it, treat that as a reasonable belief about a library rather than a result. A file of yours is the way to settle it.

## Alongside the rest

```ts
const report = await verifySignatures(returned)
if (!report.unbroken) {
  // The file changed after it was signed: no comparison of pixels is needed to know that.
}

// And for what the paper says, rather than what the bytes do:
const audit = await new Scanmate(issued, returned).audit()
```

A born-digital return with an unbroken signature still needs the audit: a signature proves nobody edited the file, not that the document says what was agreed.
