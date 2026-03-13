"""ClawBlox client implementation."""

import json
from contextlib import contextmanager
from typing import Any, Iterator

import httpx
import websockets

from .exceptions import (
    ClawBloxAPIError,
    ClawBloxConnectionError,
    ClawBloxTimeout,
    ClawBloxWebSocketError,
)
from .types import (
    BatchTestEntry,
    BatchTestResult,
    BridgeMessageResponse,
    ExecuteResult,
    GameStartResponse,
    GameStopResponse,
    GuiJsonResponse,
    HealthResponse,
    InstanceInfo,
    InstancesResponse,
    ObserveState,
    ReplayResult,
    ScreenshotResponse,
    SessionCreateResponse,
    SessionExecuteResponse,
    SessionInfo,
    SessionResetResponse,
    SessionStateResponse,
    SessionSummary,
    SphereCastResponse,
    TestCoverageResponse,
    TestRunBatchResponse,
    TestRunResponse,
    TestRunV2Response,
    TrajectoryFrame,
    Vector3,
)


class ClawBloxClient:
    """Client for ClawBlox Studio API."""

    def __init__(
        self,
        base_url: str = "http://localhost:3001",
        timeout: int = 30,
        ws_port: int = 3002,
    ):
        """Initialize the client.

        Args:
            base_url: Base URL for the REST API
            timeout: Request timeout in seconds
            ws_port: Port for WebSocket connections
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.ws_port = ws_port
        self._client = httpx.Client(timeout=timeout)

    def close(self):
        """Close the HTTP client."""
        self._client.close()

    def _request(
        self,
        method: str,
        path: str,
        json: dict | None = None,
        params: dict | None = None,
    ) -> dict:
        """Make an HTTP request."""
        url = f"{self.base_url}{path}"
        try:
            response = self._client.request(
                method=method,
                url=url,
                json=json,
                params=params,
            )
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException as e:
            raise ClawBloxTimeout(f"Request to {url} timed out") from e
        except httpx.HTTPStatusError as e:
            raise ClawBloxAPIError(
                f"HTTP {e.response.status_code}: {e.response.text}",
                status_code=e.response.status_code,
                response=e.response.json() if e.response.content else None,
            ) from e
        except httpx.RequestError as e:
            raise ClawBloxConnectionError(f"Failed to connect to {url}") from e

    def _get(self, path: str, params: dict | None = None) -> dict:
        """GET request."""
        return self._request("GET", path, params=params)

    def _post(self, path: str, json: dict | None = None) -> dict:
        """POST request."""
        return self._request("POST", path, json=json)

    # Health
    def health(self) -> HealthResponse:
        """Health check."""
        data = self._get("/api/health")
        return HealthResponse(status=data.get("status", ""), timestamp=data.get("timestamp", ""))

    # Game endpoints
    def game_start(self, deterministic: bool = False, seed: int | None = None) -> GameStartResponse:
        """Start the game.

        Args:
            deterministic: Run in deterministic mode
            seed: Random seed

        Returns:
            GameStartResponse
        """
        json_data: dict = {}
        if deterministic:
            json_data["deterministic"] = True
        if seed is not None:
            json_data["seed"] = seed
        data = self._post("/api/game/start", json=json_data if json_data else None)
        return GameStartResponse(
            success=data.get("success", False),
            status=data.get("status", ""),
            message=data.get("message"),
            seed=data.get("seed"),
            deterministic=data.get("deterministic"),
        )

    def game_stop(self) -> GameStopResponse:
        """Stop the game."""
        data = self._post("/api/game/stop")
        return GameStopResponse(
            success=data.get("success", False),
            status=data.get("status", ""),
            message=data.get("message", ""),
        )

    def game_execute(
        self,
        code: str,
        deterministic: bool = False,
        seed: int | None = None,
    ) -> ExecuteResult:
        """Execute Lua code.

        Args:
            code: Lua code to execute
            deterministic: Run in deterministic mode
            seed: Random seed

        Returns:
            ExecuteResult
        """
        json_data: dict = {"script": code}
        if deterministic:
            json_data["deterministic"] = True
        if seed is not None:
            json_data["seed"] = seed
        data = self._post("/api/game/execute", json=json_data)
        return ExecuteResult(
            success=data.get("success", False),
            output=data.get("output"),
            error=data.get("error"),
            execution_time_ms=data.get("execution_time_ms"),
        )

    def game_instances(self) -> list[InstanceInfo]:
        """Get all instances."""
        data = self._get("/api/game/instances")
        return [InstanceInfo.from_dict(i) for i in data.get("instances", [])]

    def game_state_snapshot(self) -> dict:
        """Get game state snapshot."""
        return self._get("/api/game/state/snapshot")

    # Session endpoints
    def session_create(
        self,
        label: str | None = None,
        deterministic: bool = False,
        seed: int | None = None,
    ) -> SessionCreateResponse:
        """Create a new session.

        Args:
            label: Optional session label
            deterministic: Run in deterministic mode
            seed: Random seed

        Returns:
            SessionCreateResponse
        """
        json_data: dict = {}
        if label is not None:
            json_data["label"] = label
        if deterministic:
            json_data["deterministic"] = True
        if seed is not None:
            json_data["seed"] = seed
        data = self._post("/api/session/create", json=json_data if json_data else None)
        return SessionCreateResponse(
            session_id=data.get("session_id", ""),
            seed=data.get("seed", 0),
            label=data.get("label"),
            createdAt=data.get("createdAt", ""),
        )

    def session_list(self) -> list[SessionSummary]:
        """List all sessions."""
        data = self._get("/api/session/list")
        # API returns an array directly
        sessions = data if isinstance(data, list) else data.get("sessions", [])
        return [
            SessionSummary(
                session_id=s.get("session_id", ""),
                createdAt=str(s.get("createdAt", "")),
                label=s.get("label"),
                running=s.get("running"),
                instanceCount=s.get("instanceCount"),
            )
            for s in sessions
        ]

    def session_destroy(self, session_id: str) -> dict:
        """Destroy a session."""
        return self._request("DELETE", f"/api/session/{session_id}")

    def session_execute(self, session_id: str, code: str) -> SessionExecuteResponse:
        """Execute code in a session.

        Args:
            session_id: Session ID
            code: Lua code to execute

        Returns:
            SessionExecuteResponse
        """
        data = self._post(f"/api/session/{session_id}/execute", json={"script": code})
        return SessionExecuteResponse(
            session_id=data.get("session_id", session_id),
            success=data.get("success", False),
            output=data.get("output"),
            error=data.get("error"),
            execution_time_ms=data.get("execution_time_ms"),
        )

    def session_state(self, session_id: str) -> SessionStateResponse:
        """Get session state.

        Args:
            session_id: Session ID

        Returns:
            SessionStateResponse
        """
        data = self._get(f"/api/session/{session_id}/state")
        return SessionStateResponse(
            session_id=data.get("session_id", session_id),
            label=data.get("label"),
            running=data.get("running", False),
            seed=data.get("seed", 0),
            deterministic=data.get("deterministic", False),
            metadata=data.get("metadata", {}),
            instances=data.get("instances", []),
            physics=data.get("physics", []),
            dataStore=data.get("dataStore", {}),
            players=data.get("players", []),
        )

    def session_reset(self, session_id: str) -> SessionResetResponse:
        """Reset a session.

        Args:
            session_id: Session ID

        Returns:
            SessionResetResponse
        """
        data = self._post(f"/api/session/{session_id}/reset")
        return SessionResetResponse(
            session_id=data.get("session_id", session_id),
            reset=data.get("reset", False),
            seed=data.get("seed", 0),
        )

    def session_messages(self, session_id: str) -> list[dict]:
        """Get session messages.

        Args:
            session_id: Session ID

        Returns:
            List of messages
        """
        data = self._get(f"/api/session/{session_id}/messages")
        return data.get("messages", [])

    # Observability endpoints
    def observe_state(self) -> ObserveState:
        """Get current state."""
        data = self._get("/api/observe/state")
        return ObserveState.from_dict(data)

    def observe_screenshot(self) -> ScreenshotResponse:
        """Get screenshot."""
        data = self._get("/api/observe/screenshot")
        return ScreenshotResponse(
            format=data.get("format", "png"),
            data=data.get("data"),
        )

    def observe_gui_json(self) -> GuiJsonResponse:
        """Get GUI elements."""
        data = self._get("/api/observe/gui-json")
        return GuiJsonResponse(
            count=data.get("count", 0),
            gui=[InstanceInfo.from_dict(i) for i in data.get("gui", [])],
        )

    # Simulation endpoints
    def simulation_export_trajectory(self) -> list[TrajectoryFrame]:
        """Export trajectory."""
        data = self._get("/api/simulation/export_trajectory")
        frames = data.get("frames", [])
        return [
            TrajectoryFrame(
                tick=f.get("tick", 0),
                timestamp=f.get("timestamp", 0),
                seed=f.get("seed"),
                actions=f.get("actions"),
                physicsState=f.get("physicsState"),
                instanceChanges=f.get("instanceChanges"),
                consoleOutput=f.get("consoleOutput"),
            )
            for f in frames
        ]

    def simulation_replay(self, frames: list[dict]) -> ReplayResult:
        """Replay trajectory.

        Args:
            frames: List of trajectory frames

        Returns:
            ReplayResult
        """
        data = self._post("/api/simulation/replay", json={"frames": frames})
        return ReplayResult(
            replayed=data.get("replayed", 0),
            seed=data.get("seed"),
            finalState=ObserveState.from_dict(data["finalState"]) if data.get("finalState") else None,
        )

    # Messaging endpoints
    def messaging_bridge(
        self,
        from_session: str,
        to_session: str,
        event: str,
        data: dict | None = None,
    ) -> BridgeMessageResponse:
        """Bridge message between sessions.

        Args:
            from_session: Source session ID
            to_session: Destination session ID
            event: Event name
            data: Event data

        Returns:
            BridgeMessageResponse
        """
        json_data = {
            "from_session": from_session,
            "to_session": to_session,
            "event": event,
        }
        if data is not None:
            json_data["data"] = data
        result = self._post("/api/messaging/bridge", json=json_data)
        return BridgeMessageResponse(
            delivered=result.get("delivered", False),
            timestamp=result.get("timestamp", 0),
        )

    # Test endpoints
    def test_run(self, code: str | None = None, file_path: str | None = None) -> TestRunV2Response:
        """Run test (Wave F v2 response).

        Args:
            code: Test code
            file_path: Path to test file

        Returns:
            TestRunV2Response (backward compat + new v2 fields)
        """
        json_data: dict = {}
        if code is not None:
            json_data["code"] = code
        if file_path is not None:
            json_data["filePath"] = file_path
        data = self._post("/api/test/run", json=json_data)
        return TestRunV2Response.from_dict(data)

    def test_run_batch(
        self,
        tests: list[dict | BatchTestEntry],
        deterministic: bool = False,
        seed: int | None = None,
        parallel: bool = False,
    ) -> TestRunBatchResponse:
        """Run multiple tests in a batch (Wave F).

        Args:
            tests: List of {code, label} dicts or BatchTestEntry objects
            deterministic: Run in deterministic mode
            seed: Random seed
            parallel: Run tests in parallel (each in isolated session)

        Returns:
            TestRunBatchResponse
        """
        serialized = []
        for t in tests:
            if isinstance(t, BatchTestEntry):
                serialized.append({"code": t.code, "label": t.label})
            else:
                serialized.append(t)

        json_data: dict = {
            "tests": serialized,
            "deterministic": deterministic,
            "parallel": parallel,
        }
        if seed is not None:
            json_data["seed"] = seed

        data = self._post("/api/test/run_batch", json=json_data)
        return TestRunBatchResponse.from_dict(data)

    def test_coverage(self) -> TestCoverageResponse:
        """Get Lua file coverage report (Wave F).

        Returns:
            TestCoverageResponse with total_files, tested_files, coverage_pct, untested
        """
        data = self._get("/api/test/coverage")
        return TestCoverageResponse.from_dict(data)

    # Physics endpoints
    def spherecast(
        self,
        origin: Vector3,
        direction: Vector3,
        radius: float,
        distance: float,
    ) -> SphereCastResponse:
        """Spherecast.

        Args:
            origin: Origin point
            direction: Direction vector
            radius: Sphere radius
            distance: Max distance

        Returns:
            SphereCastResponse
        """
        data = self._post(
            "/api/physics/spherecast",
            json={
                "origin": {"X": origin.X, "Y": origin.Y, "Z": origin.Z},
                "direction": {"X": direction.X, "Y": direction.Y, "Z": direction.Z},
                "radius": radius,
                "distance": distance,
            },
        )
        return SphereCastResponse(
            hits=[
                SphereCastHit(
                    name=h.get("name", ""),
                    className=h.get("className", ""),
                    position=Vector3.from_dict(h.get("position", {})),
                )
                for h in data.get("hits", [])
            ]
        )

    # WebSocket
    @contextmanager
    def ws_connect(self, session_id: str | None = None) -> Iterator[dict]:
        """Connect to WebSocket.

        Args:
            session_id: Optional session ID to subscribe to

        Yields:
            Event dictionaries

        Raises:
            ClawBloxWebSocketError: If connection fails
        """
        url = f"ws://localhost:{self.ws_port}/ws"
        if session_id:
            url += f"?session_id={session_id}"

        try:
            with websockets.connect(url) as ws:
                # Send subscribe message if session_id provided
                if session_id:
                    import asyncio
                    asyncio.get_event_loop().run_until_complete(
                        ws.send(json.dumps({"action": "subscribe", "session_id": session_id}))
                    )

                # Yield messages
                while True:
                    import asyncio
                    try:
                        message = asyncio.get_event_loop().run_until_complete(ws.recv())
                        yield json.loads(message)
                    except websockets.exceptions.ConnectionClosed:
                        break
        except Exception as e:
            raise ClawBloxWebSocketError(f"WebSocket error: {e}") from e
