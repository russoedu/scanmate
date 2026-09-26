"""What a session remembers, and when it forgets.

``StageCache`` is internal here exactly as it is in the TypeScript: the package
exports only :func:`fingerprint`, and the cache itself is used by the session
that owns it.
"""

from .option_fingerprint_mapper import fingerprint
from .stage_cache_store import DOWNSTREAM, CachedStage, StageCache

__all__ = ["DOWNSTREAM", "CachedStage", "StageCache", "fingerprint"]
