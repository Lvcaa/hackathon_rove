import time
import uuid
from typing import Optional

_store: dict[str, tuple[dict, float]] = {}
TTL = 300  # 5 minutes


def store_option(data: dict) -> str:
    option_id = uuid.uuid4().hex[:10]
    _store[option_id] = (data, time.monotonic() + TTL)
    return option_id


def retrieve_option(option_id: str) -> Optional[dict]:
    entry = _store.get(option_id)
    if not entry:
        return None
    data, expires_at = entry
    if time.monotonic() > expires_at:
        del _store[option_id]
        return None
    return data
