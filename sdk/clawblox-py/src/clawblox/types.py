"""ClawBlox type definitions."""

from dataclasses import dataclass, field
from typing import Any


# Basic types
@dataclass
class Vector3:
    """3D vector."""
    X: float
    Y: float
    Z: float

    @classmethod
    def from_dict(cls, data: dict) -> "Vector3":
        return cls(X=data.get("X", 0), Y=data.get("Y", 0), Z=data.get("Z", 0))


# Health
@dataclass
class HealthResponse:
    """Health check response."""
    status: str
    timestamp: str


# Game responses
@dataclass
class GameStartResponse:
    """Game start response."""
    success: bool
    status: str
    message: str | None = None
    seed: int | None = None
    deterministic: bool | None = None


@dataclass
class GameStopResponse:
    """Game stop response."""
    success: bool
    status: str
    message: str


@dataclass
class ExecuteResult:
    """Execute Lua code result."""
    success: bool
    output: str | None = None
    error: str | None = None
    execution_time_ms: float | None = None


@dataclass
class GameState:
    """Game state."""
    status: str
    tick: int | None = None


# Instance types
@dataclass
class InstanceInfo:
    """Instance information."""
    id: str
    Name: str
    ClassName: str
    Path: str | None = None
    ChildCount: int | None = None
    Properties: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "InstanceInfo":
        return cls(
            id=data.get("id", ""),
            Name=data.get("Name", ""),
            ClassName=data.get("ClassName", ""),
            Path=data.get("Path"),
            ChildCount=data.get("ChildCount"),
            Properties=data.get("Properties"),
        )


@dataclass
class InstancesResponse:
    """List of instances."""
    instances: list[InstanceInfo] = field(default_factory=list)


@dataclass
class QueryResponse:
    """Query response."""
    found: bool
    path: str | None = None
    Name: str | None = None
    ClassName: str | None = None


# Test types
@dataclass
class TestResponse:
    """Test response."""
    passed: bool
    description: str | None = None
    error: str | None = None


@dataclass
class TestRunResponse:
    """Test run response."""
    tests: list[dict] | None = None
    passed: int | None = None
    failed: int | None = None
    error: str | None = None


# Load/Deploy types
@dataclass
class LoadResponse:
    """Load project response."""
    success: bool
    projectPath: str | None = None
    scriptsLoaded: int | None = None
    scripts: list[dict] | None = None
    errors: list[str] | None = None


@dataclass
class DeployResponse:
    """Deploy response."""
    success: bool
    deployId: str | None = None
    rbxlxPath: str | None = None
    pushedToRoblox: bool | None = None
    scriptsDeployed: int | None = None
    errors: list[str] | None = None


# Observability types
@dataclass
class ObserveMetadata:
    """Observe metadata."""
    timestamp: int
    tick: int
    seed: int | None = None
    deterministic: bool | None = None


@dataclass
class PlayerInfo:
    """Player information."""
    name: str
    userId: int | None = None
    health: float | None = None
    position: Vector3 | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "PlayerInfo":
        return cls(
            name=data.get("name", ""),
            userId=data.get("userId"),
            health=data.get("health"),
            position=Vector3.from_dict(data["position"]) if data.get("position") else None,
        )


@dataclass
class ObserveState:
    """Full observation state."""
    metadata: ObserveMetadata
    instances: list[InstanceInfo]
    physics: list[Any]
    dataStore: dict[str, dict[str, Any]]
    players: list[PlayerInfo]

    @classmethod
    def from_dict(cls, data: dict) -> "ObserveState":
        metadata = data.get("metadata", {})
        return cls(
            metadata=ObserveMetadata(
                timestamp=metadata.get("timestamp", 0),
                tick=metadata.get("tick", 0),
                seed=metadata.get("seed"),
                deterministic=metadata.get("deterministic"),
            ),
            instances=[InstanceInfo.from_dict(i) for i in data.get("instances", [])],
            physics=data.get("physics", []),
            dataStore=data.get("dataStore", {}),
            players=[PlayerInfo.from_dict(p) for p in data.get("players", [])],
        )


@dataclass
class ScreenshotResponse:
    """Screenshot response."""
    format: str
    data: str | Any


@dataclass
class GuiJsonResponse:
    """GUI JSON response."""
    count: int
    gui: list[InstanceInfo]


# Simulation types
@dataclass
class TrajectoryFrame:
    """Trajectory frame."""
    tick: int
    timestamp: int
    seed: int | None = None
    actions: list[str] | None = None
    physicsState: Any = None
    instanceChanges: Any = None
    consoleOutput: str | None = None


@dataclass
class ReplayRequest:
    """Replay request."""
    frames: list[TrajectoryFrame]


@dataclass
class ReplayResult:
    """Replay result."""
    replayed: int
    seed: int | None = None
    finalState: ObserveState | None = None


# Session types
@dataclass
class SessionInfo:
    """Session information."""
    session_id: str
    createdAt: str
    label: str | None = None
    running: bool | None = None
    instanceCount: int | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "SessionInfo":
        return cls(
            session_id=data.get("session_id", ""),
            createdAt=data.get("createdAt", ""),
            label=data.get("label"),
            running=data.get("running"),
            instanceCount=data.get("instanceCount"),
        )


@dataclass
class SessionSummary:
    """Session summary for list."""
    session_id: str
    createdAt: str
    label: str | None = None
    running: bool | None = None
    instanceCount: int | None = None


@dataclass
class SessionCreateResponse:
    """Session create response."""
    session_id: str
    seed: int
    createdAt: str
    label: str | None = None


@dataclass
class SessionStateResponse:
    """Session state response."""
    session_id: str
    running: bool = False
    seed: int = 0
    deterministic: bool = False
    label: str | None = None
    metadata: ObserveMetadata | None = None
    instances: list[InstanceInfo] | None = None
    physics: list[Any] | None = None
    dataStore: dict[str, dict[str, Any]] | None = None
    players: list[PlayerInfo] | None = None


@dataclass
class SessionExecuteResponse:
    """Session execute response."""
    session_id: str
    success: bool
    output: str | None = None
    error: str | None = None
    execution_time_ms: float | None = None


@dataclass
class SessionResetResponse:
    """Session reset response."""
    session_id: str
    reset: bool
    seed: int


# Message types
@dataclass
class Message:
    """Session message."""
    from_session: str
    event: str
    data: Any
    timestamp: int


@dataclass
class BridgeMessageRequest:
    """Bridge message request."""
    from_session: str
    to_session: str
    event: str
    data: Any | None = None


@dataclass
class BridgeMessageResponse:
    """Bridge message response."""
    delivered: bool
    timestamp: int


# Workspace types
@dataclass
class CreatePartRequest:
    """Create part request."""
    name: str
    position: Vector3 | None = None
    size: Vector3 | None = None


@dataclass
class CreatePartResponse:
    """Create part response."""
    success: bool
    part: dict | None = None


# Physics types
@dataclass
class SphereCastRequest:
    """Spherecast request."""
    origin: Vector3
    direction: Vector3
    radius: float
    distance: float


@dataclass
class SphereCastHit:
    """Spherecast hit."""
    name: str
    className: str
    position: Vector3


@dataclass
class SphereCastResponse:
    """Spherecast response."""
    hits: list[SphereCastHit]


@dataclass
class PhysicsStepResponse:
    """Physics step response."""
    ok: bool
    dt: float
