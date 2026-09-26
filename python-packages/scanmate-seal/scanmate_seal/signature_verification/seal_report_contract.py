"""What a check of a signed PDF reports."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True, slots=True)
class Signer:
    """Who a certificate says it belongs to, and when it was valid."""

    #: The certificate's subject, as written: ``CN=A Person, O=A Company, C=GB``.
    subject: str
    #: Who issued it. Equal to :attr:`subject` when the certificate signed itself.
    issuer: str
    serial_number: str
    not_before: datetime
    not_after: datetime
    #: Its own issuer: nothing above it vouches for it.
    self_signed: bool


@dataclass(frozen=True, slots=True)
class SignatureProblem:
    """One thing wrong with a signature.

    A single class with an optional payload, rather than the TypeScript's
    discriminated union, because that is what a union maps to in Python without
    inventing five near-empty classes. :attr:`kind` is the discriminant and
    carries the same five spellings.

    ``bytes_uncovered`` is set only for ``not-covered``; ``signed_at`` only for
    ``certificate-expired``; ``because`` only for ``unreadable``.
    """

    #: One of ``digest-mismatch``, ``signature-invalid``, ``not-covered``,
    #: ``certificate-expired``, ``unreadable``.
    kind: str
    #: ``not-covered``: bytes of the file outside every ``/ByteRange``.
    bytes_uncovered: int | None = None
    #: ``certificate-expired``: when the file says it was signed.
    signed_at: datetime | None = None
    #: ``unreadable``: why the signature could not be read.
    #:
    #: The one value in this package that is NOT held to the TypeScript. It is
    #: whichever library phrased the failure, and no two libraries phrase a
    #: malformed CMS structure alike. The *kind* is the contract; this is a
    #: human-readable aside.
    because: str | None = None


@dataclass(frozen=True, slots=True)
class SignatureCheck:
    """One signature, checked."""

    #: ``/Name``, what the signing software recorded. The certificate is the
    #: evidence; this is a label.
    name: str | None
    #: ``/SubFilter``: how the signature is packaged.
    sub_filter: str | None
    reason: str | None
    location: str | None
    #: When the signing software says it signed, ``None`` when it said nothing
    #: or wrote nonsense.
    signed_at: datetime | None
    #: The bytes this signature covers verify against it: the document is, byte
    #: for byte, what this signature was made over.
    intact: bool
    #: It covers the whole file. A PDF may be signed and then added to - a
    #: second signature, a form filled - and those later bytes are outside this
    #: signature. Intact and not whole means "this much of the file is vouched
    #: for, and there is more".
    whole: bool
    #: Bytes of the file this signature does not cover.
    uncovered: int
    #: The certificate that signed, when one could be read.
    signer: Signer | None
    #: Everything wrong. Empty when the signature is intact, whole and in date.
    problems: list[SignatureProblem] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class SealReport:
    """Every signature in a file, and whether the file still holds together."""

    #: The file carries at least one signature dictionary.
    signed: bool
    #: Every signature, in the order the file holds them.
    signatures: list[SignatureCheck]
    #: Every signature is intact, and the last of them covers the whole file.
    unbroken: bool
