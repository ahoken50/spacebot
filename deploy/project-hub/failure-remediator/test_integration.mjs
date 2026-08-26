import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(new URL('.', import.meta.url).pathname);
const workspace = await mkdtemp(path.join(tmpdir(), 'project-failure-remediator-'));
const apiPort = 39171;
const servicePort = 39172;
const token = 'test-failure-remediator-token';

const task = {
  task_number: 42,
  title: 'Préparer le rapprochement financier',
  description: 'Utiliser le dossier de travail local.',
  status: 'failed',
  owner_agent_id: 'project-finance',
  assigned_agent_id: 'project-finance',
  revision: 1,
};
const attempt = {
  id: 'attempt-42-1',
  attempt: 1,
  outcome: 'failed',
  outcome_summary: 'Tool not found; contacter Marie.Dupont@example.org au 819 555-1234. authorization: Bearer secret-value',
};

const api = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/tasks?limit=500') {
    res.end(JSON.stringify({ tasks: [task] }));
    return;
  }
  if (req.url === '/api/tasks/42/attempts') {
    res.end(JSON.stringify({ attempts: [attempt] }));
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
    PROJECT_HUB_SPACEBOT_API_URL: `http://127.0.0.1:${apiPort}/api`,
    PROJECT_HUB_FAILURE_REMEDIATOR_TOKEN: token,
    PROJECT_HUB_FAILURE_REMEDIATOR_INTERVAL_SECONDS: '3600',
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
      // Le processus démarre encore.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Le service de remédiation n’a pas démarré.');
}

try {
  await waitForService();
  const first = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.results[0].status, 'proposal_created');
  const proposalId = firstPayload.results[0].proposal_id;
  const proposalDir = path.join(workspace, '00_systeme', 'optimisation', 'failure-remediator', 'proposals', proposalId);
  const proposal = JSON.parse(await readFile(path.join(proposalDir, 'proposal.json'), 'utf8'));
  assert.equal(proposal.status, 'pending_approval');
  assert.equal(proposal.failure_category, 'missing_tool');
  assert.equal(proposal.constraints.auto_promote, false);
  const candidate = await readFile(path.join(proposalDir, 'candidate_SKILL.md'), 'utf8');
  assert.ok(!candidate.includes('Marie.Dupont@example.org'));
  assert.ok(!candidate.includes('819 555-1234'));
  assert.ok(!candidate.includes('secret-value'));

  const second = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(second.status, 200);
  const secondPayload = await second.json();
  assert.equal(secondPayload.results[0].status, 'already_processed');
  console.log('Test d’intégration failure-remediator : OK');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve) => api.close(resolve));
  await rm(workspace, { recursive: true, force: true });
}
