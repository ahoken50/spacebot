import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(new URL('.', import.meta.url).pathname);
const instanceRoot = await mkdtemp(path.join(tmpdir(), 'project-approval-bridge-'));
const workspace = path.join(instanceRoot, 'shared-workspace');
const apiPort = 39181;
const servicePort = 39182;
const token = 'test-approval-bridge-token';
const proposalId = 'failure-42-1-testcandidate';
const proposalDir = path.join(workspace, '00_systeme', 'optimisation', 'failure-remediator', 'proposals', proposalId);
const candidatePath = path.join(proposalDir, 'candidate_SKILL.md');

await mkdir(proposalDir, { recursive: true });
await writeFile(candidatePath, [
  '---',
  'name: temporary-failure-lesson',
  'description: test',
  '---',
  '',
  '# Leçon',
  '',
  'Vérifier l’outil disponible avant toute reprise.',
  '',
].join('\n'), 'utf8');
await writeFile(path.join(proposalDir, 'proposal.json'), `${JSON.stringify({
  proposal_id: proposalId,
  kind: 'failure_remediation',
  status: 'pending_approval',
  promotion: 'blocked_pending_user_approval',
  created_at: '2026-08-25T00:00:00.000Z',
  source_task_number: 42,
  target_agent_id: 'task-analysis',
  failure_category: 'missing_tool',
  candidate_path: candidatePath,
  constraints: {
    auto_promote: false,
    config_change: false,
    model_change: false,
    mcp_change: false,
    docker_change: false,
    permissions_change: false,
    source_data_access: false,
  },
}, null, 2)}\n`, 'utf8');

let bridgeTask = null;
const api = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/tasks?created_by=project-approval-bridge&limit=500') {
    res.end(JSON.stringify({ tasks: bridgeTask ? [bridgeTask] : [] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/tasks') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    bridgeTask = {
      task_number: 91,
      status: 'pending_approval',
      revision: 1,
      metadata: input.metadata,
      approved_by: null,
      approved_at: null,
    };
    res.end(JSON.stringify({ task: bridgeTask }));
    return;
  }
  if (req.method === 'PUT' && req.url === '/api/tasks/91') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    bridgeTask = { ...bridgeTask, status: input.status, revision: bridgeTask.revision + 1 };
    res.end(JSON.stringify({ task: bridgeTask }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});
await new Promise((resolve) => api.listen(apiPort, '127.0.0.1', resolve));

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(servicePort),
    PROJECT_HUB_WORKSPACE: workspace,
    PROJECT_HUB_INSTANCE_ROOT: instanceRoot,
    PROJECT_HUB_SPACEBOT_API_URL: `http://127.0.0.1:${apiPort}/api`,
    PROJECT_HUB_APPROVAL_BRIDGE_TOKEN: token,
    PROJECT_HUB_APPROVAL_BRIDGE_INTERVAL_SECONDS: '3600',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForService() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${servicePort}/healthz`);
      if (response.ok) return;
    } catch (_) {
      // Le service démarre encore.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Le pont d’approbation n’a pas démarré.');
}

try {
  await waitForService();
  const created = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).created[0].proposal_id, proposalId);
  assert.equal(bridgeTask.status, 'pending_approval');

  bridgeTask = {
    ...bridgeTask,
    status: 'ready',
    approved_by: 'workspace-owner',
    approved_at: '2026-08-25T12:00:00.000Z',
  };
  const promoted = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json()).promoted[0].proposal_id, proposalId);
  assert.equal(bridgeTask.status, 'done');

  const installed = await readFile(path.join(instanceRoot, 'agents', 'task-analysis', 'workspace', 'skills', 'project-failure-lessons', 'SKILL.md'), 'utf8');
  const persisted = await readFile(path.join(instanceRoot, 'approved-skill-overlays', 'task-analysis', 'project-failure-lessons', 'SKILL.md'), 'utf8');
  assert.ok(installed.includes('Vérifier l’outil disponible avant toute reprise.'));
  assert.equal(installed, persisted);
  const proposal = JSON.parse(await readFile(path.join(proposalDir, 'proposal.json'), 'utf8'));
  assert.equal(proposal.status, 'approved_promoted');
  console.log('Test d’intégration approval-bridge / failure remediation : OK');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve) => api.close(resolve));
  await rm(instanceRoot, { recursive: true, force: true });
}
