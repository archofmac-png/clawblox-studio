#!/usr/bin/env python3
"""Test script to verify SDK works with the API."""

import sys

from clawblox import (
    ClawBloxClient,
    ClawBloxSession,
    ClawBloxAgent,
)


def test_health():
    """Test health endpoint."""
    client = ClawBloxClient()
    health = client.health()
    print(f"✓ Health check: {health.status}")
    client.close()
    return True


def test_game_start_stop():
    """Test game start/stop."""
    client = ClawBloxClient()
    result = client.game_start(deterministic=True, seed=42)
    print(f"✓ Game start: success={result.success}, seed={result.seed}")

    result = client.game_stop()
    print(f"✓ Game stop: success={result.success}")
    client.close()
    return True


def test_game_execute():
    """Test game execute."""
    client = ClawBloxClient()
    result = client.game_execute('print("Hello from Python SDK!")')
    print(f"✓ Game execute: success={result.success}, output={result.output}")
    client.close()
    return True


def test_session_create_list_destroy():
    """Test session create/list/destroy."""
    client = ClawBloxClient()
    
    # Create session
    info = client.session_create(label="test-session", deterministic=True, seed=123)
    print(f"✓ Session create: id={info.session_id}, label={info.label}")

    # List sessions
    sessions = client.session_list()
    print(f"  Session list: {len(sessions)} session(s)")
    
    # Destroy session
    result = client.session_destroy(info.session_id)
    print(f"✓ Session destroy: {result}")
    
    client.close()
    return True


def test_session_execute():
    """Test session execute."""
    client = ClawBloxClient()
    
    # Create a fresh session
    session = ClawBloxSession.create(client, label="execute-test", deterministic=True)
    print(f"✓ Created session: {session.session_id}")

    # Execute
    result = session.execute('print("Hello from session!")')
    print(f"✓ Session execute: success={result.success}, output={result.output}")

    # Destroy session
    session.destroy()
    print(f"✓ Destroyed session")
    
    client.close()
    return True


def test_observe_state():
    """Test observe state."""
    client = ClawBloxClient()
    state = client.observe_state()
    print(f"✓ Observe state: {state.metadata.tick} tick, {len(state.instances)} instances")
    client.close()
    return True


def main():
    """Run all tests."""
    print("Testing clawblox-py SDK...\n")

    tests = [
        ("Health", test_health),
        ("Game Start/Stop", test_game_start_stop),
        ("Game Execute", test_game_execute),
        ("Session Create/List/Destroy", test_session_create_list_destroy),
        ("Session Execute", test_session_execute),
        ("Observe State", test_observe_state),
    ]

    passed = 0
    failed = 0

    for name, test_fn in tests:
        try:
            if test_fn():
                passed += 1
            else:
                failed += 1
                print(f"✗ {name} FAILED")
        except Exception as e:
            failed += 1
            print(f"✗ {name} FAILED: {e}")
            import traceback
            traceback.print_exc()
        print()

    print("=" * 40)
    print(f"Results: {passed} passed, {failed} failed")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
