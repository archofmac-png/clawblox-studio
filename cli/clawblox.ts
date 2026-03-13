#!/usr/bin/env node
/**
 * clawblox CLI — Wave G
 * Controls ClawBlox Studio API server and Lua execution from the command line.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

const program = new Command();

// ─── Helpers ────────────────────────────────────────────────────────────────

function apiRequest(
  method: string,
  urlPath: string,
  body: unknown,
  host: string,
  port: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: host,
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const lib = port === 443 ? https : http;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function prettyPrint(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

function getHostPort(opts: { host?: string; port?: string | number }): { host: string; port: number } {
  return {
    host: opts.host ?? 'localhost',
    port: Number(opts.port ?? 3001),
  };
}

// ─── Global Options ──────────────────────────────────────────────────────────

program
  .name('clawblox')
  .description('ClawBlox Studio CLI — control the headless API server')
  .version('1.1.0')
  .option('--host <host>', 'API host', 'localhost')
  .option('--port <port>', 'API port', '3001')
  .option('--headless', 'Force headless mode (no Electron)')
  .option('--sessions <n>', 'Max concurrent sessions', '64')
  .option('--seed <n>', 'RNG seed for deterministic mode')
  .option('--deterministic', 'Enable deterministic mode');

// ─── run ─────────────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Start the API server (headless)')
  .option('--sessions <n>', 'Max concurrent sessions', '64')
  .option('--seed <n>', 'RNG seed for deterministic mode')
  .option('--port <port>', 'Port to bind on', '3001')
  .action((opts) => {
    const port = Number(opts.port ?? 3001);
    const sessions = Number(opts.sessions ?? 64);
    const seed = opts.seed !== undefined ? Number(opts.seed) : undefined;
    const deterministic = seed !== undefined;

    // Set env vars that server.ts reads
    process.env.PORT = String(port);
    process.env.MAX_SESSIONS = String(sessions);
    if (seed !== undefined) {
      process.env.DEFAULT_SEED = String(seed);
      process.env.DETERMINISTIC_DEFAULT = 'true';
    }
    if (deterministic) process.env.DETERMINISTIC_DEFAULT = 'true';

    console.log(`[clawblox] Starting headless API server on port ${port}...`);
    console.log(`[clawblox] Max sessions: ${sessions}`);
    if (seed !== undefined) console.log(`[clawblox] Default seed: ${seed}`);

    // Spawn server process
    const { spawn } = require('child_process') as typeof import('child_process');
    const serverPath = path.resolve(__dirname, '../dist/api/server.js');
    const tsServerPath = path.resolve(__dirname, '../src/api/server.ts');

    let serverProc: ReturnType<typeof spawn>;

    if (fs.existsSync(serverPath)) {
      serverProc = spawn('node', [serverPath], {
        stdio: 'inherit',
        env: { ...process.env },
      });
    } else if (fs.existsSync(tsServerPath)) {
      serverProc = spawn('npx', ['tsx', tsServerPath], {
        stdio: 'inherit',
        env: { ...process.env },
      });
    } else {
      console.error('[clawblox] Cannot find server entry point. Run `npm run build:api` first.');
      process.exit(1);
    }

    serverProc.on('exit', (code: number | null) => {
      process.exit(code ?? 0);
    });
  });

// ─── status ──────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show server status and running sessions')
  .action(async (_opts, cmd) => {
    const parent = cmd.parent ?? program;
    const { host, port } = getHostPort(parent.opts());

    try {
      const health = (await apiRequest('GET', '/api/health', null, host, port)) as Record<string, unknown>;
      const sessions = (await apiRequest('GET', '/api/session/list', null, host, port)) as unknown[];

      console.log('\n╔══════════════════════════════════════╗');
      console.log('║       ClawBlox Studio — Status       ║');
      console.log('╚══════════════════════════════════════╝');
      console.log(`  Status:     ${health.status ?? 'unknown'}`);
      console.log(`  Version:    ${health.version ?? 'unknown'}`);
      console.log(`  Mode:       ${health.mode ?? 'unknown'}`);
      console.log(`  Uptime:     ${health.uptime_s ?? '?'}s`);

      const sessInfo = health.sessions as { active?: number; max?: number } | undefined;
      if (sessInfo) {
        console.log(`  Sessions:   ${sessInfo.active ?? 0}/${sessInfo.max ?? 64}`);
      }

      if (Array.isArray(sessions) && sessions.length > 0) {
        console.log('\n  Running Sessions:');
        for (const s of sessions) {
          const sess = s as { session_id?: string; label?: string; running?: boolean; instanceCount?: number };
          console.log(
            `    • ${sess.session_id ?? '?'} ${sess.label ? `(${sess.label})` : ''} — running=${sess.running}, instances=${sess.instanceCount ?? 0}`,
          );
        }
      } else {
        console.log('  Sessions:   (none active)');
      }
      console.log('');
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[clawblox] Cannot connect to API at ${host}:${port}`);
      console.error(`  ${error.message}`);
      process.exit(1);
    }
  });

// ─── execute ─────────────────────────────────────────────────────────────────

program
  .command('execute [file]')
  .description('Execute a Lua file or inline code against the API')
  .option('-e, --eval <code>', 'Inline Lua code to execute')
  .option('--session <id>', 'Session ID to execute within')
  .option('--deterministic', 'Enable deterministic mode')
  .option('--seed <n>', 'RNG seed')
  .option('--output <format>', 'Output format: json|pretty', 'pretty')
  .action(async (file, opts, cmd) => {
    const parent = cmd.parent ?? program;
    const { host, port } = getHostPort(parent.opts());

    let script: string;
    if (opts.eval) {
      script = opts.eval;
    } else if (file) {
      const resolved = path.resolve(file);
      if (!fs.existsSync(resolved)) {
        console.error(`[clawblox] File not found: ${resolved}`);
        process.exit(1);
      }
      script = fs.readFileSync(resolved, 'utf-8');
    } else {
      console.error('[clawblox] Provide a file path or use -e "lua code"');
      process.exit(1);
    }

    const deterministic = opts.deterministic || parent.opts().deterministic;
    const seed = opts.seed ?? parent.opts().seed;
    const body: Record<string, unknown> = { script };
    if (deterministic) body.deterministic = true;
    if (seed !== undefined) body.seed = Number(seed);

    try {
      let urlPath: string;
      if (opts.session) {
        urlPath = `/api/session/${opts.session}/execute`;
      } else {
        urlPath = '/api/game/execute';
      }

      const result = await apiRequest('POST', urlPath, body, host, port);

      if (opts.output === 'json') {
        console.log(JSON.stringify(result));
      } else {
        prettyPrint(result);
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[clawblox] Execute failed: ${error.message}`);
      process.exit(1);
    }
  });

// ─── test ────────────────────────────────────────────────────────────────────

program
  .command('test <fileOrDir>')
  .description('Run .clawtest.lua test files against the API')
  .option('--batch', 'Run all .clawtest.lua files in a directory')
  .option('--parallel', 'Run tests in parallel (with --batch)')
  .option('--output <format>', 'Output format: json|pretty', 'pretty')
  .option('--deterministic', 'Enable deterministic mode')
  .option('--seed <n>', 'RNG seed')
  .action(async (fileOrDir, opts, cmd) => {
    const parent = cmd.parent ?? program;
    const { host, port } = getHostPort(parent.opts());

    const deterministic = opts.deterministic || parent.opts().deterministic;
    const seed = opts.seed ?? parent.opts().seed;

    if (opts.batch) {
      // Batch mode — run all .clawtest.lua files in the directory
      const dir = path.resolve(fileOrDir);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        console.error(`[clawblox] Directory not found: ${dir}`);
        process.exit(1);
      }

      const testFiles: string[] = [];
      function walkDir(d: string) {
        for (const f of fs.readdirSync(d)) {
          const full = path.join(d, f);
          if (fs.statSync(full).isDirectory()) walkDir(full);
          else if (f.endsWith('.clawtest.lua')) testFiles.push(full);
        }
      }
      walkDir(dir);

      if (testFiles.length === 0) {
        console.error(`[clawblox] No .clawtest.lua files found in ${dir}`);
        process.exit(1);
      }

      console.log(`[clawblox] Found ${testFiles.length} test file(s)`);

      const tests = testFiles.map((f) => ({
        code: fs.readFileSync(f, 'utf-8'),
        label: path.relative(dir, f),
      }));

      const body: Record<string, unknown> = {
        tests,
        parallel: opts.parallel ?? false,
      };
      if (deterministic) body.deterministic = true;
      if (seed !== undefined) body.seed = Number(seed);

      try {
        const result = (await apiRequest('POST', '/api/test/run_batch', body, host, port)) as Record<
          string,
          unknown
        >;

        if (opts.output === 'json') {
          console.log(JSON.stringify(result));
        } else {
          const batchRes = result as {
            total?: number;
            passed?: number;
            failed?: number;
            duration_ms?: number;
            results?: Array<{ label: string; passed: boolean; duration_ms: number }>;
          };
          console.log(`\n[clawblox] Batch Results:`);
          console.log(`  Total:    ${batchRes.total ?? 0}`);
          console.log(`  Passed:   ${batchRes.passed ?? 0}`);
          console.log(`  Failed:   ${batchRes.failed ?? 0}`);
          console.log(`  Duration: ${batchRes.duration_ms ?? 0}ms\n`);
          for (const r of batchRes.results ?? []) {
            const icon = r.passed ? '✓' : '✗';
            console.log(`  ${icon} ${r.label} (${r.duration_ms}ms)`);
          }
          console.log('');
        }

        const failed = (result as { failed?: number }).failed ?? 0;
        process.exit(failed > 0 ? 1 : 0);
      } catch (err: unknown) {
        const error = err as Error;
        console.error(`[clawblox] Test batch failed: ${error.message}`);
        process.exit(1);
      }
    } else {
      // Single file mode
      const filePath = path.resolve(fileOrDir);
      if (!fs.existsSync(filePath)) {
        console.error(`[clawblox] File not found: ${filePath}`);
        process.exit(1);
      }

      const code = fs.readFileSync(filePath, 'utf-8');
      const body: Record<string, unknown> = { code, filePath };
      if (deterministic) body.deterministic = true;
      if (seed !== undefined) body.seed = Number(seed);

      try {
        const result = (await apiRequest('POST', '/api/test/run', body, host, port)) as Record<
          string,
          unknown
        >;

        if (opts.output === 'json') {
          console.log(JSON.stringify(result));
        } else {
          const r = result as {
            file?: string;
            passed?: number;
            failed?: number;
            duration?: number;
            results?: Array<{ name: string; pass: boolean; message?: string; duration_ms?: number }>;
          };
          console.log(`\n[clawblox] Test Results: ${r.file ?? filePath}`);
          console.log(`  Passed: ${r.passed ?? 0}  Failed: ${r.failed ?? 0}  (${r.duration ?? 0}ms)\n`);
          for (const t of r.results ?? []) {
            const icon = t.pass ? '✓' : '✗';
            console.log(`  ${icon} ${t.name}${t.message ? ` — ${t.message}` : ''}`);
          }
          console.log('');
        }

        const failed = (result as { failed?: number }).failed ?? 0;
        process.exit(failed > 0 ? 1 : 0);
      } catch (err: unknown) {
        const error = err as Error;
        console.error(`[clawblox] Test run failed: ${error.message}`);
        process.exit(1);
      }
    }
  });

// ─── session ─────────────────────────────────────────────────────────────────

const sessionCmd = program.command('session').description('Manage sessions');

sessionCmd
  .command('list')
  .description('List all active sessions')
  .action(async (_opts, cmd) => {
    const parent = cmd.parent?.parent ?? program;
    const { host, port } = getHostPort(parent.opts());

    try {
      const sessions = (await apiRequest('GET', '/api/session/list', null, host, port)) as unknown[];
      if (!Array.isArray(sessions) || sessions.length === 0) {
        console.log('[clawblox] No active sessions.');
        return;
      }
      console.log(`\n[clawblox] Active Sessions (${sessions.length}):`);
      for (const s of sessions) {
        const sess = s as { session_id?: string; label?: string; running?: boolean; instanceCount?: number; seed?: number };
        console.log(
          `  • ${sess.session_id} ${sess.label ? `[${sess.label}]` : ''} — running=${sess.running}, instances=${sess.instanceCount ?? 0}, seed=${sess.seed ?? 'n/a'}`,
        );
      }
      console.log('');
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[clawblox] Failed: ${error.message}`);
      process.exit(1);
    }
  });

sessionCmd
  .command('create')
  .description('Create a new session')
  .option('--label <name>', 'Session label')
  .option('--deterministic', 'Enable deterministic mode')
  .option('--seed <n>', 'RNG seed')
  .action(async (opts, cmd) => {
    const parent = cmd.parent?.parent ?? program;
    const { host, port } = getHostPort(parent.opts());

    const body: Record<string, unknown> = {};
    if (opts.label) body.label = opts.label;
    if (opts.deterministic) body.deterministic = true;
    if (opts.seed !== undefined) body.seed = Number(opts.seed);

    try {
      const result = await apiRequest('POST', '/api/session/create', body, host, port);
      prettyPrint(result);
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[clawblox] Failed: ${error.message}`);
      process.exit(1);
    }
  });

sessionCmd
  .command('destroy <id>')
  .description('Destroy a session by ID')
  .action(async (id, _opts, cmd) => {
    const parent = cmd.parent?.parent ?? program;
    const { host, port } = getHostPort(parent.opts());

    try {
      const result = await apiRequest('DELETE', `/api/session/${id}`, null, host, port);
      prettyPrint(result);
    } catch (err: unknown) {
      const error = err as Error;
      console.error(`[clawblox] Failed: ${error.message}`);
      process.exit(1);
    }
  });

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse(process.argv);
