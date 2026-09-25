"""Reading what a PDF claims about its signatures, from the file's own bytes."""

from .find_signature_fields_algorithm import find_signature_fields
from .signature_field_contract import SignatureField

__all__ = ["SignatureField", "find_signature_fields"]
