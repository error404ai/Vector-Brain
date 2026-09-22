// Vector Brain test harness.
//
// Boots the real backend against a throwaway MySQL database with
// AGENT_SIMULATION=1 (runs perform real device actions over the socket but skip
// the AI model), connects fake phones that speak the companion protocol, and
// checks the orchestration behaviours that kept breaking in production:
// leases, shutdown, proxy lanes, Stop All, dropped and hung phones.
//
//   node test/harness/run.mjs            # all scenarios
//   node test/harness/run.mjs lane stop  # only scenarios whose name matches
//
// Needs a local MySQL/MariaDB reachable with the credentials in .env.harness
// and a built backend (pnpm run build).

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { FakePhone } from './fake-phone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(here, '.env.harness'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
// CI supplies its own database; everything else stays as the file says.
for (const key of ['MYSQLHOST', 'MYSQLPORT', 'MYSQLUSERNAME', 'MYSQLPASSWORD', 'DATABASE']) {
  if (process.env[key]) env[key] = process.env[key];
}
const BASE = `http://127.0.0.1:${env.PORT}`;
const WS = `ws://127.0.0.1:${env.PORT}/ws/android`;
const logDir = path.join(here, '.logs');
fs.mkdirSync(logDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

// ---------------------------------------------------------------- database
let db;
async function resetDatabase() {
  const admin = await mysql.createConnection({
    host: env.MYSQLHOST,
    port: Number(env.MYSQLPORT),
    user: env.MYSQLUSERNAME,
    password: env.MYSQLPASSWORD,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${env.DATABASE}\``);
  await admin.query(`CREATE DATABASE \`${env.DATABASE}\` CHARACTER SET utf8mb4`);
  await admin.end();
  await runNode(['--import', './scripts/ts-node-loader.mjs', './node_modules/typeorm/cli.js', 'migration:run', '--dataSource', 'src/loaders/database.ts'], 'migrate');
  db = await mysql.createConnection({
    host: env.MYSQLHOST,
    port: Number(env.MYSQLPORT),
    user: env.MYSQLUSERNAME,
    password: env.MYSQLPASSWORD,
    database: env.DATABASE,
  });
}

function runNode(args, label) {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(path.join(logDir, `${label}.log`), 'w');
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', out, out] });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with ${code} (see .logs/${label}.log)`))));
  });
}

