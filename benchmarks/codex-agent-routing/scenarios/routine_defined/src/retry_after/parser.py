from datetime import datetime

MAX_RETRY_AFTER_SECONDS = 86_400


def parse_retry_after(value: str | None, now: datetime) -> int | None:
    """Return the bounded delay represented by a Retry-After field value."""
    raise NotImplementedError

