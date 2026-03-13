import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import git from 'isomorphic-git';
import archiver from 'archiver';
import { WebSocketServer, WebSocket } from 'ws';

// Import game engine
import { gameEngine, setBroadcastFunction, broadcastStructuredEvent, incrementPhysicsTick, getTrajectory, resetCoverage, _coveredFiles, type TrajectoryFrame,
  // Wave H debug exports
  debugSetBreakpoint, debugGetBreakpoints, debugDeleteBreakpoint, debugGetLocalsState, debugStep, debugContinue,
  profilingStart, profilingStop, isProfilingActive, buildStructuredError, classifyLuaError,
  type Breakpoint, type StructuredError,
} from '../services/game-engine';
import { runTestFile, type TestSuiteV2 } from '../services/test-runner.js';

// Wave A: Structured observability
import { buildObserveState, extractGuiTree } from '../services/observability.js';

// Wave 4 imports
import { physicsWorld } from '../services/physics-world.js';
import { networkBridge } from '../services/network-bridge.js';
import { pathfindingService } from '../services/pathfinding.js';

// Wave 5.5 imports
import { scenePersistence } from '../services/scene-persistence.js';

// Wave C: Multi-Agent Session Orchestration
import { sessionManager, type Session } from '../services/session-manager.js';

// Wave 6: xml2js for rbxlx import
import { parseStringPromise } from 'xml2js';
import type { InstanceRecord } from '../services/game-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const WS_PORT = 3002;
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 64);
const DETERMINISTIC_DEFAULT = process.env.DETERMINISTIC_DEFAULT === 'true';
const SERVER_START_TIME = Date.now();
// Detect headless mode: running as plain Node (not inside Electron renderer)
const IS_HEADLESS = typeof process.versions?.electron === 'undefined';

// WebSocket server for live output
const wss = new WebSocketServer({ port: WS_PORT });
const wsClients: Set<WebSocket> = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected. Total: ${wsClients.size}`);

  // Wave C: Support session-scoped subscriptions
  // Clients send { "subscribe": "session_id" } to scope their stream.
  // Unsubscribed clients stay in the global wsClients set (legacy stream).
  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      if (msg && typeof msg.subscribe === 'string') {
        const sessionId = msg.subscribe;
        // Remove from global stream
        wsClients.delete(ws);
        // Subscribe to the named session
        sessionManager.subscribeClient(sessionId, ws);
        ws.send(JSON.stringify({ type: 'subscribed', session_id: sessionId }));
        console.log(`[WS] Client subscribed to session ${sessionId}`);
      }
    } catch (_) {
      // Not JSON or unknown message — ignore
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    // Wave C: Also remove from any session subscriptions
    sessionManager.unsubscribeClient(ws);
    console.log(`[WS] Client disconnected. Total: ${wsClients.size}`);
  });
  
  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    wsClients.delete(ws);
    sessionManager.unsubscribeClient(ws);
  });
});

console.log(`[WS] WebSocket server running on ws://localhost:${WS_PORT}`);

