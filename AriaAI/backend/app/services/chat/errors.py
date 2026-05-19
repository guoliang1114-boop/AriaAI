"""Chat module exceptions."""
from __future__ import annotations


class ChatError(Exception):
    """Base exception for all chat-domain errors."""

    def __init__(self, message: str, *, stage: str = "", details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.details = details or {}


class ChatStreamingError(ChatError):
    """Raised when an SSE streaming phase fails irrecoverably."""
    pass


class ChatContextError(ChatError):
    """Raised when context building fails (DB, file I/O, etc.)."""
    pass


class ChatToolError(ChatError):
    """Raised when a tool execution fails."""
    pass