// ---------------------------------------------------------------- backend
let backend = null;
let backendRuns = 0;
async function startBackend() {
  backendRuns += 1;
  const out = fs.openSync(path.join(logDir, `backend-${backendRuns}.log`), 'w');
  backend = spawn(process.execPath, ['dist/app.js'], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', out, out] });
  const started = Date.now();
  while (Date.now() - started < 40_000) {
    if (backend.exitCode !== null) throw new Error(`backend exited during boot (see .logs/backend-${backendRuns}.log)`);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error('backend did not become healthy in 40s');
}

function stopBackend(signal = 'SIGTERM') {
  return new Promise((resolve) => {
    if (!backend || backend.exitCode !== null) return resolve({ ms: 0 });
    const started = Date.now();
    backend.once('exit', () => resolve({ ms: Date.now() - started }));
    backend.kill(signal);
  });
}

// ---------------------------------------------------------------- fixtures
let userToken;
let userId;
async function api(method, url, body) {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

// Rotation endpoint a proxy lane calls after each task. Records every call.
const rotation = { calls: [], mode: 'ok' };
const rotationServer = http.createServer((req, res) => {
  rotation.calls.push(Date.now());
  if (rotation.mode === '429') {
    res.writeHead(429);
    return res.end('slow down');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ip: `10.0.0.${rotation.calls.length}` }));
});

const phones = {}; // name -> { phone, dbId, hw }
async function seed() {
  const [user] = await db.query(
    "INSERT INTO users (name, email, password, isActive, role) VALUES ('Harness', 'harness@test.local', 'x', 1, 'user')",
  );
  userId = user.insertId;
  userToken = jwt.sign({ userId, email: 'harness@test.local', role: 'user' }, env.JWT_SECRET, { expiresIn: '2h' });

  await api('POST', '/ai-configs/create', {
    provider: 'openai',
    model: 'gpt-4o-mini',
    api_key: 'sk-harness-not-real',
    is_active: true,
  });

  const names = ['free1', 'free2', 'lane1', 'lane2', 'lane3', 'lane4', 'lane5'];
  for (const name of names) {
    const hw = `harness_${name}`;
    const token = jwt.sign({ deviceId: hw, userId, type: 'android_companion' }, env.JWT_SECRET, { expiresIn: '2h' });
    const [row] = await db.query(
      `INSERT INTO android_devices (user_id, device_id, device_name, device_model, status, device_token, capabilities)
       VALUES (?, ?, ?, 'FakePhone', 'OFFLINE', ?, ?)`,
      [userId, hw, name, token, JSON.stringify({ accessibility: true, screenCapture: true })],
    );
    phones[name] = { dbId: row.insertId, hw, phone: new FakePhone({ wsUrl: WS, token, deviceId: hw }) };
  }

  const proxy = await api('POST', '/device-proxy', {
    name: 'LaneA',
    rotation_url: 'http://127.0.0.1:4700/rotate',
    concurrency: 1,
    settle_seconds: 1,
    rotate_every_tasks: 1,
  });
  const proxyId = proxy?.data?.id ?? proxy?.id;
  // Harness rotates fast; production keeps the 60s provider gap.
  await db.query('UPDATE device_proxies SET min_rotation_gap_seconds = 0');
  for (const name of names.filter((n) => n.startsWith('lane'))) {
    await api('POST', '/device-proxy/assign', { device_id: phones[name].dbId, proxy_id: proxyId });
  }
}

async function connectPhones() {
  for (const entry of Object.values(phones)) {
    entry.phone.silent = false;
    entry.phone.failActions = false;
    await entry.phone.connect();
  }
}

// ---------------------------------------------------------------- helpers
const run = (name, prompt) => api('POST', '/android/agent/run', { device_id: phones[name].dbId, prompt, max_steps: 100 });

async function tasksSince(t0, names) {
  const ids = names.map((n) => phones[n].dbId);
  const [rows] = await db.query(
    'SELECT id, device_id, status, reason_code, message FROM agent_tasks WHERE created_at >= ? AND device_id IN (?) ORDER BY id',
    [new Date(t0 - 1000), ids],
  );
  return rows;
}

async function waitFor(check, timeoutMs, stepMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(stepMs);
  }
  return null;
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

// ---------------------------------------------------------------- scenarios
const scenarios = [
  {
    name: 'basic run finishes as SUCCEEDED',
    async run() {
      const t0 = Date.now();
      await run('free1', 'open chrome and go to google [sim steps=3 delay=200]');
      const done = await waitFor(async () => {
        const [task] = await tasksSince(t0, ['free1']);
        return task && TERMINAL.has(task.status) ? task : null;
      }, 30_000);
      if (!done) return 'task never finished';
      if (done.status !== 'SUCCEEDED') return `status ${done.status} (${done.reason_code})`;
    },
  },
  {
    name: 'lane with concurrency 1 never runs two at once',
    async run() {
      const lane = ['lane1', 'lane2', 'lane3', 'lane4', 'lane5'];
      const t0 = Date.now();
      const rotationsBefore = rotation.calls.length;
      const responses = await Promise.all(lane.map((n) => run(n, 'open chrome and search news [sim steps=3 delay=300]')));
      const queued = responses.filter((r) => r?.data?.queued).length;
      let maxRunning = 0;
      const all = await waitFor(async () => {
        const rows = await tasksSince(t0, lane);
        maxRunning = Math.max(maxRunning, rows.filter((r) => r.status === 'RUNNING').length);
        return rows.length === 5 && rows.every((r) => TERMINAL.has(r.status)) ? rows : null;
      }, 120_000, 100);
      if (!all) return `not all 5 finished (max running seen ${maxRunning})`;
      if (maxRunning > 1) return `${maxRunning} ran at once on a concurrency-1 lane`;
      if (queued !== 4) return `expected 4 queued at dispatch, got ${queued}`;
      const bad = all.filter((r) => r.status !== 'SUCCEEDED');
      if (bad.length) return `${bad.length} did not succeed: ${bad.map((b) => `${b.status}/${b.reason_code}`).join(', ')}`;
      if (rotation.calls.length - rotationsBefore < 5) return `only ${rotation.calls.length - rotationsBefore} rotations for 5 runs`;
    },
  },
  {
    name: 'Stop All stops the running task and starts nothing from the queue',
    async run() {
      const lane = ['lane1', 'lane2', 'lane3', 'lane4', 'lane5'];
      const t0 = Date.now();
      await Promise.all(lane.map((n) => run(n, 'open chrome and read the news [sim steps=30 delay=400]')));
      const running = await waitFor(async () => (await tasksSince(t0, lane)).find((r) => r.status === 'RUNNING'), 20_000);
      if (!running) return 'nothing started';
      // Same order as the dashboard's Stop All: empty the queue, then cancel.
      await api('DELETE', '/device-proxy/queue/all');
      await api('POST', `/android/agent/cancel/${running.id}`);
      await sleep(8_000);
      const rows = await tasksSince(t0, lane);
      if (rows.length !== 1) return `${rows.length - 1} queued task(s) started after Stop All`;
      if (rows[0].status !== 'CANCELLED') return `stopped task is ${rows[0].status}`;
      const [[{ left }]] = await db.query('SELECT COUNT(*) AS `left` FROM queued_tasks WHERE user_id = ?', [userId]).catch(() => [[{ left: 0 }]]);
      if (Number(left) > 0) return `${left} entries still in the queue`;
    },
  },
  {
    name: 'lane stays closed while the proxy refuses to rotate',
    async run() {
      const t0 = Date.now();
      rotation.mode = '429';
      try {
        await run('lane1', 'open chrome [sim steps=2 delay=200]');
        await run('lane2', 'open chrome [sim steps=2 delay=200]');
        // First one runs and finishes; its rotation then fails with 429.
        const first = await waitFor(async () => {
          const rows = await tasksSince(t0, ['lane1']);
          return rows.length && TERMINAL.has(rows[0].status) ? rows[0] : null;
        }, 30_000);
        if (!first) return 'first task never finished';
        const callsAfterFirst = rotation.calls.length;

        // The second phone shares that IP, so it must not start on the old one.
        await sleep(10_000);
        const started = await tasksSince(t0, ['lane2']);
        if (started.length > 0) return 'second phone started on an un-rotated IP';
        if (rotation.calls.length <= callsAfterFirst) return 'rotation was never retried';

        // Provider recovers — the lane should open again on its own.
        rotation.mode = 'ok';
        const second = await waitFor(async () => {
          const rows = await tasksSince(t0, ['lane2']);
          return rows.length && TERMINAL.has(rows[0].status) ? rows[0] : null;
        }, 90_000, 500);
        if (!second) return 'lane never recovered after the provider came back';
        if (second.status !== 'SUCCEEDED') return `recovered run ended as ${second.status}/${second.reason_code}`;
      } finally {
        rotation.mode = 'ok';
      }
    },
  },
  {
    name: 'a run recorded in the database holds the lane (survives a restart)',
    async run() {
      const t0 = Date.now();
      // Stands in for a run owned by another process — exactly what exists
      // during a deploy, when old and new containers overlap.
      const [ghost] = await db.query(
        `INSERT INTO agent_tasks (user_id, device_id, prompt, success, status, started_at, lease_until, total_steps, total_duration_seconds)
         VALUES (?, ?, 'ghost run from another process', 0, 'RUNNING', NOW(), DATE_ADD(NOW(), INTERVAL 60 SECOND), 0, 0)`,
        [userId, phones.lane3.dbId],
      );
      try {
        const response = await run('lane4', 'open chrome [sim steps=2 delay=200]');
        if (!response?.data?.queued) return 'started while another run held the lane';
        const started = await waitFor(async () => {
          const rows = await tasksSince(t0, ['lane4']);
          return rows.length ? rows[0] : null;
        }, 8_000);
        if (started) return 'queued task started anyway while the lane was held';
      } finally {
        await db.query("UPDATE agent_tasks SET status = 'CANCELLED', lease_until = NULL WHERE id = ?", [ghost.insertId]);
        await db.query('DELETE FROM queued_tasks WHERE user_id = ?', [userId]);
      }
    },
  },
  {
    name: 'fleet state reports what the database actually says',
    async run() {
      const state = async () => (await api('GET', '/android/devices/fleet-state')).data;
      const of = (snapshot, name) => snapshot.devices.find((d) => d.id === phones[name].dbId);

      // A phone that never connected reads offline, not "ready".
      await db.query("UPDATE android_devices SET status = 'OFFLINE' WHERE id = ?", [phones.lane5.dbId]);
      // Connected but with accessibility off must not read ready either.
      await db.query(
        `UPDATE android_devices SET capabilities = '{"accessibility": false, "screenCapture": true}' WHERE id = ?`,
        [phones.free2.dbId],
      );

      const t0 = Date.now();
      await run('free1', 'open chrome [sim steps=30 delay=400]');
      await waitFor(async () => (await tasksSince(t0, ['free1'])).some((r) => r.status === 'RUNNING'), 15_000);

      let snapshot = await state();
      if (of(snapshot, 'free1').state !== 'running') return `running phone read as ${of(snapshot, 'free1').state}`;
      if (of(snapshot, 'lane5').state !== 'offline') return `offline phone read as ${of(snapshot, 'lane5').state}`;
      if (of(snapshot, 'free2').state !== 'needs_setup') return `accessibility-off phone read as ${of(snapshot, 'free2').state}`;
      if (snapshot.counts.running < 1) return 'counts do not include the running phone';

      // Stopping it must be visible in the same snapshot, with its reason.
      const runningTask = (await tasksSince(t0, ['free1'])).find((r) => r.status === 'RUNNING');
      await api('POST', `/android/agent/cancel/${runningTask.id}`);
      const cancelled = await waitFor(async () => {
        const next = await state();
        return of(next, 'free1').state === 'cancelled' ? next : null;
      }, 20_000, 500);
      if (!cancelled) return 'cancelled run never showed up in the fleet state';
      if (of(cancelled, 'free1').task?.reason_code !== 'USER_CANCELLED') {
        return `reason came back as ${of(cancelled, 'free1').task?.reason_code}`;
      }

      await db.query("UPDATE android_devices SET status = 'ONLINE' WHERE id = ?", [phones.lane5.dbId]);
      await db.query(
        `UPDATE android_devices SET capabilities = '{"accessibility": true, "screenCapture": true}' WHERE id = ?`,
        [phones.free2.dbId],
      );
    },
  },
  {
    name: 'a phone stuck on "in progress" is told to stand down',
    async run() {
      const phone = phones.free1.phone;
      phone.otherEvents.length = 0;
      // Nothing is running for this device, but the phone believes otherwise —
      // exactly what a companion looks like after the server restarted under it.
      phone.automationActive = true;
      phone.sendHeartbeat();

      const told = await waitFor(
        async () =>
          phone.otherEvents.find(
            (event) => event.event === 'server:automation_session' && event.payload?.active === false,
          ),
        15_000,
        250,
      );
      phone.automationActive = false;
      if (!told) return 'server never told the phone to stop';

      // And it must not do that to a phone that really is running.
      const t0 = Date.now();
      await run('free2', 'open chrome [sim steps=20 delay=400]');
      const running = await waitFor(async () => (await tasksSince(t0, ['free2'])).find((r) => r.status === 'RUNNING'), 15_000);
      if (!running) return 'second phone never started';
      const busy = phones.free2.phone;
      busy.otherEvents.length = 0;
      busy.automationActive = true;
      busy.sendHeartbeat();
      await sleep(3_000);
      const wrongly = busy.otherEvents.find(
        (event) => event.event === 'server:automation_session' && event.payload?.active === false,
      );
      busy.automationActive = false;
      await api('POST', `/android/agent/cancel/${running.id}`);
      if (wrongly) return 'a genuinely running phone was told to stop';
    },
  },
  {
    name: 'a reconnecting phone is waited for, not failed',
    async run() {
      const t0 = Date.now();
      const phone = phones.free1.phone;
      // The phone's socket is gone for a moment — exactly what every dashboard
      // request sees during a deploy, while the phones are still attached to the
      // container that is being replaced.
      phone.drop();
      await sleep(500);

      const dispatch = run('free1', 'open chrome [sim steps=2 delay=200]');
      // It comes back shortly, as a real companion does after a restart.
      setTimeout(() => void phone.connect().catch(() => undefined), 2_500);

      try {
        await dispatch;
      } catch (error) {
        return `dispatch refused the run: ${String(error.message).slice(0, 120)}`;
      }

      const done = await waitFor(async () => {
        const [task] = await tasksSince(t0, ['free1']);
        return task && TERMINAL.has(task.status) ? task : null;
      }, 40_000);
      if (!done) return 'task never finished';
      if (done.status !== 'SUCCEEDED') return `ended as ${done.status}/${done.reason_code}`;
    },
  },
  {
    name: 'space report names the biggest tables',
    async run() {
      const report = (await api('GET', '/maintenance/db-space')).data;
      if (!Array.isArray(report.tables) || report.tables.length === 0) return 'no tables reported';
      if (!report.tables.some((t) => t.table_name === 'agent_tasks')) return 'agent_tasks missing from the report';
      if (typeof report.counts?.task_logs !== 'number') return 'counts are missing';
    },
  },
  {
    name: 'a large file uploads in chunks and downloads back byte for byte',
    async run() {
      // Bigger than the inline limit, so it takes the chunked path an APK takes.
      const payload = crypto.randomBytes(20 * 1024 * 1024);
      const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
      const chunkSize = 8 * 1024 * 1024;
      const totalChunks = Math.ceil(payload.length / chunkSize);

      const init = await api('POST', '/android/files/init', {
        device_ids: [phones.free1.dbId, phones.free2.dbId],
        file_name: 'harness.apk',
        mime_type: 'application/vnd.android.package-archive',
        size_bytes: payload.length,
        sha256,
        total_chunks: totalChunks,
      });
      const uploadId = init.data.upload_id;

      for (let index = 0; index < totalChunks; index += 1) {
        const slice = payload.subarray(index * chunkSize, Math.min((index + 1) * chunkSize, payload.length));
        const res = await fetch(`${BASE}/api/android/files/chunk?upload_id=${uploadId}&index=${index}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${userToken}` },
          body: slice,
        });
        if (!res.ok) return `chunk ${index} refused: ${res.status} ${(await res.text()).slice(0, 120)}`;
      }
      await api('POST', '/android/files/finish', { upload_id: uploadId });

      // Now collect it the way the phone does, with the device's own token.
      const listed = await fetch(`${BASE}/api/android/companion/files`, {
        headers: { Authorization: `Bearer ${phones.free1.phone.token}` },
      }).then((r) => r.json());
      const entry = (listed.data ?? []).find((f) => f.name === 'harness.apk');
      if (!entry) return 'the phone was not offered the file';

      const download = await fetch(`${BASE}/api/android/companion/files/${entry.id}/content`, {
        headers: { Authorization: `Bearer ${phones.free1.phone.token}` },
      });
      if (!download.ok) return `download refused: ${download.status} ${(await download.text()).slice(0, 160)}`;
      const received = Buffer.from(await download.arrayBuffer());
      if (received.length !== payload.length) return `got ${received.length} bytes, expected ${payload.length}`;
      if (crypto.createHash('sha256').update(received).digest('hex') !== sha256) return 'downloaded bytes do not match';

      // The second phone must still be able to collect the same stored bytes.
      const second = await fetch(`${BASE}/api/android/companion/files`, {
        headers: { Authorization: `Bearer ${phones.free2.phone.token}` },
      }).then((r) => r.json());
      const secondEntry = (second.data ?? []).find((f) => f.name === 'harness.apk');
      if (!secondEntry) return 'the second phone was not offered the file';
      const secondDownload = await fetch(`${BASE}/api/android/companion/files/${secondEntry.id}/content`, {
        headers: { Authorization: `Bearer ${phones.free2.phone.token}` },
      });
      if (!secondDownload.ok) return `second download refused: ${secondDownload.status}`;
    },
  },
  {
    name: 'a run that needs no IP skips the lane without holding it',
    async run() {
      const t0 = Date.now();
      const rotationsBefore = rotation.calls.length;

      // A long browsing run takes the lane.
      await run('lane1', 'open chrome and read the news [sim steps=25 delay=400]');
      const holder = await waitFor(async () => (await tasksSince(t0, ['lane1'])).find((r) => r.status === 'RUNNING'), 20_000);
      if (!holder) return 'the lane holder never started';

      // A settings change on another phone of the same lane: no exit IP, so it
      // should start straight away rather than queue behind the browsing run.
      const exempt = await api('POST', '/android/agent/run', {
        device_id: phones.lane2.dbId,
        prompt: 'open date and time settings [sim steps=3 delay=200]',
        max_steps: 50,
        skip_proxy_lane: true,
      });
      if (exempt?.data?.queued) return 'the exempt run was queued anyway';

      const ranBoth = await waitFor(async () => {
        const rows = await tasksSince(t0, ['lane1', 'lane2']);
        return rows.filter((r) => r.status === 'RUNNING').length >= 2 ? rows : null;
      }, 15_000, 200);
      if (!ranBoth) return 'the exempt run did not run alongside the lane holder';

      // And a normal run on the same lane must still wait its turn.
      const normal = await api('POST', '/android/agent/run', {
        device_id: phones.lane3.dbId,
        prompt: 'open chrome and search something [sim steps=3 delay=200]',
        max_steps: 50,
      });
      if (!normal?.data?.queued) return 'a normal run skipped the lane too';

      const exemptDone = await waitFor(async () => {
        const [row] = await tasksSince(t0, ['lane2']);
        return row && TERMINAL.has(row.status) ? row : null;
      }, 30_000);
      if (!exemptDone) return 'the exempt run never finished';
      if (exemptDone.status !== 'SUCCEEDED') return `exempt run ended as ${exemptDone.status}/${exemptDone.reason_code}`;
      // Finishing it must not have rotated the provider: it never used the IP.
      if (rotation.calls.length !== rotationsBefore) return 'an exempt run rotated the proxy';

      await api('DELETE', '/device-proxy/queue/all');
      const running = (await tasksSince(t0, ['lane1'])).find((r) => r.status === 'RUNNING');
      if (running) await api('POST', `/android/agent/cancel/${running.id}`);
      await sleep(3_000);
    },
  },
  {
    name: 'graceful shutdown marks the run INTERRUPTED within seconds',
    async run() {
      const t0 = Date.now();
      await run('free1', 'open chrome and scroll a long page [sim steps=60 delay=400]');
      const running = await waitFor(async () => (await tasksSince(t0, ['free1'])).find((r) => r.status === 'RUNNING'), 15_000);
      if (!running) return 'did not start';
      await sleep(1500);
      const { ms } = await stopBackend('SIGTERM');
      const [[row]] = await db.query('SELECT status, reason_code FROM agent_tasks WHERE id = ?', [running.id]);
      await startBackend();
      await connectPhones();
      if (ms > 5000) return `shutdown took ${ms}ms`;
      if (row.status !== 'INTERRUPTED' || row.reason_code !== 'SERVER_RESTART') return `after SIGTERM: ${row.status}/${row.reason_code}`;
    },
  },
  {
    name: 'hard crash is swept to INTERRUPTED after the lease expires',
    async run() {
      const t0 = Date.now();
      await run('free2', 'open chrome and scroll a long page [sim steps=60 delay=400]');
      const running = await waitFor(async () => (await tasksSince(t0, ['free2'])).find((r) => r.status === 'RUNNING'), 15_000);
      if (!running) return 'did not start';
      await sleep(1500);
      await stopBackend('SIGKILL');
      await startBackend();
      await connectPhones();
      const swept = await waitFor(async () => {
        const [[row]] = await db.query('SELECT status, reason_code FROM agent_tasks WHERE id = ?', [running.id]);
        return row.status !== 'RUNNING' ? row : null;
      }, 90_000, 1000);
      if (!swept) return 'still RUNNING 90s after the crash';
      if (swept.status !== 'INTERRUPTED') return `swept to ${swept.status}/${swept.reason_code}`;
    },
  },
  {
    name: 'phone dropping mid-run ends the task instead of hanging',
    async run() {
      const t0 = Date.now();
      await run('free1', 'open chrome and scroll a long page [sim steps=60 delay=300]');
      const running = await waitFor(async () => (await tasksSince(t0, ['free1'])).find((r) => r.status === 'RUNNING'), 15_000);
      if (!running) return 'did not start';
      await sleep(1000);
      phones.free1.phone.drop();
      const ended = await waitFor(async () => {
        const [[row]] = await db.query('SELECT status, reason_code FROM agent_tasks WHERE id = ?', [running.id]);
        return TERMINAL.has(row.status) ? row : null;
      }, 60_000, 500);
      await phones.free1.phone.connect();
      if (!ended) return 'still RUNNING 60s after the phone dropped';
      if (ended.status === 'SUCCEEDED') return 'reported success with no phone';
    },
  },
  {
    name: 'hung phone (never answers) fails the task instead of hanging',
    async run() {
      const t0 = Date.now();
      await run('free2', 'open chrome and scroll a long page [sim steps=60 delay=300]');
      const running = await waitFor(async () => (await tasksSince(t0, ['free2'])).find((r) => r.status === 'RUNNING'), 15_000);
      if (!running) return 'did not start';
      phones.free2.phone.silent = true;
      const ended = await waitFor(async () => {
        const [[row]] = await db.query('SELECT status, reason_code FROM agent_tasks WHERE id = ?', [running.id]);
        return TERMINAL.has(row.status) ? row : null;
      }, 60_000, 500);
      phones.free2.phone.silent = false;
      if (!ended) return 'still RUNNING 60s after the phone went silent';
      if (ended.status !== 'FAILED') return `ended as ${ended.status}/${ended.reason_code}`;
    },
  },
];

