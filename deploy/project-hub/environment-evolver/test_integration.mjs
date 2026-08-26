import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(new URL('.', import.meta.url).pathname);
const workspace = await mkdtemp(path.join(tmpdir(), 'project-environment-evolver-workspace-'));
const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'project-environment-evolver-repo-'));
const fakeBin = path.join(repositoryRoot, 'fake-bin');
const commandLog = path.join(repositoryRoot, 'commands.log');
const proposalRoot = path.join(workspace, '00_systeme', 'optimisation', 'environment-evolver', 'proposals');
const servicePort = 39211;
const token = 'test-environment-evolver-token';

await Promise.all([
  mkdir(path.join(repositoryRoot, 'environment-evolver'), { recursive: true }),
  mkdir(fakeBin, { recursive: true }),
  mkdir(proposalRoot, { recursive: true }),
]);
await writeFile(path.join(repositoryRoot, 'environment-evolver', 'package.json'), '{"name":"test-service","version":"1.0.0","dependencies":{}}\n', 'utf8');
await writeFile(path.join(repositoryRoot, 'docker-compose.yml'), 'services: {}\n', 'utf8');
for (const command of ['bun', 'docker']) {
  await writeFile(path.join(fakeBin, command), `#!/bin/sh\nprintf '%s %s\\n' '${command}' "$*" >> '${commandLog}'\nexit 0\n`, { encoding: 'utf8', mode: 0o755 });
}

const constraints = {
  local_repository_only: true,
  secret_change: false,
  permission_change: false,
  external_transmission: false,
};
await writeFile(path.join(proposalRoot, 'valid-dependency.json'), `${JSON.stringify({
  schema_version: 1,
  kind: 'environment_change',
  proposal_id: 'environment-dependency-valid-001',
  status: 'queued',
  change_type: 'dependency',
  package_directory: 'environment-evolver',
  package_specifier: 'example-package@1.2.3',
  affected_services: ['project-environment-evolver'],
  reason: 'Ajouter une dépendance locale avec une version exacte pour le test contrôlé.',
  constraints,
}, null, 2)}\n`, 'utf8');
await writeFile(path.join(proposalRoot, 'invalid-dependency.json'), `${JSON.stringify({
  schema_version: 1,
  kind: 'environment_change',
  proposal_id: 'environment-dependency-invalid-001',
  status: 'queued',
  change_type: 'dependency',
  package_directory: '../outside',
  package_specifier: 'bad package',
  affected_services: ['project-environment-evolver'],
  reason: 'Tester le rejet des chemins et spécificateurs interdits.',
  constraints,
}, null, 2)}\n`, 'utf8');

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    PORT: String(servicePort),
    PROJECT_HUB_WORKSPACE: workspace,
    PROJECT_HUB_REPOSITORY_ROOT: repositoryRoot,
    PROJECT_HUB_ENVIRONMENT_EVOLVER_TOKEN: token,
    PROJECT_HUB_ENVIRONMENT_EVOLVER_INTERVAL_SECONDS: '3600',
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
  throw new Error('Le contrôleur d’environnement n’a pas démarré.');
}

try {
  await waitForService();
  const forbidden = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, { method: 'POST' });
  assert.equal(forbidden.status, 403);

  const scan = await fetch(`http://127.0.0.1:${servicePort}/internal/scan`, {
    method: 'POST', headers: { 'x-project-hub-token': token },
  });
  assert.equal(scan.status, 200);
  const payload = await scan.json();
  assert.equal(payload.processed.length, 2);
  const valid = JSON.parse(await readFile(path.join(proposalRoot, 'valid-dependency.json'), 'utf8'));
  const invalid = JSON.parse(await readFile(path.join(proposalRoot, 'invalid-dependency.json'), 'utf8'));
  assert.equal(valid.status, 'auto_applied_environment_change');
  assert.equal(invalid.status, 'invalid_proposal');
  const catalog = JSON.parse(await readFile(path.join(workspace, '00_systeme', 'optimisation', 'environment-evolver', 'catalog.json'), 'utf8'));
  assert.equal(catalog.schema_version, 1);
  assert.equal(catalog.docker_compose.path, 'docker-compose.yml');
  assert.ok(catalog.package_manifests.some((entry) => entry.path === 'environment-evolver/package.json'));
  const commands = await readFile(commandLog, 'utf8');
  assert.match(commands, /bun add --exact --ignore-scripts example-package@1.2.3/);
  assert.match(commands, /bun install --frozen-lockfile --ignore-scripts/);
  assert.match(commands, /docker compose -f .*docker-compose\.yml up -d --build project-environment-evolver/);
  console.log('Test d’intégration environment-evolver : OK');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await Promise.all([rm(workspace, { recursive: true, force: true }), rm(repositoryRoot, { recursive: true, force: true })]);
}
