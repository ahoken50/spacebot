import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-municipal-watch-'));
let content = '<html><body>Version A — règle initiale</body></html>';
const sourceServer = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html', 'last-modified': 'Mon, 01 Jan 2026 00:00:00 GMT' });
  response.end(content);
});
await new Promise((resolve) => sourceServer.listen(0, '127.0.0.1', resolve));
const sourcePort = sourceServer.address().port;
const policyDirectory = path.join(root, '00_systeme', 'veille-municipale');
await fs.mkdir(policyDirectory, { recursive: true });
await fs.writeFile(path.join(policyDirectory, 'municipal_watch_policy.approved.json'), `${JSON.stringify({
  schema_version: 1,
  status: 'approved',
  allow_municipal_watch: true,
  auto_apply: false,
  auto_send: false,
  legal_conclusions: false,
  grant_submission: false,
  sources: [{
    id: 'source-test', title: 'Source officielle simulée', url: `http://127.0.0.1:${sourcePort}/source`,
    kind: 'regulatory', scope: 'Test local uniquement', enabled: true,
  }],
}, null, 2)}\n`, 'utf8');

const servicePort = 38_000 + Math.floor(Math.random() * 1_000);
const child = spawn('node', ['server.js'], {
  cwd: path.dirname(new URL(import.meta.url).pathname),
  env: {
    ...process.env,
    PORT: String(servicePort),
    PROJECT_HUB_WORKSPACE: root,
    PROJECT_HUB_MUNICIPAL_WATCH_TOKEN: 'test-token',
    PROJECT_HUB_MUNICIPAL_WATCH_ALLOW_TEST_HTTP: 'true',
    PROJECT_HUB_MUNICIPAL_WATCH_INTERVAL_SECONDS: '86400',
  },
  stdio: 'ignore',
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${servicePort}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Le veilleur municipal ne démarre pas.');
}
async function runWatch() {
  const response = await fetch(`http://127.0.0.1:${servicePort}/internal/run`, {
    method: 'POST', headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(response.status, 200);
  return response.json();
}

try {
  await waitForHealth();
  const baseline = await runWatch();
  assert.deepEqual(baseline.baseline, ['source-test']);
  assert.equal(baseline.changed.length, 0);

  content = '<html><body>Version B — texte officiel modifié</body></html>';
  const changed = await runWatch();
  assert.equal(changed.changed.length, 1);
  const proposalId = changed.changed[0].proposal_id;
  const proposalPath = path.join(policyDirectory, 'proposals', proposalId, 'proposal.json');
  const proposal = JSON.parse(await fs.readFile(proposalPath, 'utf8'));
  assert.equal(proposal.kind, 'municipal_watch');
  assert.equal(proposal.status, 'pending_approval');
  assert.equal(proposal.constraints.auto_apply, false);
  assert.equal(proposal.constraints.legal_conclusions, false);
  assert.equal(proposal.constraints.grant_submission, false);

  const duplicate = await runWatch();
  assert.deepEqual(duplicate.skipped_pending, ['source-test']);
  console.log('Test intégration veille municipale : OK');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => sourceServer.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
