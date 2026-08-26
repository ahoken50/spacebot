import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(new URL('.', import.meta.url).pathname);
const workspace = await mkdtemp(path.join(tmpdir(), 'project-local-code-improver-'));
const scriptsRoot = path.join(workspace, '05_automatisation', '01_scripts');
const proposalRoot = path.join(workspace, '00_systeme', 'optimisation', 'self-improvement', 'proposals');
const servicePort = 39201;
const token = 'test-local-code-improver-token';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

await mkdir(scriptsRoot, { recursive: true });
await mkdir(proposalRoot, { recursive: true });
const targetPath = path.join(scriptsRoot, 'calculator.py');
const baseline = 'def add(left, right):\n    return left + right\n';
const candidate = 'def add(left, right):\n    return left + right\n\ndef subtract(left, right):\n    return left - right\n';
await writeFile(targetPath, baseline, 'utf8');

const constraints = {
  local_workspace_only: true,
  external_side_effects: false,
  config_change: false,
  dependency_change: false,
  secret_access: false,
  network_access: false,
};
await writeFile(path.join(proposalRoot, 'valid.json'), `${JSON.stringify({
  schema_version: 1,
  kind: 'local_code_improvement',
  proposal_id: 'local-code-valid-001',
  status: 'queued',
  target_path: '05_automatisation/01_scripts/calculator.py',
  base_sha256: sha256(baseline),
  candidate_content: candidate,
  reason: 'Ajouter une opération manquante avec une modification locale testable.',
  validation: { kind: 'python_syntax' },
  constraints,
}, null, 2)}\n`, 'utf8');

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(servicePort),
    PROJECT_HUB_WORKSPACE: workspace,
    PROJECT_HUB_LOCAL_CODE_IMPROVER_TOKEN: token,
    PROJECT_HUB_LOCAL_CODE_IMPROVER_INTERVAL_SECONDS: '3600',
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
  throw new Error('Le correcteur local n’a pas démarré.');
}

try {
  await waitForService();
  const forbidden = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, { method: 'POST' });
  assert.equal(forbidden.status, 403);

  const scan = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { 'x-project-hub-token': token },
  });
  assert.equal(scan.status, 200);
  const scanPayload = await scan.json();
  assert.equal(scanPayload.processed[0].status, 'auto_applied_local_code');
  assert.equal(await readFile(targetPath, 'utf8'), candidate);
  const validProposal = JSON.parse(await readFile(path.join(proposalRoot, 'valid.json'), 'utf8'));
  assert.equal(validProposal.status, 'auto_applied_local_code');
  assert.equal(await readFile(validProposal.backup_path, 'utf8'), baseline);

  const rejectedCandidate = 'def broken(:\n    return 1\n';
  await writeFile(path.join(proposalRoot, 'invalid.json'), `${JSON.stringify({
    schema_version: 1,
    kind: 'local_code_improvement',
    proposal_id: 'local-code-invalid-001',
    status: 'queued',
    target_path: '05_automatisation/01_scripts/calculator.py',
    base_sha256: sha256(candidate),
    candidate_content: rejectedCandidate,
    reason: 'Candidate volontairement invalide pour vérifier le retour sûr.',
    validation: { kind: 'python_syntax' },
    constraints,
  }, null, 2)}\n`, 'utf8');
  const rejected = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { 'x-project-hub-token': token },
  });
  assert.equal(rejected.status, 200);
  const rejectedPayload = await rejected.json();
  assert.equal(rejectedPayload.processed[0].status, 'validation_failed');
  assert.equal(await readFile(targetPath, 'utf8'), candidate);
  const invalidProposal = JSON.parse(await readFile(path.join(proposalRoot, 'invalid.json'), 'utf8'));
  assert.equal(invalidProposal.status, 'validation_failed');
  console.log('Test d’intégration local-code-improver : OK');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(workspace, { recursive: true, force: true });
}
