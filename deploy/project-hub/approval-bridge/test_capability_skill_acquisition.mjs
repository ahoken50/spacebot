import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(new URL('.', import.meta.url).pathname);
const instanceRoot = await mkdtemp(path.join(tmpdir(), 'project-capability-skill-'));
const workspace = path.join(instanceRoot, 'shared-workspace');
const apiPort = 39191;
const servicePort = 39192;
const token = 'test-capability-skill-token';
const proposalId = 'capability-skill-finances-test';
const proposalPath = path.join(workspace, '00_systeme', 'propositions_capacites', `${proposalId}.json`);

await mkdir(path.dirname(proposalPath), { recursive: true });
await writeFile(proposalPath, `${JSON.stringify({
  proposal_id: proposalId,
  kind: 'capability_skill_acquisition',
  status: 'pending_approval',
  created_at: '2026-08-25T00:00:00.000Z',
  target_agent_id: 'project-finance',
  skill_source: 'example-org/finance-skill',
  review_summary: 'Compétence lue et proposée uniquement pour le workspace finances.',
  constraints: {
    workspace_skill_only: true,
    mcp_change: false,
    model_change: false,
    docker_change: false,
    permissions_change: false,
    secret_change: false,
    system_dependency_change: false,
  },
}, null, 2)}\n`, 'utf8');

let tasks = [];
let nextTaskNumber = 101;
const api = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/tasks?created_by=project-approval-bridge&limit=500') {
    res.end(JSON.stringify({ tasks }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/tasks') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const task = {
      task_number: nextTaskNumber++, status: 'pending_approval', revision: 1,
      metadata: input.metadata, approved_by: null, approved_at: null,
    };
    tasks.push(task);
    res.end(JSON.stringify({ task }));
    return;
  }
  const match = req.url?.match(/^\/api\/tasks\/(\d+)$/);
  if (req.method === 'PUT' && match) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const number = Number(match[1]);
    const index = tasks.findIndex((task) => task.task_number === number);
    assert.notEqual(index, -1);
    tasks[index] = { ...tasks[index], status: input.status, revision: tasks[index].revision + 1 };
    res.end(JSON.stringify({ task: tasks[index] }));
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
      if ((await fetch(`http://127.0.0.1:${servicePort}/healthz`)).ok) return;
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
  assert.equal(tasks[0].status, 'pending_approval');

  tasks[0] = { ...tasks[0], status: 'ready', approved_by: 'administration-vdo', approved_at: '2026-08-25T12:00:00.000Z' };
  const approved = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).promoted[0].proposal_id, proposalId);
  assert.equal(tasks[0].status, 'done');

  const proposal = JSON.parse(await readFile(proposalPath, 'utf8'));
  assert.equal(proposal.status, 'approved_for_agent_install');
  const authorizationPath = path.join(instanceRoot, 'skill-install-authorizations', `${proposalId}.json`);
  const authorization = JSON.parse(await readFile(authorizationPath, 'utf8'));
  assert.equal(authorization.kind, 'capability_skill_install_authorization');
  assert.equal(authorization.status, 'approved_for_agent_install');
  assert.equal(authorization.target_agent_id, 'project-finance');
  assert.equal(authorization.skill_source, 'example-org/finance-skill');
  assert.equal(authorization.workspace_skill_only, true);
  await assert.rejects(readFile(path.join(instanceRoot, 'agents', 'project-finance', 'workspace', 'skills', 'finance-skill', 'SKILL.md')));
  console.log('Test d’intégration approval-bridge / capacité skill : OK');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve) => api.close(resolve));
  await rm(instanceRoot, { recursive: true, force: true });
}
