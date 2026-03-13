import { ClawBloxClient } from './client';
import { ClawBloxSession } from './session';
import { ObserveStateResponse, TrajectoryFrame, TestRunResponse } from './types';

/**
 * ClawBloxAgent - High-level RL-style agent interface
 */
export class ClawBloxAgent {
  private client: ClawBloxClient;
  private session: ClawBloxSession | null = null;
  private label: string;
  private seed?: number;
  private deterministic?: boolean;

  constructor(client?: ClawBloxClient, options?: { label?: string; seed?: number; deterministic?: boolean }) {
    this.client = client || new ClawBloxClient();
    this.label = options?.label || `agent-${Date.now()}`;
    this.seed = options?.seed;
    this.deterministic = options?.deterministic;
  }

  /**
   * Create/reset session and get initial state
   */
  async reset(): Promise<ObserveStateResponse> {
    // Create a new session
    this.session = await ClawBloxSession.create(this.client, {
      label: this.label,
      seed: this.seed,
      deterministic: this.deterministic,
    });

    // Start the session
    await this.session.start();

    // Get initial state
    return this.session.observe();
  }

  /**
   * Execute a step: run Lua action and return new state
   */
  async step(luaAction: string): Promise<{ state: ObserveStateResponse; done: boolean }> {
    if (!this.session) {
      throw new Error('Session not initialized. Call reset() first.');
    }

    // Execute the action
    await this.session.execute(luaAction);

    // Get new state
    const state = await this.session.observe();

    // Check if done (e.g., character died or reached goal)
    const done = this.checkDone(state);

    return { state, done };
  }

  /**
   * Get current observe state without executing
   */
  async observe(): Promise<ObserveStateResponse> {
    if (!this.session) {
      throw new Error('Session not initialized. Call reset() first.');
    }
    return this.session.observe();
  }

  /**
   * Run a test
   */
  async runTest(testCode: string): Promise<TestRunResponse> {
    return this.client.testRun({ code: testCode });
  }

  /**
   * Export trajectory (all recorded frames)
   */
  async exportTrajectory(): Promise<TrajectoryFrame[]> {
    const jsonl = await this.client.simulationExportTrajectory();
    const frames: TrajectoryFrame[] = [];
    for (const line of jsonl.split('\n').filter(l => l.trim())) {
      frames.push(JSON.parse(line));
    }
    return frames;
  }

  /**
   * Destroy this agent and its session
   */
  async destroy(): Promise<void> {
    if (this.session) {
      await this.session.destroy();
      this.session = null;
    }
  }

  /**
   * Check if episode is done based on state
   */
  private checkDone(state: ObserveStateResponse): boolean {
    // Check if any player has 0 health
    for (const player of state.players || []) {
      if (player.health !== undefined && player.health <= 0) {
        return true;
      }
    }
    return false;
  }
}
