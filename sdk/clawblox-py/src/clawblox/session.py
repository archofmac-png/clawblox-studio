"""ClawBlox session implementation."""

from typing import Any, Callable

from .client import ClawBloxClient
from .types import (
    ExecuteResult,
    ObserveState,
    SessionCreateResponse,
    SessionExecuteResponse,
    SessionStateResponse,
)


class ClawBloxSession:
    """Wrapper for an isolated session context."""

    def __init__(
        self,
        client: ClawBloxClient,
        session_id: str,
        label: str | None = None,
    ):
        """Initialize session.

        Args:
            client: Parent client
            session_id: Session ID
            label: Optional label
        """
        self.client = client
        self.session_id = session_id
        self.label = label
        self._event_handlers: dict[str, list[Callable]] = {}

    @classmethod
    def create(
        cls,
        client: ClawBloxClient,
        label: str | None = None,
        deterministic: bool = False,
        seed: int | None = None,
    ) -> "ClawBloxSession":
        """Create a new session.

        Args:
            client: Parent client
            label: Optional session label
            deterministic: Run in deterministic mode
            seed: Random seed

        Returns:
            New ClawBloxSession instance
        """
        info = client.session_create(
            label=label,
            deterministic=deterministic,
            seed=seed,
        )
        return cls(client, info.session_id, label)

    def execute(self, code: str) -> ExecuteResult:
        """Execute Lua code in this session.

        Args:
            code: Lua code to execute

        Returns:
            ExecuteResult
        """
        return self.client.session_execute(self.session_id, code)

    def observe(self) -> ObserveState:
        """Get session state.

        Returns:
            ObserveState
        """
        data = self.client.session_state(self.session_id)
        return ObserveState(
            metadata=data.metadata,
            instances=data.instances,
            physics=data.physics,
            dataStore=data.dataStore,
            players=data.players,
        )

    def reset(self) -> dict:
        """Reset the session.

        Returns:
            Reset response
        """
        return self.client.session_reset(self.session_id)

    def destroy(self) -> dict:
        """Destroy the session.

        Returns:
            Destroy response
        """
        return self.client.session_destroy(self.session_id)

    def send_message(self, to_session: str, event: str, data: dict | None = None) -> dict:
        """Send message to another session.

        Args:
            to_session: Destination session ID
            event: Event name
            data: Event data

        Returns:
            Bridge message response
        """
        return self.client.messaging_bridge(
            from_session=self.session_id,
            to_session=to_session,
            event=event,
            data=data,
        )

    def messages(self) -> list[dict]:
        """Get messages for this session.

        Returns:
            List of messages
        """
        return self.client.session_messages(self.session_id)

    def physics_step(self, dt: float = 0.033) -> dict:
        """Step the physics simulation forward.

        Args:
            dt: Time delta in seconds (default 0.033 = ~30fps)

        Returns:
            dict with ok, dt
        """
        return self.client.physics_step(self.session_id, dt)

    def on(self, event_type: str, handler: Callable) -> None:
        """Subscribe to WebSocket events for this session.

        Args:
            event_type: Event type to subscribe to
            handler: Callback function
        """
        if event_type not in self._event_handlers:
            self._event_handlers[event_type] = []
        self._event_handlers[event_type].append(handler)

    def off(self, event_type: str, handler: Callable) -> None:
        """Unsubscribe from WebSocket events.

        Args:
            event_type: Event type
            handler: Handler to remove
        """
        if event_type in self._event_handlers:
            self._event_handlers[event_type].remove(handler)

    def _handle_event(self, event: dict) -> None:
        """Handle incoming WebSocket event.

        Args:
            event: Event dictionary
        """
        event_type = event.get("type", "")
        if event_type in self._event_handlers:
            for handler in self._event_handlers[event_type]:
                handler(event)

    def __repr__(self) -> str:
        return f"ClawBloxSession(id={self.session_id!r}, label={self.label!r})"
