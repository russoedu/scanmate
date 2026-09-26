"""What a source is, and what it means for one to be unusable."""

from __future__ import annotations

from typing import Literal, TypeAlias

#: What a source turned out to be.
SourceKind: TypeAlias = Literal["pdf", "image", "raster"]


class MergeSourceError(Exception):
    """A source that could not be used, and which one it was."""

    def __init__(self, index: int, message: str) -> None:
        """Name the source by its position, as a caller counts them.

        :param index: Zero-based position of the source in the list given.
        :param message: What is wrong with it.
        """
        super().__init__(f"source {index + 1}: {message}")
        #: Zero-based position of the source in the list given.
        self.index = index
