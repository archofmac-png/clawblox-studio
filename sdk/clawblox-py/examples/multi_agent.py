#!/usr/bin/env python3
"""Multi-agent example - Two agents exchanging messages."""

import time

from clawblox import ClawBloxClient, ClawBloxSession


def main():
    """Run multi-agent messaging example."""
    # Create client
    client = ClawBloxClient(base_url="http://localhost:3001")

    # Create two agents (sessions)
    print("Creating agent sessions...")
    agent_a = ClawBloxSession.create(client, label="agent-a")
    agent_b = ClawBloxSession.create(client, label="agent-b")

    print(f"Agent A: {agent_a.session_id}")
    print(f"Agent B: {agent_b.session_id}")

    # Agent A sends a message to Agent B
    print("\nAgent A sending message to Agent B...")
    response = agent_a.send_message(
        to_session=agent_b.session_id,
        event="ping",
        data={"data": 42, "message": "Hello from agent A!"},
    )
    print(f"Message sent: delivered={response['delivered']}")

    # Give it a moment
    time.sleep(0.5)

    # Agent B checks for messages
    print("\nAgent B checking messages...")
    messages = agent_b.messages()
    print(f"Received {len(messages)} message(s):")
    for msg in messages:
        print(f"  - from: {msg.get('from')}, event: {msg.get('event')}, data: {msg.get('data')}")

    # Agent B responds
    print("\nAgent B responding to Agent A...")
    response = agent_b.send_message(
        to_session=agent_a.session_id,
        event="pong",
        data={"response": "Hello from agent B!"},
    )
    print(f"Response sent: delivered={response['delivered']}")

    # Agent A checks for response
    time.sleep(0.5)
    print("\nAgent A checking for response...")
    messages = agent_a.messages()
    print(f"Received {len(messages)} message(s):")
    for msg in messages:
        print(f"  - from: {msg.get('from')}, event: {msg.get('event')}, data: {msg.get('data')}")

    # Execute some code in each session
    print("\nExecuting code in Agent A...")
    result_a = agent_a.execute('print("Hello from agent A!")')
    print(f"Agent A result: success={result_a.success}, output={result_a.output}")

    print("\nExecuting code in Agent B...")
    result_b = agent_b.execute('print("Hello from agent B!")')
    print(f"Agent B result: success={result_b.success}, output={result_b.output}")

    # Clean up
    print("\nCleaning up...")
    agent_a.destroy()
    agent_b.destroy()
    client.close()

    print("Done!")


if __name__ == "__main__":
    main()
