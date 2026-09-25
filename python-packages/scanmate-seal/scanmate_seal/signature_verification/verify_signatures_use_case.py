"""Is a signed PDF still the document that was signed?"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from asn1crypto import cms, x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.serialization import load_der_public_key

from ..signature_fields import SignatureField, find_signature_fields
from .pdf_date_mapper import pdf_date
from .seal_report_contract import SealReport, SignatureCheck, SignatureProblem, Signer

#: The short names a reader expects: ``CN=A Person, O=A Company``.
_ATTRIBUTES: dict[str, str] = {
    "2.5.4.3": "CN",
    "2.5.4.6": "C",
    "2.5.4.7": "L",
    "2.5.4.8": "ST",
    "2.5.4.10": "O",
    "2.5.4.11": "OU",
    "1.2.840.113549.1.9.1": "E",
}

#: Digest algorithms by the name asn1crypto reports.
_DIGESTS: dict[str, Any] = {
    "md5": hashes.MD5,
    "sha1": hashes.SHA1,
    "sha224": hashes.SHA224,
    "sha256": hashes.SHA256,
    "sha384": hashes.SHA384,
    "sha512": hashes.SHA512,
}


def verify_signatures(pdf: bytes) -> SealReport:
    """Check every signature a PDF carries.

    A digital signature answers a question no comparison of pixels or words
    can: whether the file has changed since someone signed it. It says nothing
    about whether the paper that came back matches the document that was
    issued - that is the rest of this suite - and this package says nothing
    about whether a signature is *legally* valid, which is a question about
    trust lists, revocation and jurisdiction rather than about bytes.

    What is checked, per signature:

    1. The bytes the signature covers digest to what the signature says they do.
    2. That digest is signed by the key of the certificate it carries.
    3. How much of the file lies outside the signed ranges.
    4. Whether the certificate was in date when the file says it was signed.

    :param pdf: The whole file, as bytes.
    :returns: The report. ``signed`` is false and ``signatures`` empty when the
        file carries no signature dictionary at all.

    .. note::
       ``verifySignatures`` is ``async`` in the TypeScript and this is not. The
       asynchrony there is pkijs's WebCrypto interface, not the algorithm: no
       step of this waits on anything. An ``async def`` here would be a
       coroutine that never yields, so the departure is in the calling
       convention only.
    """
    fields = find_signature_fields(pdf)
    if len(fields) == 0:
        return SealReport(signed=False, signatures=[], unbroken=False)

    signatures = [_check(pdf, field) for field in fields]

    return SealReport(
        signed=True,
        signatures=signatures,
        unbroken=all(signature.intact for signature in signatures)
        and (signatures[-1].whole if len(signatures) > 0 else False),
    )


def _check(pdf: bytes, field: SignatureField) -> SignatureCheck:
    """Everything one signature dictionary claims, checked against the bytes."""
    before_at, before_length, after_at, after_length = field.byte_range
    covered = (
        pdf[before_at : before_at + before_length]
        + pdf[after_at : after_at + after_length]
    )
    # The hole between the ranges is the signature's own hex string, which no
    # signature can cover; anything past the ranges is a later change.
    uncovered = max(0, len(pdf) - (after_at + after_length))

    signed_at = pdf_date(field.signed_at)
    problems: list[SignatureProblem] = []
    if uncovered > 0:
        problems.append(SignatureProblem(kind="not-covered", bytes_uncovered=uncovered))

    def report(intact: bool, signer: Signer | None) -> SignatureCheck:
        return SignatureCheck(
            name=field.name,
            sub_filter=field.sub_filter,
            reason=field.reason,
            location=field.location,
            signed_at=signed_at,
            intact=intact,
            whole=uncovered == 0,
            uncovered=uncovered,
            signer=signer,
            problems=problems,
        )

    try:
        content = cms.ContentInfo.load(field.contents)
        signed_data = content["content"]
        signer_info = signed_data["signer_infos"][0]
        certificate = _signer_certificate(signed_data, signer_info)
        signer = _describe(certificate)

        if (
            signer is not None
            and signed_at is not None
            and (signed_at < signer.not_before or signed_at > signer.not_after)
        ):
            problems.append(
                SignatureProblem(kind="certificate-expired", signed_at=signed_at)
            )

        # Raises `_DigestMismatchError` rather than returning a flag, because pkijs
        # THROWS when the digest disagrees and the TypeScript therefore handles
        # it in its catch - which returns `signer: null`, discarding the signer
        # it had already read. Reproduced rather than improved: the two ports
        # have to answer alike, and a Python version that helpfully kept the
        # signer would disagree with the TypeScript on every tampered file.
        if not _signature_valid_for(signed_data, signer_info, certificate, covered):
            problems.append(SignatureProblem(kind="signature-invalid"))

            return report(False, signer)

        return report(True, signer)
    except _DigestMismatchError:
        problems.append(SignatureProblem(kind="digest-mismatch"))

        return report(False, None)
    except Exception as error:  # noqa: BLE001 - any malformed CMS lands here
        problems.append(SignatureProblem(kind="unreadable", because=str(error)))

        return report(False, None)


class _DigestMismatchError(Exception):
    """The content does not digest to what the signed attributes claim.

    An exception rather than a return value, so that the caller handles it
    exactly where the TypeScript handles pkijs throwing the same thing - see
    the note at the call site for why that distinction is load-bearing.
    """


def _signature_valid_for(
    signed_data: Any,
    signer_info: Any,
    certificate: x509.Certificate | None,
    covered: bytes,
) -> bool:
    """Whether the signature holds for the bytes it covers.

    :param signed_data: The CMS ``SignedData``.
    :param signer_info: The ``SignerInfo`` that signed.
    :param certificate: The certificate that signed, when one was found.
    :param covered: The bytes the signature is over.
    :returns: Whether the signature itself verifies.
    :raises _DigestMismatchError: The signed attributes claim a digest the content
        does not produce.
    """
    algorithm = _DIGESTS.get(signer_info["digest_algorithm"]["algorithm"].native)
    if algorithm is None or certificate is None:
        return False

    digester = hashes.Hash(algorithm())
    digester.update(covered)
    digest = digester.finalize()

    signed_attrs = signer_info["signed_attrs"]
    if signed_attrs.native is None:
        # No signed attributes: the signature is over the content itself, and
        # there is no separate digest to disagree with.
        return _signature_valid(certificate, signer_info, covered, algorithm)

    claimed = next(
        (
            attribute["values"][0].native
            for attribute in signed_attrs
            if attribute["type"].native == "message_digest"
        ),
        None,
    )
    if claimed != digest:
        raise _DigestMismatchError

    # `.untag()` re-tags the attributes from the implicit [0] they carry inside
    # SignerInfo back to the universal SET OF they are signed as. Signing the
    # tagged form instead is the classic CMS mistake, and it fails every real
    # signature while passing a test that makes both sides the same way.
    return _signature_valid(
        certificate, signer_info, signed_attrs.untag().dump(), algorithm
    )


def _signature_valid(
    certificate: x509.Certificate,
    signer_info: Any,
    data: bytes,
    algorithm: Any,
) -> bool:
    """Whether the signature over ``data`` holds for the certificate's key."""
    key = load_der_public_key(certificate.public_key.dump())
    signature = signer_info["signature"].native
    try:
        if isinstance(key, rsa.RSAPublicKey):
            key.verify(signature, data, padding.PKCS1v15(), algorithm())
        elif isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(signature, data, ec.ECDSA(algorithm()))
        else:
            return False
    except InvalidSignature:
        return False

    return True


