# scanmate-seal

Is a signed PDF still the document that was signed?

A **parallel port** of [`@scanmate/seal`][ts], not a replacement for it. The
TypeScript remains the reference, and the only useful definition of "correct"
for this package is that it reaches the same verdict — on the same bytes, for
the same reasons — as the TypeScript it parallels.

```sh
pip install scanmate-seal
```

```python
from pathlib import Path
from scanmate_seal import verify_signatures

report = verify_signatures(Path("agreement.pdf").read_bytes())
report.unbroken                       # every signature intact, and the last covers the whole file
report.signatures[0].signer.subject   # CN=A Person, O=A Company
report.signatures[0].problems         # why not, when not
```

## Why it exists

The rest of this suite compares a returned document with the one that was
issued. This asks the other question, of a born-digital return: **has the file
changed since it was signed?** A signature answers that in its own bytes, and
nothing else in the suite can.

Per signature, four findings that stay separate on purpose:

1. The bytes the signature covers digest to what the signature says they do.
2. That digest is signed by the key of the certificate it carries.
3. How much of the file lies outside the signed ranges.
4. Whether the certificate was in date when the file says it was signed.

They stay separate because they mean different things. A PDF may be signed and
then legitimately added to — a second signature, a form field filled — and those
later bytes are outside the first signature. *Intact but not whole* is "this
much of the file is vouched for, and there is more", which is not the same as
"this file was tampered with". Likewise an expired certificate does not make a
file broken: `unbroken` is a statement about bytes, not about trust.

## No PDF parser

Nothing here opens the PDF. Signature dictionaries are read from the file's own
bytes, and that is by construction rather than by luck: `/Contents` holds the
signature over the file, so it cannot be compressed into an object stream or
encrypted without the offsets in `/ByteRange` ceasing to mean anything. Every
signed PDF therefore carries its signatures in plain sight.

Which is also why this still reads a file a parser would refuse — and when the
question is whether a file was tampered with, that is exactly the file you have.

## What it does not say

It does **not** say a signature is legally valid. That is a question about trust
lists, revocation, timestamps and jurisdiction, and this package checks none of
them:

- no certificate chain is built or validated against a trust store
- no revocation is checked (no CRL, no OCSP)
- no timestamp token is verified
- `/Name` and `/Reason` are what the signing software wrote, not evidence

"The bytes still match the signature, and here is the certificate that made it"
is a narrower claim, and it is the one this package makes.

## Two departures from the TypeScript

**`verify_signatures` is not `async`.** `verifySignatures` is, because pkijs
reaches WebCrypto through a promise — not because the algorithm waits on
anything. No step of this does I/O, so an `async def` here would be a coroutine
that never yields. The departure is in the calling convention only.

**A `SignatureProblem` is one class, not a union of five.** TypeScript's
discriminated union maps to a single dataclass with `kind` as the discriminant
and an optional payload, rather than to five near-empty classes.

Everything else is held to the TypeScript by goldens generated from the real
build, over committed signed-PDF fixtures. The one value deliberately *not* held
to parity is `SignatureProblem.because`, which is whichever library phrased a
malformed CMS structure; no two phrase it alike. The `kind` is the contract.

## Requirements

Python 3.11 or newer. Fully typed (PEP 561), `mypy --strict` clean.

Signature parsing is [`asn1crypto`][asn1crypto] and signature checking is
[`cryptography`][cryptography] — two libraries where the TypeScript uses one,
because `cryptography` ships no complete CMS `SignedData` reader and
`asn1crypto` does no cryptography at all.

[ts]: https://github.com/russoedu/scanmate/tree/main/packages/seal#readme
[asn1crypto]: https://github.com/wbond/asn1crypto
[cryptography]: https://cryptography.io/