// Broadcast to all WebSocket clients
function broadcastOutput(type: string, message: string) {
  const payload = JSON.stringify({
    type,
    message,
    timestamp: new Date().toISOString(),
  });
  
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Set broadcast function on game engine (module-level export, not a method on gameEngine)
try { setBroadcastFunction(broadcastOutput); console.log('[WS] Broadcast function wired to game engine'); } catch(e) { console.log("WS broadcast not available:", e) }

// Wire NetworkBridge broadcast
networkBridge.setBroadcast(broadcastOutput);

// ── Wave A: Observe state push timer (500ms) ─────────────────────────────
/**
 * Broadcast the full observe:state payload over WebSocket every 500ms
 * while a game session is running.
 */
function broadcastObserveState(): void {
  try {
    const raw = gameEngine.getObserveStateRaw();
    const state = buildObserveState(
      raw.instances,
      raw.physicsBodies,
      raw.dataStore,
      raw.players,
      raw.metadata,
    );
    broadcastStructuredEvent({ event: 'observe:state', data: state });
  } catch (e) {
    // Don't crash the server on serialization errors
    console.error('[observe] push error:', (e as Error).message);
  }
}

// Physics tick broadcast — emitted by the observe loop alongside physics bodies
setInterval(() => {
  try {
    const tick = incrementPhysicsTick();
    const bodies = physicsWorld.getSerializedBodies();
    broadcastStructuredEvent({
      event: 'physics:tick',
      tick,
      timestamp: Date.now(),
      bodies,
    });
    // Also push full state every 500ms
    broadcastObserveState();
  } catch (_) {
    // Silently ignore during shutdown
  }
}, 500);

// Wire PathfindingService agent movement broadcast
pathfindingService.setAgentBroadcast((agentName, position, done) => {
  broadcastOutput('agent-move', JSON.stringify({ agentName, position, done }));
});

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

const PROJECTS_DIR = path.join(__dirname, '../../clawblox-projects');

// Ensure projects directory exists
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// Health check — Wave G enhanced
app.get('/api/health', (_req, res) => {
  const activeSessions = sessionManager.listSessions().length;
  res.json({
    status: 'ok',
    version: '1.1.0',
    uptime_s: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
    sessions: {
      active: activeSessions,
      max: MAX_SESSIONS,
    },
    mode: IS_HEADLESS ? 'headless' : 'electron',
    deterministic_default: DETERMINISTIC_DEFAULT,
    timestamp: new Date().toISOString(),
  });
});

// Wave D: OpenAPI spec endpoints
const OPENAPI_JSON_PATH = path.join(__dirname, '../../openapi.json');

app.get('/api/openapi.json', (req, res) => {
  try {
    if (fs.existsSync(OPENAPI_JSON_PATH)) {
      res.setHeader('Content-Type', 'application/json');
      res.send(fs.readFileSync(OPENAPI_JSON_PATH, 'utf-8'));
    } else {
      res.status(404).json({ error: 'openapi.json not found. Generate it with: npm run generate-openapi' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/openapi.yaml', (req, res) => {
  try {
    if (fs.existsSync(OPENAPI_JSON_PATH)) {
      const yaml = require('js-yaml');
      const spec = JSON.parse(fs.readFileSync(OPENAPI_JSON_PATH, 'utf-8'));
      const yamlStr = yaml.dump(spec, { lineWidth: -1 });
      res.setHeader('Content-Type', 'text/yaml');
      res.send(yamlStr);
    } else {
      res.status(404).json({ error: 'openapi.json not found' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List all projects
app.get('/api/projects', (req, res) => {
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR).filter(f => 
      fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory()
    );
    res.json(dirs.map(name => ({
      id: name,
      name,
      created: fs.statSync(path.join(PROJECTS_DIR, name)).birthtime
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new project
app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  
  const projectPath = path.join(PROJECTS_DIR, name);
  if (fs.existsSync(projectPath)) {
    return res.status(409).json({ error: 'project exists' });
  }
  
  // Create project structure
  const dirs = [
    'src/ServerScriptService',
    'src/StarterPlayer/StarterPlayerScripts',
    'src/ReplicatedStorage',
    'src/ReplicatedFirst',
    'src/Workspace',
    'assets'
  ];
  
  dirs.forEach(d => {
    fs.mkdirSync(path.join(projectPath, d), { recursive: true });
  });
  
  // Create default README
  fs.writeFileSync(path.join(projectPath, 'README.md'), `# ${name}\n\nRoblox project created with ClawBlox Studio\n`);
  
  res.json({ id: name, name, created: new Date().toISOString() });
});

// Get project details with metadata
app.get('/api/projects/:id', (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  function countFiles(dir: string): number {
    let count = 0;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        count += countFiles(fullPath);
      } else {
        count++;
      }
    }
    return count;
  }
  
  function getLatestModified(dir: string): Date {
    let latest = fs.statSync(dir).mtime;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const childLatest = getLatestModified(fullPath);
        if (childLatest > latest) latest = childLatest;
      } else if (stat.mtime > latest) {
        latest = stat.mtime;
      }
    }
    return latest;
  }
  
  const stats = fs.statSync(projectPath);
  const fileCount = countFiles(projectPath);
  const lastModified = getLatestModified(projectPath);
  
  res.json({
    id: req.params.id,
    name: req.params.id,
    created: stats.birthtime,
    modified: stats.mtime,
    lastModified,
    fileCount
  });
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  fs.rmSync(projectPath, { recursive: true });
  res.json({ deleted: req.params.id });
});

// List project files
app.get('/api/projects/:id/files', (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  function listFiles(dir: string, base = ''): string[] {
    const items = fs.readdirSync(dir);
    const files: string[] = [];
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relativePath = path.join(base, item);
      if (fs.statSync(fullPath).isDirectory()) {
        files.push(...listFiles(fullPath, relativePath));
      } else {
        files.push(relativePath);
      }
    }
    return files;
  }
  
  res.json(listFiles(projectPath));
});

// ============ Search Files ============
// Search files by name in a project
app.get('/api/projects/:id/search', (req, res) => {
  const { id } = req.params;
  const query = req.query.q as string;
  
  if (!query) {
    return res.status(400).json({ error: 'query parameter q is required' });
  }
  
  const projectPath = path.join(PROJECTS_DIR, id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    function searchFiles(dir: string, base = ''): string[] {
      const results: string[] = [];
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.join(base, item);
        
        // Check if filename contains query (case-insensitive)
        if (item.toLowerCase().includes(query.toLowerCase())) {
          results.push(relativePath);
        }
        
        // Recurse into directories
        if (fs.statSync(fullPath).isDirectory()) {
          results.push(...searchFiles(fullPath, relativePath));
        }
      }
      return results;
    }
    
    const results = searchFiles(projectPath);
    res.json({ query, count: results.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create new file
app.post('/api/projects/:id/files', (req, res) => {
  const { path: filePath, content = '' } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  const fullPath = path.join(projectPath, filePath);
  if (fs.existsSync(fullPath)) {
    return res.status(409).json({ error: 'file already exists' });
  }
  
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(fullPath, content, 'utf-8');
  res.json({ path: filePath, created: true });
});

// ============ Bulk File Operations ============
// Create multiple files at once
app.post('/api/projects/:id/files/bulk', (req, res) => {
  const { files } = req.body;
  
  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: 'files array is required' });
  }
  
  if (files.length === 0) {
    return res.status(400).json({ error: 'files array cannot be empty' });
  }
  
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  const results: { path: string; success: boolean; error?: string }[] = [];
  
  for (const file of files) {
    const { path: filePath, content = '' } = file;
    
    if (!filePath) {
      results.push({ path: 'unknown', success: false, error: 'path is required' });
      continue;
    }
    
    try {
      const fullPath = path.join(projectPath, filePath);
      
      if (fs.existsSync(fullPath)) {
        results.push({ path: filePath, success: false, error: 'file already exists' });
        continue;
      }
      
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(fullPath, content, 'utf-8');
      results.push({ path: filePath, success: true });
    } catch (err: any) {
      results.push({ path: filePath, success: false, error: err.message });
    }
  }
  
  const successful = results.filter(r => r.success).length;
  res.json({ 
    total: files.length, 
    successful, 
    failed: files.length - successful,
    results 
  });
});

// ============ File Rename ============
// Rename a file
app.post('/api/projects/:id/files/rename', (req, res) => {
  const { path: oldPath, name: newName } = req.body;
  
  if (!oldPath) return res.status(400).json({ error: 'current path is required' });
  if (!newName) return res.status(400).json({ error: 'new name is required' });
  
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  const oldFullPath = path.join(projectPath, oldPath);
  if (!fs.existsSync(oldFullPath)) {
    return res.status(404).json({ error: 'file not found' });
  }
  
  const oldDir = path.dirname(oldPath);
  const newPath = path.join(oldDir, newName);
  const newFullPath = path.join(projectPath, newPath);
  
  if (fs.existsSync(newFullPath)) {
    return res.status(409).json({ error: 'a file with the new name already exists' });
  }
  
  try {
    fs.renameSync(oldFullPath, newFullPath);
    res.json({ oldPath, newPath, renamed: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Project Export ============
// Export project as ZIP
app.get('/api/projects/:id/export', (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  const projectName = req.params.id;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${projectName}.zip"`);
  
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
  
  archive.pipe(res);
  archive.directory(projectPath, false);
  archive.finalize();
});

// Delete file
app.delete('/api/projects/:id/files', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  const fullPath = path.join(projectPath, filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'file not found' });
  }
  
  fs.unlinkSync(fullPath);
  res.json({ path: filePath, deleted: true });
});

// Get file contents
app.get('/api/files/:id', (req, res) => {
  const { id } = req.params;
  const filePath = req.query.path;
  
  if (!filePath) return res.status(400).json({ error: 'path required' });
  
  const fullPath = path.join(PROJECTS_DIR, id, filePath as string);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'file not found' });
  }
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  res.json({ path: filePath, content });
});

// Legacy file write (kept for backward compatibility)
app.put('/api/files/:id', (req, res) => {
  const { id } = req.params;
  const { path: filePath, content } = req.body;
  
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'path and content required' });
  }
  
  const fullPath = path.join(PROJECTS_DIR, id, filePath);
  const dir = path.dirname(fullPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(fullPath, content, 'utf-8');
  res.json({ path: filePath, written: true });
});

// ============ Git Integration ============

// Initialize git repo for a project
async function ensureGitRepo(projectPath: string): Promise<void> {
  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) {
    await git.init({ fs, dir: projectPath, defaultBranch: 'main' });
  }
}

// Commit changes
app.post('/api/projects/:id/git/commit', async (req, res) => {
  const { message, author } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    await ensureGitRepo(projectPath);
    
    // Stage all changes
    const status = await git.statusMatrix({ fs, dir: projectPath });
    for (const [filepath, head, workdir, stage] of status) {
      if (workdir !== head || stage !== head) {
        await git.add({ fs, dir: projectPath, filepath });
      }
    }
    
    // Commit
    const sha = await git.commit({
      fs,
      dir: projectPath,
      message,
      author: {
        name: author || 'ClawBlox User',
        email: author ? `${author}@clawblox.local` : 'user@clawblox.local'
      }
    });
    
    res.json({ sha, message, author: author || 'ClawBlox User' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get commit log
app.get('/api/projects/:id/git/log', async (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    await ensureGitRepo(projectPath);
    
    const commits = await git.log({ 
      fs, 
      dir: projectPath, 
      depth: parseInt(req.query.limit as string) || 50 
    });
    
    res.json(commits.map(c => ({
      sha: c.oid,
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.timestamp * 1000
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get file diff
app.get('/api/projects/:id/git/diff', async (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  const filePath = req.query.path as string;
  
  if (!filePath) return res.status(400).json({ error: 'path required' });
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    await ensureGitRepo(projectPath);
    
    const oid = await git.resolveRef({ fs, dir: projectPath, ref: 'HEAD' });
    const { blob } = await git.readBlob({ fs, dir: projectPath, oid, filepath: filePath });
    const content = new TextDecoder().decode(blob);
    
    res.json({ path: filePath, content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create branch
app.post('/api/projects/:id/git/branch', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'branch name required' });
  
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    await ensureGitRepo(projectPath);
    await git.branch({ fs, dir: projectPath, ref: name });
    res.json({ branch: name, created: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List branches
app.get('/api/projects/:id/git/branches', async (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    await ensureGitRepo(projectPath);
    const branches = await git.listBranches({ fs, dir: projectPath });
    res.json(branches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Checkout branch
app.post('/api/projects/:id/git/checkout', async (req, res) => {
  const { branch } = req.body;
  if (!branch) return res.status(400).json({ error: 'branch name required' });
  
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    await ensureGitRepo(projectPath);
    await git.checkout({ fs, dir: projectPath, ref: branch });
    res.json({ branch, checkedOut: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get git status
app.get('/api/projects/:id/git/status', async (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, req.params.id);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'project not found' });
  }
  
  try {
    await ensureGitRepo(projectPath);
    
    const status = await git.statusMatrix({ fs, dir: projectPath });
    const files: Record<string, string> = {};
    
    for (const [filepath, head, workdir, stage] of status) {
      if (head !== workdir || head !== stage) {
        files[filepath] = (git as any).StatusMatrix?.[head << 3 | workdir << 1 | stage] ?? 'modified';
      }
    }
    
    const currentBranch = await git.currentBranch({ fs, dir: projectPath });
    
    res.json({ branch: currentBranch, files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Game Simulation API
// ============================================================================

// Start game simulation
app.post('/api/game/start', async (req, res) => {
  try {
    // Wave B: Deterministic mode support (?deterministic=true&seed=12345 or body)
    const detParam = (req.query.deterministic ?? req.body?.deterministic);
    const deterministic = detParam === 'true' || detParam === true;
    const seedParam = req.query.seed ?? req.body?.seed;
    const seed = seedParam !== undefined ? Number(seedParam) : undefined;

    const state = await gameEngine.start({ deterministic, seed });
    // Wave F: Reset coverage tracking on game start
    resetCoverage();
    res.json({ 
      success: true, 
      status: state.status,
      message: 'Game simulation started',
      seed: state.seed,
      deterministic: state.deterministic,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Stop game simulation
app.post('/api/game/stop', (req, res) => {
  try {
    const state = gameEngine.stop();
    res.json({ 
      success: true, 
      status: state.status,
      message: 'Game simulation stopped'
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get game state
app.get('/api/game/state', (req, res) => {
  try {
    const state = gameEngine.getState();
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Execute Lua script
app.post('/api/game/execute', async (req, res) => {
  const { script } = req.body;
  if (!script) {
    return res.status(400).json({ error: 'script is required' });
  }
  
  try {
    // Wave B: Deterministic mode support
    const detParam = (req.query.deterministic ?? req.body?.deterministic);
    const deterministic = detParam === 'true' || detParam === true;
    const seedParam = req.query.seed ?? req.body?.seed;
    const seed = seedParam !== undefined ? Number(seedParam) : undefined;
    const opts = (deterministic || seed !== undefined) ? { deterministic, seed } : undefined;

    const result = await gameEngine.execute(script, opts);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get workspace objects
app.get('/api/workspace', (req, res) => {
  try {
    const workspace = gameEngine.getWorkspace();
    res.json(workspace);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a part in workspace
app.post('/api/workspace/part', (req, res) => {
  const { name, position, size } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  
  try {
    const part = gameEngine.createPart(name, position, size);
    res.json({ 
      success: true, 
      part: {
        Name: (part as any).Name,
        ClassName: (part as any).ClassName,
        Position: (part as any).Position,
        Size: (part as any).Size,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get game object (for debugging)
app.get('/api/game/debug', (req, res) => {
  try {
    const gameObj = gameEngine.getGame();
    res.json((gameObj as any).toJSON?.() ?? gameObj);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Playtest API — new endpoints
// ============================================================================

/**
 * POST /api/game/load
 * Load a project's scripts in Roblox execution order.
 * Body: { projectId: string } — looks in PROJECTS_DIR/<projectId>
 *       OR { projectPath: string } — absolute path
 */
app.post('/api/game/load', async (req, res) => {
  const { projectId, projectPath: rawPath } = req.body;

  if (!projectId && !rawPath) {
    return res.status(400).json({ error: 'projectId or projectPath is required' });
  }

  const resolvedPath = rawPath ?? path.join(PROJECTS_DIR, projectId);

  try {
    const result = await gameEngine.loadProject(resolvedPath);
    res.json({
      success: true,
      projectPath: resolvedPath,
      scriptsLoaded: result.loaded.length,
      scripts: result.loaded.map((s: any) => ({ name: s.name, service: s.service, path: s.path })),
      errors: result.errors,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/game/simulate
 * Simulate a player action.
 * Body: { playerName: string, action: "join"|"leave"|"chat"|"move", message?: string, position?: {x,y,z} }
 */
app.post('/api/game/simulate', async (req, res) => {
  const { playerName, action, message, position } = req.body;

  if (!playerName) return res.status(400).json({ error: 'playerName is required' });
  if (!action) return res.status(400).json({ error: 'action is required' });

  try {
    const result = await gameEngine.simulatePlayer(playerName, { action, message, position });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/game/query
 * Query a game instance by path.
 * Query params: path=Workspace.Baseplate
 */
app.get('/api/game/query', (req, res) => {
  const queryPath = req.query.path as string;

  if (!queryPath) {
    // No path → return full game state
    try {
      return res.json(gameEngine.getGameState());
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const inst = gameEngine.queryInstance(queryPath);
    if (!inst) {
      return res.status(404).json({ found: false, path: queryPath, error: 'Instance not found' });
    }

    // queryInstance now returns a plain JS object from the registry
    if (!inst.found) {
      return res.status(404).json(inst);
    }
    const serialized: any = {
      found: inst.found,
      path: queryPath,
      Name: inst.Name,
      ClassName: inst.ClassName,
      Path: inst.Path,
      ChildCount: inst.ChildCount,
      Properties: inst.Properties || {},
    };

    res.json(serialized);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/game/test
 * Run a Lua assertion test.
 * Body: { assertion: string, description: string }
 * Example assertion: "Players:FindFirstChild('TestPlayer') ~= nil"
 */
app.post('/api/game/test', async (req, res) => {
  const { assertion, description } = req.body;

  if (!assertion) return res.status(400).json({ error: 'assertion is required' });

  try {
    const result = await gameEngine.runTest(assertion, description ?? assertion);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/game/instances
 * List all instances in the workspace (and Players, ReplicatedStorage).
 */
app.get('/api/game/instances', (req, res) => {
  try {
    const data = gameEngine.getAllInstances();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/game/state/snapshot
 * Wave 5 — Live Rendering Sync.
 * Returns full current scene state: parts, players, enemies, running status.
 * Used by the Viewport "Sync Scene" button to rebuild the 3D scene from scratch.
 */
app.get('/api/game/state/snapshot', (req, res) => {
  try {
    const snapshot = gameEngine.getSnapshotState();
    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/game/simulate-player
 * Alias for /api/game/simulate (convenience endpoint).
 * Body: { playerName: string, action: string, position?: {x,y,z} }
 */
app.post('/api/game/simulate-player', async (req, res) => {
  const { playerName, action, message, position } = req.body;
  if (!playerName) return res.status(400).json({ error: 'playerName is required' });
  if (!action) return res.status(400).json({ error: 'action is required' });
  try {
    const result = await gameEngine.simulatePlayer(playerName, { action, message, position });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// Test Runner API — Wave 5
// ============================================================================

/**
 * POST /api/test/run
 * Run a .clawtest.lua test file by path or inline code.
 * Body: { filePath?: string, code?: string }
 * Wave B: ?deterministic=true&seed=N seeds Lua RNG before tests run.
 * Wave F: Returns v2 structured output (backward compatible).
 */
app.post('/api/test/run', async (req, res) => {
  const { filePath, code } = req.body;
  let luaCode = code;
  let resolvedPath = filePath || 'inline';

  if (filePath && !code) {
    try {
      luaCode = fs.readFileSync(filePath, 'utf-8');
    } catch (e: any) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }
  }

  if (!luaCode) return res.status(400).json({ error: 'Provide filePath or code' });

  try {
    // Wave B: Deterministic mode — seed RNG before running tests
    const detParam = (req.query.deterministic ?? req.body?.deterministic);
    const deterministic = detParam === 'true' || detParam === true;
    const seedParam = req.query.seed ?? req.body?.seed;
    let seedUsed: number | undefined;
    if (deterministic) {
      seedUsed = seedParam !== undefined ? Number(seedParam) : Math.floor(Math.random() * 2 ** 31);
      // Inject math.randomseed before the test code
      luaCode = `math.randomseed(${seedUsed})\n` + luaCode;
    }

    const suite = await runTestFile(resolvedPath, luaCode);

    // Wave F: Build v2 response (backward compat — keep all original fields)
    const resp: Record<string, unknown> = {
      // Legacy fields
      file: suite.file,
      results: suite.results,
      passed: suite.passed,
      failed: suite.failed,
      duration: suite.duration,
      // v2 fields
      success: suite.success,
      skipped: suite.skipped,
      duration_ms: suite.duration_ms,
      results_v2: suite.results_v2,
      rewards_total: suite.rewards_total,
      trajectory_frames: suite.trajectory_frames,
    };
    if (deterministic) {
      resp.deterministic = true;
      resp.seed = seedUsed;
    }
    res.json(resp);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/test/files
 * List all .clawtest.lua files in the clawblox-projects directory.
 */
app.get('/api/test/files', (req, res) => {
  const searchDirs = [
    path.join(__dirname, '../../clawblox-projects'),
    path.join(__dirname, '../../tests'),
  ];
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.clawtest.lua')) files.push(full);
    }
  };
  for (const dir of searchDirs) walk(dir);
  res.json({ files });
});

// ============================================================================
// Wave F: Test Batch + Coverage endpoints
// ============================================================================

/**
 * POST /api/test/run_batch
 * Run multiple Lua test cases, sequentially or in parallel.
 * Body: { tests: [{code, label}], deterministic?, seed?, parallel? }
 */
app.post('/api/test/run_batch', async (req, res) => {
  const { tests, deterministic = false, seed, parallel = false } = req.body ?? {};

  if (!Array.isArray(tests) || tests.length === 0) {
    return res.status(400).json({ error: 'tests array required' });
  }

  const { randomUUID } = await import('crypto');
  const batchId = randomUUID();
  const batchStart = Date.now();
  const seedUsed: number = seed !== undefined ? Number(seed) : Math.floor(Math.random() * 2 ** 31);

  interface BatchResult {
    label: string;
    passed: boolean;
    duration_ms: number;
    rewards: number[];
    trajectory: string;
    results_v2: TestSuiteV2['results_v2'];
    error?: string;
  }

  async function runSingle(entry: { code?: string; label?: string }): Promise<BatchResult> {
    const label = entry.label || 'test';
    let luaCode = entry.code || '';
    if (!luaCode) {
      return { label, passed: false, duration_ms: 0, rewards: [], trajectory: '', results_v2: [], error: 'No code provided' };
    }
    if (deterministic) {
      luaCode = `math.randomseed(${seedUsed})\n` + luaCode;
    }

    let suite: TestSuiteV2;
    if (parallel) {
      // Each test gets its own isolated session via session manager
      const sessionResult = sessionManager.createSession({ deterministic, seed: seedUsed });
      if ('error' in sessionResult) {
        return { label, passed: false, duration_ms: 0, rewards: [], trajectory: '', results_v2: [], error: sessionResult.error };
      }
      const session = sessionResult;
      try {
        await sessionManager.ensureInit(session);
        // runTestFile creates its own isolated GameEngine/Lua VM per call
        // (parallel isolation is achieved via independent GameEngine instances)
        suite = await runTestFile(label, luaCode);
      } finally {
        sessionManager.destroySession(session.id);
      }
    } else {
      suite = await runTestFile(label, luaCode);
    }

    const allRewards = suite.results_v2.flatMap(r => r.rewards);
    const testPassed = suite.failed === 0;

    // Build trajectory JSONL if deterministic
    let trajectory = '';
    if (deterministic) {
      const frames = getTrajectory();
      trajectory = frames.map(f => JSON.stringify(f)).join('\n');
    }

    return {
      label,
      passed: testPassed,
      duration_ms: suite.duration_ms,
      rewards: allRewards,
      trajectory,
      results_v2: suite.results_v2,
    };
  }

  try {
    let results: BatchResult[];
    if (parallel) {
      results = await Promise.all(tests.map((t: { code?: string; label?: string }) => runSingle(t)));
    } else {
      results = [];
      for (const t of tests) {
        results.push(await runSingle(t));
      }
    }

    const totalPassed = results.filter(r => r.passed).length;
    const totalFailed = results.length - totalPassed;

    res.json({
      batch_id: batchId,
      total: results.length,
      passed: totalPassed,
      failed: totalFailed,
      duration_ms: Date.now() - batchStart,
      deterministic,
      seed: seedUsed,
      results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/test/coverage
 * Return Lua/Luau file coverage stats for the current project.
 */
app.get('/api/test/coverage', (req, res) => {
  // Walk .lua/.luau files from the clawblox-projects directory and the loaded project
  const searchDirs = [
    path.join(__dirname, '../../clawblox-projects'),
    path.join(__dirname, '../../src'),
  ];

  const allLuaFiles: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          // Skip node_modules and out dirs
          if (f === 'node_modules' || f === 'out' || f === 'build') continue;
          walk(full);
        } else if (f.endsWith('.lua') || f.endsWith('.luau')) {
          allLuaFiles.push(full);
        }
      } catch (_) {}
    }
  };
  for (const dir of searchDirs) walk(dir);

  // Also check test files for references to source files
  const testDirs = [
    path.join(__dirname, '../../tests'),
    path.join(__dirname, '../../clawblox-projects'),
  ];
  const testFileContents: string[] = [];
  const walkTests = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walkTests(full);
        else if (f.endsWith('.clawtest.lua')) {
          testFileContents.push(fs.readFileSync(full, 'utf-8'));
        }
      } catch (_) {}
    }
  };
  for (const dir of testDirs) walkTests(dir);

  const testedFiles = new Set<string>();
  const untested: string[] = [];

  for (const luaFile of allLuaFiles) {
    const basename = path.basename(luaFile);
    const nameNoExt = basename.replace(/\.(lua|luau)$/, '');

    // "Tested" = was require()-ed during a test run OR referenced by name in a test file
    const wasRequired = _coveredFiles.has(basename) || _coveredFiles.has(nameNoExt) || _coveredFiles.has(luaFile);
    const referencedInTest = testFileContents.some(content =>
      content.includes(basename) || content.includes(nameNoExt)
    );

    if (wasRequired || referencedInTest) {
      testedFiles.add(luaFile);
    } else {
      untested.push(luaFile);
    }
  }

  const totalFiles = allLuaFiles.length;
  const testedCount = testedFiles.size;
  const coveragePct = totalFiles > 0 ? Math.round((testedCount / totalFiles) * 10000) / 100 : 100;

  res.json({
    total_files: totalFiles,
    tested_files: testedCount,
    coverage_pct: coveragePct,
    untested,
    covered: Array.from(testedFiles),
  });
});

// ============================================================================
// Physics API — Wave 4
// ============================================================================

/**
 * POST /api/physics/spherecast
 * Perform a sphere cast in the physics world.
 * Body: { origin: {x,y,z}, direction: {x,y,z}, radius: number, distance: number }
 */
app.post('/api/physics/spherecast', (req, res) => {
  try {
    const { origin, direction, radius, distance } = req.body;
    if (!origin || !direction || radius === undefined || distance === undefined) {
      return res.status(400).json({ error: 'origin, direction, radius, distance required' });
    }
    const hits = physicsWorld.sphereCast(origin, direction, radius, distance);
    const result = hits.map(inst => ({
      name: inst.Name,
      className: inst.ClassName,
      position: inst.properties['Position'] ?? { X: 0, Y: 0, Z: 0 },
    }));
    res.json({ hits: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/physics/step
 * Advance physics simulation by dt seconds.
 * Body: { dt?: number }  (default 1/60)
 */
app.post('/api/physics/step', (req, res) => {
  try {
    const dt = (req.body && req.body.dt) ? Number(req.body.dt) : 1 / 60;
    // If session_id is provided (query param or body), step that session's physics
    const sessionId = (req.query.session_id as string) || (req.body && req.body.session_id);
    if (sessionId) {
      const session = sessionManager.getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      session.engine.physicsStep(dt);
    } else {
      // Fallback: global physics world (legacy)
      physicsWorld.step(dt);
    }
    res.json({ ok: true, dt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/physics/bodies
 * List all registered physics bodies.
 */
app.get('/api/physics/bodies', (req, res) => {
  try {
    const bodies = physicsWorld.getAllBodies();
    res.json({ count: bodies.length, bodies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Network Bridge API — Wave 4
// ============================================================================

/**
 * POST /api/network/add-client
 * Spin up a client VM for a player.
 * Body: { playerName: string }
 */
app.post('/api/network/add-client', async (req, res) => {
  try {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ error: 'playerName required' });
    await networkBridge.addClient(playerName);
    res.json({ ok: true, playerName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/network/fire-server
 * Route a FireServer call from a client to the server.
 * Body: { playerName: string, remoteName: string, args: any[] }
 */
app.post('/api/network/fire-server', async (req, res) => {
  try {
    const { playerName, remoteName, args } = req.body;
    if (!playerName || !remoteName) {
      return res.status(400).json({ error: 'playerName and remoteName required' });
    }
    await networkBridge.fireServer(playerName, remoteName, args ?? []);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/network/fire-client
 * Route a FireClient call from the server to a specific client.
 * Body: { playerName: string, remoteName: string, args: any[] }
 */
app.post('/api/network/fire-client', async (req, res) => {
  try {
    const { playerName, remoteName, args } = req.body;
    if (!playerName || !remoteName) {
      return res.status(400).json({ error: 'playerName and remoteName required' });
    }
    await networkBridge.fireClient(playerName, remoteName, args ?? []);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/network/clients
 * List all connected client VMs.
 */
app.get('/api/network/clients', (req, res) => {
  try {
    const clients = networkBridge.getClients();
    res.json({ clients, count: clients.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/network/run-client
 * Run a Lua script on a specific client VM.
 * Body: { playerName: string, script: string }
 */
app.post('/api/network/run-client', async (req, res) => {
  try {
    const { playerName, script } = req.body;
    if (!playerName || !script) {
      return res.status(400).json({ error: 'playerName and script required' });
    }
    const result = await networkBridge.runOnClient(playerName, script);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Pathfinding API — Wave 4
// ============================================================================

/**
 * POST /api/pathfinding/find
 * Find an A* path from `from` to `to`.
 * Body: { from: {x,y,z}, to: {x,y,z} }
 */
app.post('/api/pathfinding/find', (req, res) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const result = pathfindingService.findPath(from, to);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pathfinding/add-obstacle
 * Add a Part obstacle to the pathfinding grid.
 * Body: { position: {x,y,z}, size: {x,y,z}, id: string }
 */
app.post('/api/pathfinding/add-obstacle', (req, res) => {
  try {
    const { position, size, id } = req.body;
    if (!position || !size || !id) {
      return res.status(400).json({ error: 'position, size, and id required' });
    }
    pathfindingService.addObstacle(id, position, size);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pathfinding/move-agent
 * Move an agent along a computed A* path.
 * Body: { agentName: string, from: {x,y,z}, to: {x,y,z}, speed: number }
 */
app.post('/api/pathfinding/move-agent', (req, res) => {
  try {
    const { agentName, from, to, speed } = req.body;
    if (!agentName || !from || !to) {
      return res.status(400).json({ error: 'agentName, from, and to required' });
    }
    const result = pathfindingService.moveAgent(agentName, from, to, speed ?? 16);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pathfinding/grid
 * Get pathfinding grid configuration.
 */
app.get('/api/pathfinding/grid', (req, res) => {
  try {
    res.json(pathfindingService.getGridInfo());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// Deploy Pipeline — Wave 6
// ============================================================================

const DEPLOY_HISTORY_PATH = path.join(__dirname, '../../deploy-history.json');
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY || '';
const ROBLOX_UNIVERSE_ID = process.env.ROBLOX_UNIVERSE_ID || '';
const ROBLOX_PLACE_ID = process.env.ROBLOX_PLACE_ID || '';

function readDeployHistory(): any[] {
  try {
    if (fs.existsSync(DEPLOY_HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(DEPLOY_HISTORY_PATH, 'utf-8'));
    }
  } catch {}
  return [];
}

function writeDeployHistory(history: any[]): void {
  try {
    fs.writeFileSync(DEPLOY_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
  } catch (e: any) {
    console.error('[DEPLOY] Failed to write history:', e.message);
  }
}

function collectLuaFiles(dir: string): { filePath: string; relativePath: string; content: string }[] {
  const results: { filePath: string; relativePath: string; content: string }[] = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (d: string, base: string) => {
    for (const item of fs.readdirSync(d)) {
      const full = path.join(d, item);
      const rel = path.join(base, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else if (item.endsWith('.lua') || item.endsWith('.luau')) {
        try {
          results.push({ filePath: full, relativePath: rel, content: fs.readFileSync(full, 'utf-8') });
        } catch {}
      }
    }
  };
  walk(dir, '');
  return results;
}

function buildRbxlx(scripts: { relativePath: string; content: string }[]): string {
  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const scriptItems = scripts.map(({ relativePath, content }, i) => {
    const name = path.basename(relativePath, path.extname(relativePath));
    const isLocal = relativePath.toLowerCase().includes('localscript') || relativePath.toLowerCase().includes('starterplayer');
    const isModule = relativePath.toLowerCase().includes('module');
    const className = isModule ? 'ModuleScript' : isLocal ? 'LocalScript' : 'Script';
    return `
    <Item class="${className}" referent="RBX${String(i).padStart(8, '0')}">
      <Properties>
        <string name="Name">${escapeXml(name)}</string>
        <ProtectedString name="Source"><![CDATA[${content}]]></ProtectedString>
        <bool name="Disabled">false</bool>
      </Properties>
    </Item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Workspace" referent="RBXWORKSPACE">
    <Properties>
      <string name="Name">Workspace</string>
    </Properties>
    ${scriptItems}
  </Item>
</roblox>`;
}

/**
 * POST /api/deploy
 * Deploy a project to Roblox Open Cloud.
 * Body: { projectPath: string, universeId?: string }
 */
app.post('/api/deploy', async (req, res) => {
  const { projectPath, universeId } = req.body;

  if (!projectPath) {
    return res.status(400).json({ success: false, error: 'projectPath is required' });
  }

  const deployId = `deploy_${Date.now()}`;
  const errors: string[] = [];
  let pushedToRoblox = false;
  let rbxlxPath: string | null = null;

  try {
    // 1. Collect Lua files
    const luaFiles = collectLuaFiles(projectPath);
    if (luaFiles.length === 0) {
      errors.push('No .lua/.luau files found in project path');
    }

    // 2. Generate .rbxlx
    const rbxlxContent = buildRbxlx(luaFiles);
    const outDir = path.join(__dirname, '../../deploy-output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    rbxlxPath = path.join(outDir, `${deployId}.rbxlx`);
    fs.writeFileSync(rbxlxPath, rbxlxContent, 'utf-8');
    console.log(`[DEPLOY] Generated .rbxlx: ${rbxlxPath} (${luaFiles.length} scripts)`);

    // 3. Push to Roblox Open Cloud if universeId is provided
    const targetUniverseId = universeId || ROBLOX_UNIVERSE_ID;
    if (targetUniverseId && ROBLOX_API_KEY) {
      try {
        const rbxlxBuffer = fs.readFileSync(rbxlxPath);
        const url = `https://apis.roblox.com/universes/v1/${targetUniverseId}/places/${ROBLOX_PLACE_ID}/versions?versionType=Published`;
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': ROBLOX_API_KEY,
            'Content-Type': 'application/octet-stream',
          },
          body: rbxlxBuffer,
        });

        if (response.ok) {
          const data = await response.json();
          pushedToRoblox = true;
          console.log(`[DEPLOY] Pushed to Roblox! Version: ${JSON.stringify(data)}`);
        } else {
          const errText = await response.text();
          errors.push(`Roblox API error ${response.status}: ${errText}`);
          console.error(`[DEPLOY] Roblox push failed: ${response.status} ${errText}`);
        }
      } catch (fetchErr: any) {
        errors.push(`Roblox push failed: ${fetchErr.message}`);
        console.error('[DEPLOY] Roblox push error:', fetchErr.message);
      }
    }

    // 4. Log deploy
    const history = readDeployHistory();
    const entry = {
      deployId,
      timestamp: new Date().toISOString(),
      projectPath,
      scriptsDeployed: luaFiles.length,
      rbxlxPath,
      pushedToRoblox,
      universeId: targetUniverseId,
      placeId: ROBLOX_PLACE_ID,
      errors,
      success: errors.length === 0 || pushedToRoblox,
    };
    history.push(entry);
    writeDeployHistory(history);

    // 5. Respond
    return res.json({
      success: entry.success,
      deployId,
      rbxlxPath,
      pushedToRoblox,
      scriptsDeployed: luaFiles.length,
      errors,
    });
  } catch (err: any) {
    errors.push(err.message);
    const history = readDeployHistory();
    history.push({
      deployId,
      timestamp: new Date().toISOString(),
      projectPath,
      success: false,
      errors,
      rbxlxPath,
      pushedToRoblox,
    });
    writeDeployHistory(history);
    return res.status(500).json({ success: false, deployId, errors, rbxlxPath, pushedToRoblox });
  }
});

/**
 * GET /api/deploy/history
 * Return the last 10 deploy entries.
 */
app.get('/api/deploy/history', (req, res) => {
  const history = readDeployHistory();
  const last10 = history.slice(-10).reverse();
  res.json(last10);
});

// --- Wave 5.5: Scene Persistence Endpoints ---

app.post('/api/project/save', async (req, res) => {
  try {
    const { projectId, message } = req.body as { projectId: string; message: string };
    if (!projectId || !message) {
      return res.status(400).json({ error: 'projectId and message required' });
    }
    // Get current instances from game engine
    const allInsts = gameEngine.getAllInstances() as Array<{ id: string; ClassName: string; Name: string; properties: Record<string, unknown> }>;
    const SKIP_PROPS = new Set(['FindFirstChild','WaitForChild','GetChildren','GetDescendants','GetFullName','IsA','Destroy','Clone','_addChild']);
    const instances = allInsts.map(inst => ({
      id: inst.id,
      className: inst.ClassName,
      name: inst.Name,
      properties: Object.fromEntries(
        Object.entries(inst.properties).filter(([k, v]) => {
          if (SKIP_PROPS.has(k)) return false;
          if (typeof v === 'string' && v.startsWith('function:')) return false;
          return true;
        })
      ),
    }));
    const result = await scenePersistence.save(projectId, instances, message);
    res.json({ ...result, projectId, scenePath: `clawblox-projects/${projectId}/scene.json` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/project/load/:projectId', (req, res) => {
  const { projectId } = req.params;
  const snapshot = scenePersistence.load(projectId);
  if (!snapshot) {
    return res.status(404).json({ ok: false, error: 'No saved scene' });
  }
  res.json(snapshot);
});

app.get('/api/project/changelog/:projectId', (req, res) => {
  const { projectId } = req.params;
  const changelog = scenePersistence.getChangelog(projectId);
  res.json({ changelog });
});

app.get('/api/project/list', (req, res) => {
  const projects = scenePersistence.listProjects();
  res.json({ projects });
});

// ============================================================
// Wave 6: Scene Serializer (Option B) + rbxlx Importer (Option C)
// ============================================================

/**
 * Material token mapping: Roblox material enum values
 */
const MATERIAL_TOKENS: Record<string, number> = {
  SmoothPlastic: 256,
  Wood: 512,
  Grass: 1280,
  Stone: 816,
  Ground: 272,
  Sand: 1296,
  Neon: 1376,
  Metal: 1040,
  Brick: 784,
  Plastic: 256,
  WoodPlanks: 512,
  Slate: 800,
  Concrete: 816,
  Foil: 1312,
  Ice: 1536,
  Glass: 1568,
  CobbleStone: 788,
  Marble: 784,
  Granite: 832,
  Fabric: 1312,
  DiamondPlate: 1056,
  CorrodedMetal: 1072,
  Pebble: 1312,
};

const MATERIAL_TOKENS_REVERSE: Record<number, string> = Object.fromEntries(
  Object.entries(MATERIAL_TOKENS).map(([k, v]) => [v, k])
);

function buildRbxlxFromScene(registry: ReturnType<typeof gameEngine['getAllInstances']>): string {
  const instances: InstanceRecord[] = Array.isArray(registry) ? registry : (registry as any).getAll();

  // Build children map
  const childrenMap = new Map<string | null, InstanceRecord[]>();
  for (const inst of instances) {
    const key = inst.parentId ?? null;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(inst);
  }

  let refCounter = 0;
  const instToRef = new Map<string, string>();
  for (const inst of instances) {
    instToRef.set(inst.id, `RBX${String(++refCounter).padStart(8, '0')}`);
  }

  const escapeXml = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  function serializeVector3(v: any, fallback = { x: 1, y: 1, z: 1 }) {
    const x = v?.x ?? v?.X ?? fallback.x;
    const y = v?.y ?? v?.Y ?? fallback.y;
    const z = v?.z ?? v?.Z ?? fallback.z;
    return { x, y, z };
  }

  function serializeColor(c: any, fallback = { r: 163, g: 162, b: 165 }) {
    // Supports {r,g,b}, {R,G,B}, or Roblox Color3 (0-1 range floats)
    let r = c?.r ?? c?.R ?? fallback.r;
    let g = c?.g ?? c?.G ?? fallback.g;
    let b = c?.b ?? c?.B ?? fallback.b;
    // If values are 0-1 floats, scale to 0-255
    if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
      r = Math.round(r * 255);
      g = Math.round(g * 255);
      b = Math.round(b * 255);
    }
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  }

  function getCFrameXml(props: Record<string, any>): string {
    const cf = props['CFrame'] ?? props['cframe'];
    const pos = props['Position'] ?? props['position'] ?? props['pos'];
    let x = 0, y = 0, z = 0;
    let r00 = 1, r01 = 0, r02 = 0;
    let r10 = 0, r11 = 1, r12 = 0;
    let r20 = 0, r21 = 0, r22 = 1;

    if (cf) {
      x = cf.x ?? cf.X ?? cf.position?.x ?? 0;
      y = cf.y ?? cf.Y ?? cf.position?.y ?? 0;
      z = cf.z ?? cf.Z ?? cf.position?.z ?? 0;
      // Rotation matrix components
      r00 = cf.r00 ?? cf.R00 ?? 1; r01 = cf.r01 ?? cf.R01 ?? 0; r02 = cf.r02 ?? cf.R02 ?? 0;
      r10 = cf.r10 ?? cf.R10 ?? 0; r11 = cf.r11 ?? cf.R11 ?? 1; r12 = cf.r12 ?? cf.R12 ?? 0;
      r20 = cf.r20 ?? cf.R20 ?? 0; r21 = cf.r21 ?? cf.R21 ?? 0; r22 = cf.r22 ?? cf.R22 ?? 1;
    } else if (pos) {
      x = pos.x ?? pos.X ?? 0;
      y = pos.y ?? pos.Y ?? 0;
      z = pos.z ?? pos.Z ?? 0;
    }
    return `<CoordinateFrame name="CFrame">
          <X>${x}</X><Y>${y}</Y><Z>${z}</Z>
          <R00>${r00}</R00><R01>${r01}</R01><R02>${r02}</R02>
          <R10>${r10}</R10><R11>${r11}</R11><R12>${r12}</R12>
          <R20>${r20}</R20><R21>${r21}</R21><R22>${r22}</R22>
        </CoordinateFrame>`;
  }

  function buildItemXml(inst: InstanceRecord, indent: string): string {
    const ref = instToRef.get(inst.id) ?? inst.id;
    const props = inst.properties ?? {};
    const children = childrenMap.get(inst.id) ?? [];

    const propLines: string[] = [];

    // Name
    propLines.push(`<string name="Name">${escapeXml(inst.Name ?? inst.ClassName)}</string>`);

    // Per-class property serialization
    const isScript = ['Script', 'LocalScript', 'ModuleScript'].includes(inst.ClassName);
    const isPart = ['Part', 'BasePart', 'MeshPart', 'WedgePart', 'TrussPart', 'CornerWedgePart', 'SpawnLocation'].includes(inst.ClassName);

    if (isPart) {
      // Size / Vector3
      const size = props['Size'] ?? props['size'] ?? { x: 4, y: 1, z: 4 };
      const sv = serializeVector3(size);
      propLines.push(`<Vector3 name="size"><X>${sv.x}</X><Y>${sv.y}</Y><Z>${sv.z}</Z></Vector3>`);

      // CFrame / Position
      propLines.push(getCFrameXml(props));

      // Color
      const color = props['Color'] ?? props['Color3'] ?? props['BrickColor'] ?? props['color'];
      if (color) {
        const sc = serializeColor(color);
        propLines.push(`<Color3uint8 name="Color3"><R>${sc.r}</R><G>${sc.g}</G><B>${sc.b}</B></Color3uint8>`);
      } else {
        propLines.push(`<Color3uint8 name="Color3"><R>163</R><G>162</G><B>165</B></Color3uint8>`);
      }

      // Anchored
      const anchored = props['Anchored'] ?? props['anchored'] ?? true;
      propLines.push(`<bool name="Anchored">${anchored ? 'true' : 'false'}</bool>`);

      // Transparency
      const transparency = props['Transparency'] ?? props['transparency'] ?? 0;
      propLines.push(`<float name="Transparency">${transparency}</float>`);

      // Material
      const matRaw = props['Material'] ?? props['material'] ?? 'SmoothPlastic';
      let matToken: number;
      if (typeof matRaw === 'number') {
        matToken = matRaw;
      } else {
        matToken = MATERIAL_TOKENS[matRaw] ?? MATERIAL_TOKENS[String(matRaw)] ?? 256;
      }
      propLines.push(`<token name="Material">${matToken}</token>`);

      // CanCollide
      const canCollide = props['CanCollide'] ?? props['cancollide'] ?? true;
      propLines.push(`<bool name="CanCollide">${canCollide ? 'true' : 'false'}</bool>`);

      // CastShadow
      const castShadow = props['CastShadow'] ?? props['castshadow'] ?? true;
      propLines.push(`<bool name="CastShadow">${castShadow ? 'true' : 'false'}</bool>`);
    } else if (isScript) {
      const source = props['Source'] ?? props['source'] ?? '';
      const disabled = props['Disabled'] ?? props['disabled'] ?? false;
      propLines.push(`<ProtectedString name="Source"><![CDATA[${source}]]></ProtectedString>`);
      propLines.push(`<bool name="Disabled">${disabled ? 'true' : 'false'}</bool>`);
    } else if (inst.ClassName === 'Model') {
      // Models just need a name (already added above)
    } else {
      // Generic: serialize known typed props
      for (const [key, val] of Object.entries(props)) {
        if (key === 'Name') continue;
        if (typeof val === 'boolean') {
          propLines.push(`<bool name="${escapeXml(key)}">${val ? 'true' : 'false'}</bool>`);
        } else if (typeof val === 'number') {
          propLines.push(`<float name="${escapeXml(key)}">${val}</float>`);
        } else if (typeof val === 'string') {
          propLines.push(`<string name="${escapeXml(key)}">${escapeXml(val)}</string>`);
        }
      }
    }

    const propXml = propLines.map(l => `${indent}    ${l}`).join('\n');
    const childXml = children.map(c => buildItemXml(c, indent + '  ')).join('\n');

    return `${indent}<Item class="${escapeXml(inst.ClassName)}" referent="${ref}">
${indent}  <Properties>
${propXml}
${indent}  </Properties>
${childXml}
${indent}</Item>`;
  }

  // Build root items (parentId === null)
  const roots = childrenMap.get(null) ?? [];
  const rootXml = roots.map(r => buildItemXml(r, '    ')).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
  <External>null</External>
  <External>nil</External>
  <Item class="Workspace" referent="RBXWORKSPACE">
    <Properties>
      <string name="Name">Workspace</string>
    </Properties>
${rootXml}
  </Item>
</roblox>`;
}

/**
 * POST /api/deploy/scene
 * Serialize the live 3D scene (InstanceRegistry) to .rbxlx and optionally push to Roblox.
 * Body: { universeId?: string }
 */
app.post('/api/deploy/scene', async (req, res) => {
  const { universeId } = req.body ?? {};
  const deployId = `scene_${Date.now()}`;
  const errors: string[] = [];
  let pushedToRoblox = false;
  let rbxlxPath: string | null = null;

  try {
    const instances: InstanceRecord[] = gameEngine.getAllInstances() as InstanceRecord[];
    const instanceCount = instances.length;

    const rbxlxContent = buildRbxlxFromScene(instances);
    const outDir = path.join(__dirname, '../../deploy-output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    rbxlxPath = path.join(outDir, `${deployId}.rbxlx`);
    fs.writeFileSync(rbxlxPath, rbxlxContent, 'utf-8');
    console.log(`[DEPLOY/SCENE] Generated .rbxlx: ${rbxlxPath} (${instanceCount} instances)`);

    // Push to Roblox Open Cloud if universeId provided
    const targetUniverseId = universeId || ROBLOX_UNIVERSE_ID;
    if (targetUniverseId && ROBLOX_API_KEY) {
      try {
        const rbxlxBuffer = fs.readFileSync(rbxlxPath);
        const url = `https://apis.roblox.com/universes/v1/${targetUniverseId}/places/${ROBLOX_PLACE_ID}/versions?versionType=Published`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'x-api-key': ROBLOX_API_KEY, 'Content-Type': 'application/octet-stream' },
          body: rbxlxBuffer,
        });
        if (response.ok) {
          pushedToRoblox = true;
          console.log(`[DEPLOY/SCENE] Pushed to Roblox!`);
        } else {
          const errText = await response.text();
          errors.push(`Roblox API error ${response.status}: ${errText}`);
        }
      } catch (fetchErr: any) {
        errors.push(`Roblox push failed: ${fetchErr.message}`);
      }
    }

    return res.json({ success: true, rbxlxPath, instanceCount, pushedToRoblox, errors });
  } catch (err: any) {
    errors.push(err.message);
    return res.status(500).json({ success: false, rbxlxPath, instanceCount: 0, pushedToRoblox, errors });
  }
});

// ============================================================
// Option C: .rbxlx Importer
// ============================================================

/**
 * Parse a .rbxlx XML string into an array of InstanceRecord objects.
 * Handles nested <Item> elements with proper parentId relationships.
 */
async function parseRbxlx(xmlString: string): Promise<InstanceRecord[]> {
  const parsed = await parseStringPromise(xmlString, {
    explicitArray: true,
    explicitCharkey: false,
    attrkey: '$',
    charkey: '_',
  });

  const results: InstanceRecord[] = [];
  let counter = 0;

  function parseProperties(propsBlock: any): Record<string, any> {
    const out: Record<string, any> = {};
    if (!propsBlock) return out;

    const p = Array.isArray(propsBlock) ? propsBlock[0] : propsBlock;

    // string
    for (const el of p.string ?? []) {
      const name = el.$?.name;
      if (name) out[name] = el._ ?? el;
    }
    // bool
    for (const el of p.bool ?? []) {
      const name = el.$?.name;
      if (name) out[name] = String(el._ ?? el).trim() === 'true';
    }
    // float / double / int
    for (const el of [...(p.float ?? []), ...(p.double ?? []), ...(p.int ?? [])]) {
      const name = el.$?.name;
      if (name) out[name] = parseFloat(String(el._ ?? el).trim());
    }
    // token (material enum)
    for (const el of p.token ?? []) {
      const name = el.$?.name;
      if (name) {
        const val = parseInt(String(el._ ?? el).trim(), 10);
        out[name] = val;
        if (name === 'Material') out['MaterialName'] = MATERIAL_TOKENS_REVERSE[val] ?? 'SmoothPlastic';
      }
    }
    // Vector3
    for (const el of p.Vector3 ?? []) {
      const name = el.$?.name;
      if (name) {
        const x = parseFloat(String(el.X?.[0] ?? 0));
        const y = parseFloat(String(el.Y?.[0] ?? 0));
        const z = parseFloat(String(el.Z?.[0] ?? 0));
        out[name] = { x, y, z };
        if (name.toLowerCase() === 'size') out['Size'] = { x, y, z };
      }
    }
    // CoordinateFrame
    for (const el of p.CoordinateFrame ?? []) {
      const name = el.$?.name;
      if (name) {
        const x = parseFloat(String(el.X?.[0] ?? 0));
        const y = parseFloat(String(el.Y?.[0] ?? 0));
        const z = parseFloat(String(el.Z?.[0] ?? 0));
        const cf: Record<string, number> = {
          x, y, z,
          r00: parseFloat(String(el.R00?.[0] ?? 1)), r01: parseFloat(String(el.R01?.[0] ?? 0)), r02: parseFloat(String(el.R02?.[0] ?? 0)),
          r10: parseFloat(String(el.R10?.[0] ?? 0)), r11: parseFloat(String(el.R11?.[0] ?? 1)), r12: parseFloat(String(el.R12?.[0] ?? 0)),
          r20: parseFloat(String(el.R20?.[0] ?? 0)), r21: parseFloat(String(el.R21?.[0] ?? 0)), r22: parseFloat(String(el.R22?.[0] ?? 1)),
        };
        out[name] = cf;
        if (name === 'CFrame') out['Position'] = { x, y, z };
      }
    }
    // Color3uint8
    for (const el of p.Color3uint8 ?? []) {
      const name = el.$?.name;
      if (name) {
        out[name] = {
          r: parseInt(String(el.R?.[0] ?? 163), 10),
          g: parseInt(String(el.G?.[0] ?? 162), 10),
          b: parseInt(String(el.B?.[0] ?? 165), 10),
        };
      }
    }
    // ProtectedString (script source)
    for (const el of p.ProtectedString ?? []) {
      const name = el.$?.name;
      if (name) out[name] = el._ ?? String(el).trim();
    }

    return out;
  }

  function walkItems(items: any[], parentId: string | null) {
    if (!items) return;
    for (const item of items) {
      const className = item.$?.class ?? 'Unknown';
      const referent = item.$?.referent ?? `gen_${++counter}`;

      const props = parseProperties(item.Properties);
      const name = String(props['Name'] ?? className);
      delete props['Name'];

      const id = referent;
      const record: InstanceRecord = {
        id,
        Name: name,
        ClassName: className,
        parentId,
        properties: props,
      };
      results.push(record);

      // Recurse into children
      if (item.Item) {
        walkItems(item.Item, id);
      }
    }
  }

  // The root element is <roblox>; top-level Items are direct children
  const roblox = parsed.roblox ?? parsed;
  const topItems = roblox.Item ?? [];
  walkItems(topItems, null);

  return results;
}

/**
 * POST /api/import/rbxlx
 * Body: { rbxlxPath: string, merge?: boolean }
 * Loads a .rbxlx file into the game engine's InstanceRegistry.
 */
app.post('/api/import/rbxlx', async (req, res) => {
  const { rbxlxPath, merge = false } = req.body ?? {};
  if (!rbxlxPath) {
    return res.status(400).json({ success: false, error: 'rbxlxPath is required' });
  }

  const errors: string[] = [];
  try {
    if (!fs.existsSync(rbxlxPath)) {
      return res.status(404).json({ success: false, error: `File not found: ${rbxlxPath}` });
    }
    const xmlString = fs.readFileSync(rbxlxPath, 'utf-8');
    const instances = await parseRbxlx(xmlString);

    gameEngine.loadInstances(instances, Boolean(merge));

    console.log(`[IMPORT/RBXLX] Loaded ${instances.length} instances from ${rbxlxPath} (merge=${merge})`);
    return res.json({ success: true, instanceCount: instances.length, errors });
  } catch (err: any) {
    errors.push(err.message);
    return res.status(500).json({ success: false, instanceCount: 0, errors });
  }
});

/**
 * GET /api/import/rbxlx/preview
 * Query: ?path=...
 * Parses .rbxlx but does NOT load into engine. Returns instance tree summary.
 */
app.get('/api/import/rbxlx/preview', async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'path query param is required' });
  }

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: `File not found: ${filePath}` });
    }
    const xmlString = fs.readFileSync(filePath, 'utf-8');
    const instances = await parseRbxlx(xmlString);

    // Build tree summary
    const childrenMap = new Map<string | null, InstanceRecord[]>();
    for (const inst of instances) {
      const key = inst.parentId;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(inst);
    }

    function buildSummary(parentId: string | null, depth: number = 0): any[] {
      return (childrenMap.get(parentId) ?? []).map(inst => ({
        id: inst.id,
        Name: inst.Name,
        ClassName: inst.ClassName,
        childCount: (childrenMap.get(inst.id) ?? []).length,
        children: depth < 3 ? buildSummary(inst.id, depth + 1) : [],
      }));
    }

    return res.json({
      success: true,
      instanceCount: instances.length,
      tree: buildSummary(null),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// End Wave 6
// ============================================================

// ============================================================
// Wave A: Structured Observability Layer
// ============================================================

/**
 * GET /api/observe/state
 * Returns the complete workspace state as schema-validated JSON.
 *
 * Response shape:
 * {
 *   metadata: { timestamp, tick, seed, deterministic }
 *   instances: SerializedInstance[]
 *   physics: SerializedPhysicsBody[]
 *   dataStore: Record<string, Record<string, unknown>>
 *   players: { name, userId, health, position }[]
 * }
 */
app.get('/api/observe/state', (req, res) => {
  try {
    const raw = gameEngine.getObserveStateRaw();
    const state = buildObserveState(
      raw.instances,
      raw.physicsBodies,
      raw.dataStore,
      raw.players,
      raw.metadata,
    );
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/observe/screenshot
 * Returns a snapshot of the current 3D scene.
 *
 * In headless mode (no Electron display), returns a full state-json payload.
 * In Electron mode (if mainWindow is available), captures the page as PNG.
 *
 * Response shape (headless):
 * { format: "state-json", data: <observe state>, note: string }
 *
 * Response shape (Electron):
 * { format: "png", data: "base64..." }
 */
app.get('/api/observe/screenshot', async (req, res) => {
  try {
    // Attempt Electron capturePage if running inside Electron
    let electronCapture: string | null = null;
    try {
      // Dynamic import — only present when running inside Electron main process
      const electron = await import('electron');
      const { BrowserWindow } = electron;
      if (BrowserWindow) {
        const windows = BrowserWindow.getAllWindows();
        const mainWindow = windows.find(w => !w.isDestroyed()) ?? null;
        if (mainWindow) {
          const nativeImage = await mainWindow.webContents.capturePage();
          electronCapture = nativeImage.toPNG().toString('base64');
        }
      }
    } catch {
      // Not in Electron — headless mode
    }

    if (electronCapture) {
      return res.json({ format: 'png', data: electronCapture });
    }

    // Headless: return full state-json
    const raw = gameEngine.getObserveStateRaw();
    const state = buildObserveState(
      raw.instances,
      raw.physicsBodies,
      raw.dataStore,
      raw.players,
      raw.metadata,
    );
    return res.json({
      format: 'state-json',
      data: state,
      note: 'headless: use /api/observe/state for full scene data. GUI screenshot requires Electron display.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/observe/gui-json
 * Returns the current ScreenGui hierarchy as JSON.
 *
 * Walks the instance tree for GUI-relevant classes and returns them
 * as a flat array with id, className, name, parentId, and properties.
 *
 * Response shape:
 * { count: number, gui: SerializedInstance[] }
 */
app.get('/api/observe/gui-json', (req, res) => {
  try {
    const allInstances = gameEngine.getAllInstances();
    const guiInstances = extractGuiTree(allInstances);
    res.json({ count: guiInstances.length, gui: guiInstances });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// End Wave A
// ============================================================

// ============================================================
// Wave B: Simulation Endpoints
// ============================================================

/**
 * GET /api/simulation/export_trajectory
 * Returns JSONL (one JSON object per line) of all recorded frames since game start.
 * Frame shape: { tick, timestamp, seed, actions, physicsState, instanceChanges, consoleOutput }
 */
app.get('/api/simulation/export_trajectory', (req, res) => {
  try {
    const frames = getTrajectory();
    // JSONL: one JSON object per line
    const jsonl = frames.map(f => JSON.stringify(f)).join('\n');
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.send(jsonl || '');
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/simulation/replay
 * Accepts a trajectory JSONL (array of frames or raw JSONL string).
 * Replays each frame's Lua actions with the same seed and fixed timestep.
 * Returns { replayed: N, finalState: <observe/state output> }
 *
 * Body: { frames: TrajectoryFrame[] } OR raw JSONL text (Content-Type: application/x-ndjson)
 */
app.post('/api/simulation/replay', async (req, res) => {
  try {
    let frames: TrajectoryFrame[] = [];

    // Accept both JSON body { frames: [...] } and raw JSONL
    const ct = req.headers['content-type'] ?? '';
    if (ct.includes('ndjson') || ct.includes('x-ndjson') || ct.includes('text/plain')) {
      // Raw JSONL
      const raw = req.body as string;
      const lines = (typeof raw === 'string' ? raw : JSON.stringify(raw)).split('\n').filter(l => l.trim());
      frames = lines.map(l => JSON.parse(l) as TrajectoryFrame);
    } else if (Array.isArray(req.body)) {
      frames = req.body as TrajectoryFrame[];
    } else if (req.body && Array.isArray(req.body.frames)) {
      frames = req.body.frames as TrajectoryFrame[];
    } else {
      return res.status(400).json({ error: 'Provide frames as JSON array or JSONL body. Body: { frames: [...] } or raw JSONL.' });
    }

    if (frames.length === 0) {
      return res.status(400).json({ error: 'No frames provided' });
    }

    // Use seed from first frame (or fallback)
    const replaySeed = frames[0]?.seed ?? Math.floor(Math.random() * 2 ** 31);

    // Start a fresh deterministic game session
    await gameEngine.start({ deterministic: true, seed: replaySeed });

    let replayed = 0;
    for (const frame of frames) {
      const frameSeed = frame.seed ?? replaySeed;
      for (const action of (frame.actions ?? [])) {
        if (action && typeof action === 'string' && action.trim().length > 0) {
          await gameEngine.execute(action, { deterministic: true, seed: frameSeed });
        }
      }
      replayed++;
    }

    // Build final state
    const raw = gameEngine.getObserveStateRaw();
    const { buildObserveState } = await import('../services/observability.js');
    const finalState = buildObserveState(
      raw.instances,
      raw.physicsBodies,
      raw.dataStore,
      raw.players,
      raw.metadata,
    );

    res.json({ replayed, seed: replaySeed, finalState });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// End Wave B
// ============================================================

// ============================================================
// Wave C: Multi-Agent Session Orchestration
// ============================================================

/**
 * POST /api/session/create
 * Body (optional): { label?, seed?, deterministic? }
 * Returns { session_id, seed, label, createdAt }
 */
app.post('/api/session/create', async (req, res) => {
  try {
    const { label, seed, deterministic } = req.body ?? {};
    const result = sessionManager.createSession({
      label: label as string | undefined,
      seed: seed !== undefined ? Number(seed) : undefined,
      deterministic: Boolean(deterministic),
    });

    if ('code' in result) {
      return res.status(429).json({ error: result.error });
    }

    const session = result as Session;
    // Ensure engine is initialized before returning
    await sessionManager.ensureInit(session);

    return res.json({
      session_id: session.id,
      seed: session.seed,
      label: session.label ?? null,
      createdAt: session.createdAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/session/list
 * Returns [{ session_id, label, createdAt, running, instanceCount }]
 */
app.get('/api/session/list', (_req, res) => {
  try {
    res.json(sessionManager.listSessions());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/session/all
 * Destroys all sessions. Returns { destroyed: N }
 * Must be declared before /api/session/:id to avoid route shadowing.
 */
app.delete('/api/session/all', (_req, res) => {
  try {
    const destroyed = sessionManager.destroyAllSessions();
    res.json({ destroyed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/session/:id
 * Destroys a specific session. Returns { destroyed: true }
 */
app.delete('/api/session/:id', (req, res) => {
  const { id } = req.params;
  const ok = sessionManager.destroySession(id);
  if (!ok) return res.status(404).json({ error: 'Session not found' });
  res.json({ destroyed: true });
});

/**
 * GET /api/session/:id/state
 * Returns the observability state for this session's VM.
 */
app.get('/api/session/:id/state', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const state = session.engine.getObserveState();
    res.json({
      session_id: session.id,
      label: session.label,
      running: session.running,
      seed: session.seed,
      deterministic: session.deterministic,
      instanceCount: session.engine.getInstanceCount(),
      ...state,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/:id/execute
 * Body: { script: string }
 * Executes Lua code inside this session's VM.
 */
app.post('/api/session/:id/execute', async (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { script } = req.body ?? {};
  if (!script) return res.status(400).json({ error: 'script is required' });

  try {
    await sessionManager.ensureInit(session);
    const result = await session.engine.execute(script);
    res.json({ session_id: session.id, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/:id/reset
 * Clears VM, trajectory, messages — keeps same id/seed/label.
 */
app.post('/api/session/:id/reset', async (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    await sessionManager.resetSession(session);
    res.json({ session_id: session.id, reset: true, seed: session.seed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/:id/physics/reset-part
 * Teleport a specific Part to a position and zero its velocity.
 * Body: { instance_id: string, x: number, y: number, z: number }
 * Used by RL agents for clean episode resets without losing physics registration.
 */
app.post('/api/session/:id/physics/reset-part', async (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { instance_id, x = 0, y = 0, z = 0 } = req.body ?? {};
  if (!instance_id) return res.status(400).json({ error: 'instance_id is required' });

  try {
    await sessionManager.ensureInit(session);
    session.engine.resetPart(instance_id, { x: Number(x), y: Number(y), z: Number(z) });
    res.json({ ok: true, instance_id, position: { x, y, z } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/:id/start
 * Marks this session as running and (re)initializes the engine.
 */
app.post('/api/session/:id/start', async (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    await sessionManager.ensureInit(session);
    session.running = true;
    res.json({ session_id: session.id, running: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/session/:id/stop
 * Marks this session as stopped.
 */
app.post('/api/session/:id/stop', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.running = false;
  res.json({ session_id: session.id, running: false });
});

/**
 * GET /api/session/:id/messages
 * Returns the last 100 cross-session messages received by this session.
 */
app.get('/api/session/:id/messages', (req, res) => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session.messages);
});

// ============================================================
// Wave C: Cross-Session Messaging Bridge
// ============================================================

/**
 * POST /api/messaging/bridge
 * Body: { from_session, to_session, event, data }
 * Delivers event to target session's Lua VM and WS clients.
 * Returns { delivered: true, timestamp }
 */
app.post('/api/messaging/bridge', async (req, res) => {
  const { from_session, to_session, event, data } = req.body ?? {};

  if (!from_session || !to_session || !event) {
    return res.status(400).json({ error: 'from_session, to_session, and event are required' });
  }

  const target = sessionManager.getSession(String(to_session));
  if (!target) return res.status(404).json({ error: `Target session '${to_session}' not found` });

  try {
    await sessionManager.ensureInit(target);

    // Store message in queue
    const record = {
      from: String(from_session),
      event: String(event),
      data: data ?? null,
      timestamp: Date.now(),
    };
    sessionManager.enqueueMessage(target, record);

    // Deliver into Lua VM
    await target.engine.deliverMessageWithData(String(event), data ?? null);

    // Broadcast over the session's WS namespace
    sessionManager.broadcastToSession(String(to_session), 'session_message', JSON.stringify(record));

    res.json({ delivered: true, timestamp: record.timestamp });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// End Wave C
// ============================================================

// ============================================================
// Wave H: Advanced Debugging Endpoints
// ============================================================

// Helper: build structured error response
function structuredError(
  res: any,
  err: Error,
  status: number = 500,
  overrideType?: StructuredError['error_type'],
) {
  const payload = buildStructuredError(err, gameEngine, overrideType);
  return res.status(status).json(payload);
}

// Helper: build simple structured validation error
function validationError(res: any, message: string) {
  const raw = gameEngine.getObserveStateRaw();
  return res.status(400).json({
    error: true,
    error_type: 'ValidationError',
    message,
    traceback: '',
    context_snapshot: {
      tick: raw.metadata.tick,
      seed: raw.metadata.seed,
      instance_count: raw.instances.length,
    },
    timestamp: Date.now(),
  } satisfies StructuredError);
}

/**
 * POST /api/debug/breakpoint/set
 * Body: { line, file?, condition? }
 */
app.post('/api/debug/breakpoint/set', (req, res) => {
  const { line, file, condition } = req.body ?? {};
  if (typeof line !== 'number') {
    return validationError(res, 'line (number) is required');
  }
  const bp = debugSetBreakpoint(line, file, condition);
  res.json({ breakpoint_id: bp.id, line: bp.line, file: bp.file, condition: bp.condition });
});

/**
 * GET /api/debug/breakpoints
 */
app.get('/api/debug/breakpoints', (_req, res) => {
  res.json({ breakpoints: debugGetBreakpoints() });
});

/**
 * DELETE /api/debug/breakpoint/:id
 */
app.delete('/api/debug/breakpoint/:id', (req, res) => {
  const deleted = debugDeleteBreakpoint(req.params.id);
  if (!deleted) {
    const raw = gameEngine.getObserveStateRaw();
    return res.status(404).json({
      error: true,
      error_type: 'ValidationError',
      message: `Breakpoint ${req.params.id} not found`,
      traceback: '',
      context_snapshot: { tick: raw.metadata.tick, seed: raw.metadata.seed, instance_count: raw.instances.length },
      timestamp: Date.now(),
    });
  }
  res.json({ deleted: true, id: req.params.id });
});

/**
 * POST /api/debug/step
 * Steps one line forward when paused at a breakpoint.
 * Note: wasmoon does not expose native line-level debug hooks; this implementation
 * uses a JS-side simulation. Full native stepping requires debug.sethook integration.
 */
app.post('/api/debug/step', async (req, res) => {
  try {
    const state = await debugStep();
    if (state === null) {
      return res.json({
        stepped: false,
        message: 'Not currently paused at a breakpoint',
        line: 0,
        locals: {},
        stack: [],
      });
    }
    res.json({
      stepped: true,
      line: state.line,
      locals: state.locals,
      stack: state.stack,
    });
  } catch (err: any) {
    return structuredError(res, err);
  }
});

/**
 * POST /api/debug/continue
 * Resume execution from a breakpoint.
 */
app.post('/api/debug/continue', async (_req, res) => {
  await debugContinue();
  res.json({ resumed: true });
});

/**
 * GET /api/debug/locals
 * Get current local variables when paused.
 */
app.get('/api/debug/locals', (_req, res) => {
  const state = debugGetLocalsState();
  res.json({
    paused: state.paused,
    locals: state.locals,
    upvalues: state.upvalues,
    line: state.line,
    stack: state.stack,
  });
});

/**
 * POST /api/debug/hot-reload
 * Hot-reload a script in the active game session without restarting.
 * Body: { file, code }
 */
app.post('/api/debug/hot-reload', async (req, res) => {
  const { file, code } = req.body ?? {};
  if (!file || typeof file !== 'string') return validationError(res, 'file (string) is required');
  if (!code || typeof code !== 'string') return validationError(res, 'code (string) is required');

  try {
    const result = await gameEngine.hotReloadScript(file, code);
    res.json(result);
  } catch (err: any) {
    return structuredError(res, err);
  }
});

/**
 * POST /api/debug/profile/start
 * Start CPU profiling of Lua execution.
 */
app.post('/api/debug/profile/start', (_req, res) => {
  profilingStart();
  res.json({ profiling: true, started_at: Date.now() });
});

/**
 * POST /api/debug/profile/stop
 * Stop profiling and return aggregated stats.
 */
app.post('/api/debug/profile/stop', (_req, res) => {
  if (!isProfilingActive()) {
    return res.json({
      duration_ms: 0,
      calls: [],
      hottest: null,
      message: 'Profiling was not active',
    });
  }
  const data = profilingStop();
  res.json(data);
});

/**
 * POST /api/agent/interrupt
 * Forcefully interrupts and resets the Lua VM.
 * Body: { session_id? }
 */
app.post('/api/agent/interrupt', async (req, res) => {
  const { session_id } = req.body ?? {};
  const sid = session_id ?? 'global';

  try {
    // If session_id refers to a session manager session, reset that
    if (session_id) {
      const session = sessionManager.getSession(session_id);
      if (session) {
        await sessionManager.resetSession(session);
        broadcastStructuredEvent({
          event: 'console:structured',
          level: 'warn',
          message: 'Execution interrupted',
          traceback: null,
          tick: 0,
        });
        return res.json({ interrupted: true, session_id: sid });
      }
    }
    // Default: interrupt the global engine
    await gameEngine.interruptExecution();
    res.json({ interrupted: true, session_id: sid });
  } catch (err: any) {
    return structuredError(res, err);
  }
});

/**
 * POST /api/agent/inject_lua
 * Inject and execute Lua code into a running session without clearing state.
 * Body: { code, session_id? }
 */
app.post('/api/agent/inject_lua', async (req, res) => {
  const { code, session_id } = req.body ?? {};
  if (!code || typeof code !== 'string') return validationError(res, 'code (string) is required');

  try {
    // If session_id provided, inject into that session's engine
    if (session_id) {
      const session = sessionManager.getSession(session_id);
      if (!session) {
        const raw = gameEngine.getObserveStateRaw();
        return res.status(404).json({
          error: true,
          error_type: 'SessionNotFound',
          message: `Session '${session_id}' not found`,
          traceback: '',
          context_snapshot: { tick: raw.metadata.tick, seed: raw.metadata.seed, instance_count: raw.instances.length },
          timestamp: Date.now(),
        } satisfies StructuredError);
      }
      await sessionManager.ensureInit(session);
      const result = await session.engine.injectLua(code);
      return res.json({ ...result, session_id });
    }

    // Default: inject into global engine
    const result = await gameEngine.injectLua(code);
    res.json(result);
  } catch (err: any) {
    return structuredError(res, err);
  }
});

// ============================================================
// Wave H: Central Error Handler Middleware
// ============================================================
// Catches unhandled errors from all routes above
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[server] Unhandled error:', err?.message ?? err);
  const raw = (() => {
    try { return gameEngine.getObserveStateRaw(); } catch { return null; }
  })();
  const ctx = raw
    ? { tick: raw.metadata.tick, seed: raw.metadata.seed, instance_count: raw.instances.length }
    : { tick: 0, seed: 0, instance_count: 0 };

  const errObj = err instanceof Error ? err : new Error(String(err));
  const type = classifyLuaError(errObj);
  const msg = errObj.message ?? String(err);
  const tracebackMatch = msg.match(/stack traceback:[\s\S]*/);
  const traceback = tracebackMatch ? tracebackMatch[0] : '';

  res.status(500).json({
    error: true,
    error_type: type,
    message: tracebackMatch ? msg.replace(traceback, '').trim() : msg,
    traceback,
    context_snapshot: ctx,
    timestamp: Date.now(),
  } satisfies StructuredError);
});
// ============================================================
// End Wave H
// ============================================================

const httpServer = app.listen(PORT, () => {
  if (IS_HEADLESS) {
    const activeSessions = sessionManager.listSessions().length;
    const sessionStr = `${activeSessions}/${MAX_SESSIONS}`;
    console.log('╔══════════════════════════════════════╗');
    console.log('║  ClawBlox Studio v1.1 — Headless    ║');
    console.log(`║  API: http://localhost:${PORT}          ║`);
    console.log(`║  WS:  ws://localhost:${WS_PORT}          ║`);
    console.log(`║  Sessions: ${sessionStr.padEnd(26)}║`);
    console.log('╚══════════════════════════════════════╝');
  } else {
    console.log(`ClawBlox API running on http://localhost:${PORT}`);
  }
});

// ─── Graceful Shutdown (Wave G) ───────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  console.log(`\n[server] ${signal} received — Shutting down cleanly...`);

  // 1. Destroy all sessions
  try {
    const destroyed = sessionManager.destroyAllSessions();
    console.log(`[server] Destroyed ${destroyed} session(s)`);
  } catch (e) {
    console.error('[server] Error destroying sessions:', (e as Error).message);
  }

  // 2. Close WebSocket server
  wss.close((err) => {
    if (err) console.error('[server] WS close error:', err.message);
    else console.log('[server] WebSocket server closed');

    // 3. Close HTTP server
    httpServer.close((err2) => {
      if (err2) console.error('[server] HTTP close error:', err2.message);
      else console.log('[server] HTTP server closed');
      process.exit(0);
    });

    // Force exit after 5s if something hangs
    setTimeout(() => {
      console.error('[server] Force exit after timeout');
      process.exit(1);
    }, 5000).unref();
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
