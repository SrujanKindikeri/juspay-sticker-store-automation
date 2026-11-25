from datetime import datetime, timedelta
from typing import Optional
from app.core.config import settings

_test_clock_offset_seconds: float = 0.0


def get_current_time(clock_offset_seconds: Optional[float] = None) -> datetime:
    """
    Returns the current UTC datetime, allowing controllable clock offsets
    strictly during development and testing environments.
    
    Security:
    Clock offsets are strictly IGNORED when running in production (settings.is_production).
    """
    if settings.is_development:
        offset = clock_offset_seconds if clock_offset_seconds is not None else _test_clock_offset_seconds
        if offset:
            return datetime.utcnow() + timedelta(seconds=offset)
    return datetime.utcnow()


def set_test_clock_offset(seconds: float) -> None:
    """
    Sets global test clock offset for deterministic automated testing.
    Ignored if running in production.
    """
    global _test_clock_offset_seconds
    if settings.is_development:
        _test_clock_offset_seconds = seconds


def reset_test_clock_offset() -> None:
    """Resets global test clock offset to 0.0."""
    global _test_clock_offset_seconds
    _test_clock_offset_seconds = 0.0
