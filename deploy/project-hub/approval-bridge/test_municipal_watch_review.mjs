import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-watch-bridge-'));
const workspace = path.join(root, 'shared-workspace');
const proposalDirectory = path.join(workspace, '00_systeme', 'veille-municipale', 'proposals', 'municipal-watch-source-test');
await fs.mkdir(proposalDirectory, { recursive: true });
const proposalPath = path.join(proposalDirectory, 'proposal.json');
await fs.writeFile(proposalPath, `${JSON.stringify({
  schema_version: 1,
  kind: 'municipal_watch',
  proposal_id: 'municipal-watch-source-test',
  status: 'pending_approval',
  created_at: '2026-08-26T00:00:00.000Z',
  source: { id: 'source-test', title: 'Source réglementaire simulée', url: 'https://example.invalid/source', kind: 'regulatory' },
  change: { detected_at: '2026-08-26T00:00:00.000Z', previous_hash: 'a', current_hash: 'b' },
  constraints: { auto_apply: false, auto_send: false, legal_conclusions: false, grant_submission: false, config_change: false, model_change: false, mcp_change: false, docker_change: false, permissions_change: false },
}, null, 2)}\n`, 'utf8');

let tasks = [];
let nextNumber = 500;
const apiServer = http.createServer(async (request, response) => {
  const body = await new Promise((resolve) => {
    let value = ''; request.on('data', (chunk) => { value += chunk; }); request.on('end', () => resolve(value));
  });
  const send = (status, payload) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(payload)); };
  if (request.method === 'GET' && request.url.startsWith('/api/tasks?')) return send(200, { tasks });
  if (request.method === 'POST' && request.url === '/api/tasks') {
    const payload = JSON.parse(body);
    const task = { task_number: nextNumber++, revision: 1, status: 'pending_approval', metadata: payload.metadata, approved_by: null, approved_at: null };
    tasks.push(task);
    return send(200, { task });
  }
  const match = request.url.match(/^\/api\/tasks\/(\d+)$/);
  if (request.method === 'PUT' && match) {
    const task = tasks.find((entry) => entry.task_number === Number(match[1]));
    const payload = JSON.parse(body);
    assert.equal(payload.expected_revision, task.revision);
    task.status = payload.status;
    task.revision += 1;
    return send(200, { task });
  }
  return send(404, { error: 'not found' });
});
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
const apiPort = apiServer.address().port;
const bridgePort = 39_000 + Math.floor(Math.random() * 1_000);
const child = spawn('node', ['server.js'], {
  cwd: path.dirname(new URL(import.meta.url).pathname),
  env: {
    ...process.env,
    PORT: String(bridgePort),
    PROJECT_HUB_WORKSPACE: workspace,
    PROJECT_HUB_INSTANCE_ROOT: root,
    PROJECT_HUB_SPACEBOT_API_URL: `http://127.0.0.1:${apiPort}/api`,
    PROJECT_HUB_APPROVAL_BRIDGE_TOKEN: 'bridge-test-token',
    PROJECT_HUB_APPROVAL_BRIDGE_INTERVAL_SECONDS: '3600',
  },
  stdio: 'ignore',
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${bridgePort}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Le pont d’approbation ne démarre pas.');
}
async function scan() {
  const response = await fetch(`http://127.0.0.1:${bridgePort}/internal/scan`, {
    method: 'POST', headers: { authorization: 'Bearer bridge-test-token' },
  });
  assert.equal(response.status, 200);
  return response.json();
}

try {
  await waitForHealth();
  const created = await scan();
  assert.equal(created.created.length, 1);
  assert.equal(tasks[0].status, 'pending_approval');

  tasks[0].status = 'ready';
  tasks[0].approved_by = 'project-sponsor';
  tasks[0].approved_at = '2026-08-26T00:05:00.000Z';
  const reviewed = await scan();
  assert.equal(reviewed.promoted.length, 1);
  assert.equal(tasks[0].status, 'done');
  const updated = JSON.parse(await fs.readFile(proposalPath, 'utf8'));
  assert.equal(updated.status, 'approved_reviewed');
  assert.equal(updated.promotion, 'review_recorded_no_automatic_action');
  const audit = JSON.parse(await fs.readFile(path.join(workspace, '00_systeme', 'optimisation', 'approval-bridge', 'promotions', 'municipal-watch-source-test.json'), 'utf8'));
  assert.equal(audit.promotion, 'review_recorded_no_automatic_action');
  console.log('Test approbation veille municipale : OK');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => apiServer.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
