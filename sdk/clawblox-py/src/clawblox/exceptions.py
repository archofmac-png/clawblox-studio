"""ClawBlox exceptions."""


class ClawBloxError(Exception):
    """Base exception for all ClawBlox errors."""
    pass


class ClawBloxTimeout(ClawBloxError):
    """Request timed out."""
    pass


class ClawBloxAPIError(ClawBloxError):
    """API returned an error."""

    def __init__(self, message: str, status_code: int | None = None, response: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response or {}


class ClawBloxConnectionError(ClawBloxError):
    """Failed to connect to the API."""
    pass


class ClawBloxWebSocketError(ClawBloxError):
    """WebSocket error."""
    pass
