"""Settings helper — typed database setting accessors."""
from __future__ import annotations

from typing import Optional
from sqlmodel import Session

from app.models.db import Setting as _Setting


def get_setting_value(session: Session, key: str, default: str = "") -> str:
    """Get a string setting value from database."""
    setting = session.get(_Setting, key)
    return setting.value if setting and setting.value else default


def get_float_setting(session: Session, key: str, default: float = 0.0) -> float:
    """Get a float setting value from database."""
    value = get_setting_value(session, key)
    if value:
        try:
            return float(value)
        except ValueError:
            pass
    return default


def get_int_setting(session: Session, key: str, default: int = 0) -> int:
    """Get an int setting value from database."""
    value = get_setting_value(session, key)
    if value:
        try:
            return int(value)
        except ValueError:
            pass
    return default


def get_bool_setting(session: Session, key: str, default: bool = False) -> bool:
    """Get a boolean setting value from database."""
    value = get_setting_value(session, key).lower()
    if value in ("true", "1", "yes", "on"):
        return True
    if value in ("false", "0", "no", "off"):
        return False
    return default


# Common setting keys with typed getters
class LLMSettings:
    """LLM-related settings accessors."""
    
    def __init__(self, session: Session):
        self._session = session
    
    @property
    def max_tokens(self) -> int:
        return get_int_setting(self._session, "max_tokens", 4096)
    
    @property
    def temperature(self) -> float:
        return get_float_setting(self._session, "temperature", 0.7)
    
    @property
    def top_p(self) -> float:
        return get_float_setting(self._session, "top_p", 1.0)
    
    @property
    def presence_penalty(self) -> float:
        return get_float_setting(self._session, "presence_penalty", 0.0)
    
    @property
    def frequency_penalty(self) -> float:
        return get_float_setting(self._session, "frequency_penalty", 0.0)
