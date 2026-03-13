// ScenePersistence — saves and loads scene state for a ClawBlox project
// - save(projectId, instances, message): writes scene.json + appends CHANGELOG.md
// - load(projectId): reads scene.json, returns scene snapshot
// - computeDelta(prev, curr): compute what changed between two snapshots
// - getChangelog(projectId): returns CHANGELOG.md content

import fs from 'fs';
import path from 'path';

const PROJECTS_DIR = path.join(process.cwd(), 'clawblox-projects');

export interface InstanceSnapshot {
  id: string;
  className: string;
  name: string;
  properties: Record<string, unknown>;
}

export interface SceneSnapshot {
  version: number;
  savedAt: string;
  projectId: string;
  instanceCount: number;
  workspace: InstanceSnapshot[];
  scripts: Record<string, string>; // path → content
}

export interface SaveDelta {
  added: number;
  removed: number;
  modified: number;
  details: string[];
}

export class ScenePersistence {
  private lastSnapshot: SceneSnapshot | null = null;

  computeDelta(prev: SceneSnapshot | null, curr: SceneSnapshot): SaveDelta {
    if (!prev) {
      return {
        added: curr.workspace.length,
        removed: 0,
        modified: 0,
        details: [`Initial save — ${curr.workspace.length} instances`],
      };
    }
    const prevIds = new Set(prev.workspace.map(i => i.id));
    const currIds = new Set(curr.workspace.map(i => i.id));
    const added = curr.workspace.filter(i => !prevIds.has(i.id)).length;
    const removed = prev.workspace.filter(i => !currIds.has(i.id)).length;
    // Modified: same id, different properties
    const modified = curr.workspace.filter(i => {
      if (!prevIds.has(i.id)) return false;
      const prevInst = prev.workspace.find(p => p.id === i.id);
      return JSON.stringify(prevInst?.properties) !== JSON.stringify(i.properties);
    }).length;
    const details: string[] = [];
    if (added > 0) details.push(`+${added} instances added`);
    if (removed > 0) details.push(`-${removed} instances removed`);
    if (modified > 0) details.push(`~${modified} instances modified`);
    if (details.length === 0) details.push('No instance changes');
    return { added, removed, modified, details };
  }

  async save(
    projectId: string,
    instances: InstanceSnapshot[],
    message: string
  ): Promise<{ ok: boolean; saveNumber: number; delta: SaveDelta }> {
    const projectDir = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

    const snapshot: SceneSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      projectId,
      instanceCount: instances.length,
      workspace: instances,
      scripts: {},
    };

    // Compute delta
    const delta = this.computeDelta(this.lastSnapshot, snapshot);

    // Write scene.json
    const scenePath = path.join(projectDir, 'scene.json');
    fs.writeFileSync(scenePath, JSON.stringify(snapshot, null, 2));

    // Append to CHANGELOG.md
    const changelogPath = path.join(projectDir, 'CHANGELOG.md');
    const existingChangelog = fs.existsSync(changelogPath)
      ? fs.readFileSync(changelogPath, 'utf8')
      : '';
    const saveNumber =
      (existingChangelog.match(/## Save #(\d+)/g) || []).length + 1;

    const entry = [
      `## Save #${saveNumber} — ${new Date().toISOString()}`,
      `**Message:** ${message}`,
      `**Changes since last save:**`,
      ...delta.details.map(d => `  ${d}`),
      `**Scene:** ${instances.length} instances | ${(JSON.stringify(snapshot).length / 1024).toFixed(1)} KB`,
      '',
    ].join('\n');

    fs.writeFileSync(changelogPath, entry + existingChangelog);

    this.lastSnapshot = snapshot;
    return { ok: true, saveNumber, delta };
  }

  load(projectId: string): SceneSnapshot | null {
    const scenePath = path.join(PROJECTS_DIR, projectId, 'scene.json');
    if (!fs.existsSync(scenePath)) return null;
    return JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  }

  getChangelog(projectId: string): string {
    const changelogPath = path.join(PROJECTS_DIR, projectId, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) return '';
    return fs.readFileSync(changelogPath, 'utf8');
  }

  listProjects(): Array<{ id: string; hasScene: boolean; lastSaved: string | null }> {
    if (!fs.existsSync(PROJECTS_DIR)) return [];
    return fs.readdirSync(PROJECTS_DIR)
      .filter(name => fs.statSync(path.join(PROJECTS_DIR, name)).isDirectory())
      .map(id => {
        const scenePath = path.join(PROJECTS_DIR, id, 'scene.json');
        if (!fs.existsSync(scenePath)) return { id, hasScene: false, lastSaved: null };
        try {
          const snap = JSON.parse(fs.readFileSync(scenePath, 'utf8')) as SceneSnapshot;
          return { id, hasScene: true, lastSaved: snap.savedAt };
        } catch {
          return { id, hasScene: false, lastSaved: null };
        }
      });
  }
}

export const scenePersistence = new ScenePersistence();
