"""ClawBlox Studio Python SDK.

A Python SDK for interacting with ClawBlox Studio - a Roblox game engine API.
"""

from .agent import AgentStepResult, ClawBloxAgent
from .client import ClawBloxClient
from .exceptions import (
    ClawBloxAPIError,
    ClawBloxConnectionError,
    ClawBloxError,
    ClawBloxTimeout,
    ClawBloxWebSocketError,
)
from .session import ClawBloxSession
from .types import (
    BridgeMessageResponse,
    ExecuteResult,
    GameStartResponse,
    GameStopResponse,
    GuiJsonResponse,
    HealthResponse,
    InstanceInfo,
    InstancesResponse,
    ObserveMetadata,
    ObserveState,
    PlayerInfo,
    ReplayResult,
    SessionCreateResponse,
    SessionExecuteResponse,
    SessionInfo,
    SessionResetResponse,
    SessionStateResponse,
    SessionSummary,
    ScreenshotResponse,
    SphereCastResponse,
    TestRunResponse,
    TrajectoryFrame,
    Vector3,
)

__version__ = "1.1.0"

__all__ = [
    # Client
    "ClawBloxClient",
    # Session
    "ClawBloxSession",
    # Agent
    "ClawBloxAgent",
    "AgentStepResult",
    # Exceptions
    "ClawBloxError",
    "ClawBloxTimeout",
    "ClawBloxAPIError",
    "ClawBloxConnectionError",
    "ClawBloxWebSocketError",
    # Types
    "Vector3",
    "HealthResponse",
    "GameStartResponse",
    "GameStopResponse",
    "ExecuteResult",
    "InstanceInfo",
    "InstancesResponse",
    "ObserveState",
    "ObserveMetadata",
    "PlayerInfo",
    "ScreenshotResponse",
    "GuiJsonResponse",
    "TrajectoryFrame",
    "ReplayResult",
    "SessionInfo",
    "SessionSummary",
    "SessionCreateResponse",
    "SessionStateResponse",
    "SessionExecuteResponse",
    "SessionResetResponse",
    "BridgeMessageResponse",
    "TestRunResponse",
    "SphereCastResponse",
]
