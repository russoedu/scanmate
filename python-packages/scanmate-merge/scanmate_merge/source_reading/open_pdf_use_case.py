"""Opening a PDF for writing, decrypting it if it is encrypted."""

from __future__ import annotations

import io

from pypdf import PdfReader
from pypdf.errors import FileNotDecryptedError, PdfReadError


class PdfPasswordError(Exception):
    """A PDF that needs a password to open, which was not given or did not work."""

    def __init__(self, given: bool) -> None:
        """
        :param given: Whether a password was given at all - wrong, or missing.
        """
        super().__init__(
            "this PDF is encrypted, and the password given does not open it"
            if given
            else "this PDF is encrypted with a password it needs to be opened - pass `password`"
        )
        #: Whether a password was given at all.
        self.given = given


def open_pdf(data: bytes, password: str | None = None) -> PdfReader:
    """Open a PDF, decrypting it if it is encrypted.

    Signed documents usually arrive encrypted: an owner password restricting
    what may be done with them, and no password needed to read them. Such a
    document opens with the *empty* password, so decrypting costs a caller
    nothing in the common case, and only a PDF that needs a password to be read
    at all needs one given.

    :param data: The file's bytes.
    :param password: The password that opens the document, when it needs one.
    :returns: The opened document.
    :raises PdfPasswordError: It is encrypted and no given password opens it.
    """
    reader = PdfReader(io.BytesIO(data))
    if not reader.is_encrypted:
        return reader

    # The password given first, then none. A caller's password is for the
    # document that needs one; tried alone it would lock out the
    # owner-password-only PDF that needed nothing - which is what happened when
    # one password was applied to every source of a merge. The empty password
    # opens only what anyone may read anyway.
    attempts = [""] if password is None or password == "" else [password, ""]
    for attempt in attempts:
        try:
            if reader.decrypt(attempt):
                return reader
        except (FileNotDecryptedError, PdfReadError, NotImplementedError):
            continue

    raise PdfPasswordError(password is not None)