// ---------------------------------------------------------------- main
const filters = process.argv.slice(2);
const selected = scenarios.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));

async function main() {
  await new Promise((resolve) => rotationServer.listen(4700, '127.0.0.1', resolve));
  log('resetting database + migrations');
  await resetDatabase();
  log('starting backend');
  await startBackend();
  await seed();
  await connectPhones();
  log(`fleet ready: ${Object.keys(phones).length} fake phones`);

  const results = [];
  for (const scenario of selected) {
    log(`▶ ${scenario.name}`);
    const started = Date.now();
    let failure;
    try {
      failure = await scenario.run();
    } catch (error) {
      failure = `threw: ${error.message}`;
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name: scenario.name, failure, seconds });
    log(failure ? `  ✗ FAIL (${seconds}s): ${failure}` : `  ✓ pass (${seconds}s)`);
  }

  console.log('\n──────── results ────────');
  for (const r of results) console.log(`${r.failure ? '✗' : '✓'} ${r.name}${r.failure ? `  — ${r.failure}` : ''}`);
  const failed = results.filter((r) => r.failure).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  return failed;
}

main()
  .then(async (failed) => {
    Object.values(phones).forEach((p) => p.phone.close());
    await stopBackend('SIGTERM');
    rotationServer.close();
    await db?.end();
    process.exit(failed ? 1 : 0);
  })
  .catch(async (error) => {
    console.error('harness error:', error);
    await stopBackend('SIGKILL');
    process.exit(2);
  });
