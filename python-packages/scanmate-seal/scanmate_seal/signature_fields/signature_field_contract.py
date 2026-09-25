"""A signature dictionary as the file holds it, before anything is verified."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SignatureField:
    """What a PDF claims about one of its signatures.

    Nothing here is evidence. It is what the file says about itself, read from
    its own bytes; :func:`~scanmate_seal.verify_signatures` is what decides
    whether any of it holds.
    """

    #: The four numbers of ``/ByteRange``: offset and length of the bytes
    #: before the signature, then offset and length of the bytes after it.
    #: Everything outside them - the signature's own hex string - is what the
    #: signature cannot cover.
    byte_range: tuple[int, int, int, int]
    #: The signature itself: the DER of a CMS ``SignedData``, from ``/Contents``.
    contents: bytes
    #: ``/SubFilter``: how the signature is packaged, e.g.
    #: ``adbe.pkcs7.detached`` or ``ETSI.CAdES.detached``.
    sub_filter: str | None
    #: ``/Name``: who the signing software says signed it. Not evidence of
    #: anything - the certificate is.
    name: str | None
    #: ``/M``: when the signing software says it was signed, as written
    #: (``D:20260921120000Z``).
    signed_at: str | None
    reason: str | None
    location: str | None
    #: Where the dictionary starts in the file, for reporting.
    offset: int
