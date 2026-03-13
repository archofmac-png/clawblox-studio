import { ClawBloxClient } from './client';
import {
  SessionCreateResponse, SessionStateResponse, SessionExecuteResponse,
  SessionResetResponse, SessionMessage, ObserveStateResponse
} from './types';

/**
 * ClawBloxSession - Session wrapper for ClawBlox API
 */
export class ClawBloxSession {
  public readonly sessionId: string;
  public readonly seed: number;
  public label: string | null;
  public createdAt: string;
  private client: ClawBloxClient;

  private constructor(client: ClawBloxClient, response: SessionCreateResponse) {
    this.client = client;
    this.sessionId = response.session_id;
    this.seed = response.seed;
    this.label = response.label;
    this.createdAt = response.createdAt;
  }

  /**
   * Create a new session
   */
  static async create(client: ClawBloxClient, options?: { label?: string; seed?: number; deterministic?: boolean }): Promise<ClawBloxSession> {
    const response = await client.sessionCreate(options);
    return new ClawBloxSession(client, response);
  }

  /**
   * Execute Lua script in this session
   */
  async execute(lua: string): Promise<SessionExecuteResponse> {
    return this.client.sessionExecute(this.sessionId, lua);
  }

  /**
   * Get observe state for this session
   */
  async observe(): Promise<SessionStateResponse> {
    return this.client.sessionState(this.sessionId);
  }

  /**
   * Reset this session (clears VM, trajectory, messages)
   */
  async reset(): Promise<SessionResetResponse> {
    return this.client.sessionReset(this.sessionId);
  }

  /**
   * Start this session
   */
  async start(): Promise<void> {
    await this.client.sessionStart(this.sessionId);
  }

  /**
   * Stop this session
   */
  async stop(): Promise<void> {
    await this.client.sessionStop(this.sessionId);
  }

  /**
   * Destroy this session
   */
  async destroy(): Promise<void> {
    await this.client.sessionDelete(this.sessionId);
  }

  /**
   * Send a message to another session
   */
  async sendMessage(toSessionId: string, event: string, data?: unknown): Promise<void> {
    await this.client.messagingBridge({
      from_session: this.sessionId,
      to_session: toSessionId,
      event,
      data,
    });
  }

  /**
   * Get messages for this session
   */
  async getMessages(): Promise<SessionMessage[]> {
    return this.client.sessionMessages(this.sessionId);
  }

  /**
   * Subscribe to WebSocket events for this session
   */
  on(event: string, handler: (data: unknown) => void): () => void {
    // This would require WebSocket support - return unsubscribe function
    console.warn('WebSocket subscription not implemented');
    return () => {};
  }
}
