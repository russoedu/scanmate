"""``scanmate-seal`` - is a signed PDF still the document that was signed?

.. code-block:: python

    from pathlib import Path
    from scanmate_seal import verify_signatures

    report = verify_signatures(Path("agreement.pdf").read_bytes())
    report.unbroken                       # every signature intact, last covers the file
    report.signatures[0].signer.subject   # CN=A Person, O=A Company
    report.signatures[0].problems         # why not, when not

The rest of this suite compares a returned document with the one that was
issued. This asks the other question, of a born-digital return: has the file
changed since it was signed? A signature answers that in its own bytes, and
nothing else in the suite can.

It does not say a signature is legally *valid*. See the README for the line
between the two, and for what is deliberately not checked.
"""

from .signature_fields import SignatureField, find_signature_fields
from .signature_verification import (
    SealReport,
    SignatureCheck,
    SignatureProblem,
    Signer,
    verify_signatures,
)

__all__ = [
    "SealReport",
    "SignatureCheck",
    "SignatureField",
    "SignatureProblem",
    "Signer",
    "find_signature_fields",
    "verify_signatures",
]