def _signer_certificate(signed_data: Any, signer_info: Any) -> x509.Certificate | None:
    """The certificate that signed, out of the several a signature carries.

    A real signature carries its whole chain - the signer, whoever issued to
    them, and on up - and the first of them is as often a certification
    authority as the signer. ``SignerInfo`` names the one that signed, by its
    issuer and serial number, and that is the only way to pick it. Measured on
    a real signed document: taking the first reported ``O=Entrust.net`` where
    the signer was a person.
    """
    held = [
        candidate.chosen
        for candidate in (signed_data["certificates"] or [])
        if candidate.name == "certificate"
    ]
    if len(held) == 0:
        return None

    sid = signer_info["sid"]
    if sid.name != "issuer_and_serial_number":
        return held[0]
    wanted = _serial(sid.chosen["serial_number"])

    return next(
        (
            candidate
            for candidate in held
            if _serial(candidate["tbs_certificate"]["serial_number"]) == wanted
        ),
        held[0],
    )


def _serial(number: Any) -> str:
    """A serial number as the raw bytes of its DER integer, in lowercase hex."""
    # `str(...)` because asn1crypto is untyped, so `.contents` is Any and
    # `.hex()` on it is Any too - which strict mypy will not return as str.
    return str(number.contents.hex())


def _describe(certificate: x509.Certificate | None) -> Signer | None:
    """What a certificate says about itself."""
    if certificate is None:
        return None
    subject = _distinguished(certificate.subject)
    issuer = _distinguished(certificate.issuer)
    validity = certificate["tbs_certificate"]["validity"]

    return Signer(
        subject=subject,
        issuer=issuer,
        serial_number=_serial(certificate["tbs_certificate"]["serial_number"]),
        not_before=_instant(validity["not_before"].native),
        not_after=_instant(validity["not_after"].native),
        self_signed=subject == issuer,
    )


def _instant(when: datetime) -> datetime:
    """A certificate's time, which asn1crypto already hands back in UTC."""
    return when


def _distinguished(name: x509.Name) -> str:
    """The short names a reader expects: ``CN=A Person, O=A Company``."""
    parts: list[str] = []
    # `chosen` is the RDNSequence; each RDN is a SET, which in practice holds
    # one attribute. Flattened in the order the certificate holds them, because
    # that order is what the TypeScript joins and a sorted reading would
    # rename nobody but would reorder everybody.
    for relative in name.chosen:
        for attribute in relative:
            oid = attribute["type"].dotted
            parts.append(f"{_ATTRIBUTES.get(oid, oid)}={attribute['value'].native}")

    return ", ".join(parts)
