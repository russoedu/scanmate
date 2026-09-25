"""The verifier, held to the TypeScript's own verdict on the same bytes."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from .seal_report_contract import SignatureProblem
from .verify_signatures_use_case import verify_signatures

_ROOT = Path(__file__).parents[4]
_FIXTURES = _ROOT / "tools" / "parity" / "fixtures" / "seal"
_GOLDEN: dict[str, Any] = json.loads(
    (_ROOT / "tools" / "parity" / "goldens" / "seal-verification.json").read_text(
        encoding="utf-8"
    )
)["fixtures"]


def _pdf(name: str) -> bytes:
    return (_FIXTURES / f"{name}.pdf").read_bytes()


def _instant(written: str | None) -> datetime | None:
    return None if written is None else datetime.fromisoformat(written.replace("Z", "+00:00"))


def _kinds(problems: list[SignatureProblem]) -> list[str]:
    return [problem.kind for problem in problems]


@pytest.mark.parametrize("name", sorted(_GOLDEN))
def test_reports_exactly_what_the_typescript_reports(name: str) -> None:
    """The whole report, field by field."""
    expected = _GOLDEN[name]
    report = verify_signatures(_pdf(name))

    assert report.signed == expected["signed"]
    assert report.unbroken == expected["unbroken"]
    assert len(report.signatures) == len(expected["signatures"])

    for signature, want in zip(report.signatures, expected["signatures"], strict=True):
        assert signature.name == want["name"]
        assert signature.sub_filter == want["subFilter"]
        assert signature.reason == want["reason"]
        assert signature.location == want["location"]
        assert signature.signed_at == _instant(want["signedAt"])
        assert signature.intact == want["intact"]
        assert signature.whole == want["whole"]
        assert signature.uncovered == want["uncovered"]
        assert _kinds(signature.problems) == [p["kind"] for p in want["problems"]]

        if want["signer"] is None:
            assert signature.signer is None
        else:
            assert signature.signer is not None
            assert signature.signer.subject == want["signer"]["subject"]
            assert signature.signer.issuer == want["signer"]["issuer"]
            assert signature.signer.serial_number == want["signer"]["serialNumber"]
            assert signature.signer.not_before == _instant(want["signer"]["notBefore"])
            assert signature.signer.not_after == _instant(want["signer"]["notAfter"])
            assert signature.signer.self_signed == want["signer"]["selfSigned"]


class TestTheVerdicts:
    """What each fixture is for, so a failure names a behaviour."""

    def test_an_intact_signature_over_the_whole_file_has_no_problems(self) -> None:
        report = verify_signatures(_pdf("plain"))

        assert report.unbroken is True
        assert report.signatures[0].intact is True
        assert report.signatures[0].problems == []

    def test_a_byte_changed_after_signing_is_caught(self) -> None:
        report = verify_signatures(_pdf("tampered"))

        assert report.unbroken is False
        assert _kinds(report.signatures[0].problems) == ["digest-mismatch"]

    def test_bytes_appended_are_reported_and_what_is_signed_still_holds(self) -> None:
        # The distinction the package exists to draw: "this much of the file is
        # vouched for, and there is more" is not the same as "this file was
        # tampered with", and a reader has to be able to tell them apart.
        signature = verify_signatures(_pdf("appended")).signatures[0]

        assert signature.intact is True
        assert signature.whole is False
        assert signature.uncovered == 29
        assert _kinds(signature.problems) == ["not-covered"]
        assert signature.problems[0].bytes_uncovered == 29

    def test_a_certificate_out_of_date_is_a_separate_finding_from_the_signature(self) -> None:
        signature = verify_signatures(_pdf("expired")).signatures[0]

        assert signature.intact is True
        assert _kinds(signature.problems) == ["certificate-expired"]
        assert signature.problems[0].signed_at == datetime(2026, 9, 22, 12, 0, tzinfo=UTC)

    def test_an_expired_certificate_does_not_make_a_file_broken(self) -> None:
        # `unbroken` is about the bytes, not about trust. A file whose
        # signature holds is unbroken even when the certificate had expired.
        assert verify_signatures(_pdf("expired")).unbroken is True

    def test_the_signer_is_the_person_not_the_authority(self) -> None:
        # A signature carries its whole chain, authority first as often as not.
        # Picking the first certificate names Entrust where a person signed.
        signer = verify_signatures(_pdf("chain")).signatures[0].signer

        assert signer is not None
        assert signer.subject == "CN=A Signing Person"
        assert signer.issuer == "CN=Test Authority"
        assert signer.self_signed is False

    def test_a_file_with_no_signature_says_so_plainly(self) -> None:
        report = verify_signatures(_pdf("unsigned"))

        assert report.signed is False
        assert report.signatures == []
        assert report.unbroken is False

    def test_a_file_too_broken_for_a_parser_is_still_verified(self) -> None:
        report = verify_signatures(_pdf("wrecked"))

        assert report.signed is True
        assert _kinds(report.signatures[0].problems) == ["digest-mismatch"]


class TestTheDepartureFromTheTypeScript:
    """One behaviour reproduced rather than improved, and one not held to."""

    def test_a_digest_mismatch_discards_the_signer(self) -> None:
        """pkijs throws, so the TypeScript's catch returns ``signer: null``.

        The certificate was perfectly readable - the TypeScript read it moments
        earlier to check its validity window - and it is dropped anyway. That
        is a wart, and it is reproduced deliberately: parity means the two
        ports answer alike, and a Python version that helpfully kept the signer
        would disagree with the TypeScript on every tampered file there is.
        """
        signature = verify_signatures(_pdf("tampered")).signatures[0]

        assert signature.signer is None
        assert _kinds(signature.problems) == ["digest-mismatch"]

    def test_an_unreadable_signature_carries_a_reason_that_is_not_held_to_parity(self) -> None:
        """The one value in this package with no golden.

        ``because`` is whichever library phrased the failure, and no two
        libraries phrase a malformed CMS structure alike. The *kind* is the
        contract; the wording is a human-readable aside. Asserted as "present
        and non-empty" rather than left untested, so a port that silently
        stopped explaining itself would still fail.
        """
        pdf = b"<< /Type /Sig /ByteRange [0 4 6 4] /Contents <deadbeef> >>\n%%EOF\n"
        signature = verify_signatures(pdf).signatures[0]
        unreadable = [p for p in signature.problems if p.kind == "unreadable"]

        # Membership rather than the whole list: this hand-built dictionary
        # also has bytes past its own /ByteRange, so `not-covered` fires too.
        # That is correct, and not what this test is about.
        assert len(unreadable) == 1
        assert unreadable[0].because
        assert signature.signer is None
        assert signature.intact is False
