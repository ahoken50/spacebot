import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const app = express();
app.use(express.json({ limit: '128kb' }));

const port = Number.parseInt(process.env.PORT ?? '3020', 10);
const workspace = path.resolve(process.env.PROJECT_HUB_WORKSPACE ?? '/workspace');
const repositoryRoot = path.resolve(process.env.PROJECT_HUB_REPOSITORY_ROOT ?? '/repo');
const enabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_ENVIRONMENT_EVOLVER_ENABLED ?? 'true').trim().toLowerCase());
const intervalSeconds = Math.max(60, Number.parseInt(process.env.PROJECT_HUB_ENVIRONMENT_EVOLVER_INTERVAL_SECONDS ?? '900', 10) || 900);
const internalToken = process.env.PROJECT_HUB_ENVIRONMENT_EVOLVER_TOKEN ?? '';
const proposalRoot = path.join(workspace, '00_systeme', 'optimisation', 'environment-evolver', 'proposals');
const backupRoot = path.join(workspace, '00_systeme', 'optimisation', 'environment-evolver', 'backups');
const auditRoot = path.join(workspace, '00_systeme', 'optimisation', 'environment-evolver', 'audits');
const catalogPath = path.join(workspace, '00_systeme', 'optimisation', 'environment-evolver', 'catalog.json');
const composePath = path.join(repositoryRoot, 'docker-compose.yml');
const allowedPackageDirectories = new Set(['approval-bridge', 'failure-remediator', 'reference-miner', 'skillopt', 'optimizer', 'shared-memory', 'document-studio', 'gis-mcp', 'local-code-improver', 'environment-evolver']);
const allowedServiceNames = new Set(['project-shared-memory', 'project-gis', 'project-document-studio', 'project-optimizer', 'project-skillopt', 'project-reference-miner', 'project-local-code-improver', 'project-environment-evolver', 'spacebot-project-hub', 'project-failure-remediator', 'project-approval-bridge']);
let running = false;
let lastCycle = { status: 'not_started' };

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeName(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160); }
function isWithin(child, parent) { return child === parent || child.startsWith(`${parent}${path.sep}`); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function ensureDir(directory) { await fs.mkdir(directory, { recursive: true }); }
async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}
async function writeTextAtomic(filePath, content) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, filePath);
}

function run(command, args, cwd = repositoryRoot) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', (error) => resolve({ ok: false, exit_code: null, output: `${output}\n${error.message}`.trim().slice(0, 12000) }));
    child.on('close', (code) => resolve({ ok: code === 0, exit_code: code, output: output.slice(0, 12000) }));
  });
}

function requireInternalToken(request, response, next) {
  if (!internalToken || request.get('x-project-hub-token') !== internalToken) return response.status(403).json({ error: 'forbidden' });
  next();
}

function validateCommon(proposal) {
  if (proposal?.kind !== 'environment_change') throw new Error('invalid_kind');
  if (!proposal?.proposal_id || !/^[A-Za-z0-9._-]{4,160}$/.test(String(proposal.proposal_id))) throw new Error('invalid_proposal_id');
  if (!['dependency', 'docker', 'mcp'].includes(proposal.change_type)) throw new Error('invalid_change_type');
  if (typeof proposal.reason !== 'string' || !proposal.reason.trim() || proposal.reason.length > 4000) throw new Error('invalid_reason');
  const constraints = proposal.constraints ?? {};
  if (constraints.local_repository_only !== true || constraints.secret_change !== false || constraints.permission_change !== false || constraints.external_transmission !== false) {
    throw new Error('invalid_constraints');
  }
  if (!Array.isArray(proposal.affected_services) || proposal.affected_services.length < 1 || proposal.affected_services.some((name) => !allowedServiceNames.has(name))) throw new Error('invalid_affected_services');
}

async function backupFile(proposalId, filePath) {
  const relative = path.relative(repositoryRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('backup_path_outside_repository');
  const backupPath = path.join(backupRoot, safeName(proposalId), relative);
  const content = await fs.readFile(filePath, 'utf8');
  await writeTextAtomic(backupPath, content);
  return { backup_path: backupPath, content, sha256: sha256(content) };
}

async function writeAudit(proposalId, payload) {
  await writeJsonAtomic(path.join(auditRoot, `${safeName(proposalId)}.json`), payload);
}

async function catalogEntry(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8').catch(() => null);
  return content === null ? null : { path: relativePath, sha256: sha256(content), content };
}

async function publishCatalog() {
  const package_manifests = [];
  for (const directory of [...allowedPackageDirectories].sort()) {
    const entry = await catalogEntry(path.join(directory, 'package.json'));
    if (entry) package_manifests.push(entry);
  }
  const catalog = {
    schema_version: 1,
    generated_at: nowIso(),
    purpose: 'Référence sans secret des cibles locales autorisées pour les propositions d’évolution.',
    docker_compose: await catalogEntry('docker-compose.yml'),
    mcp_config: await catalogEntry(path.join('instance', 'config.toml')),
    package_manifests,
  };
  await writeJsonAtomic(catalogPath, catalog);
  return catalog;
}

function resolveDockerTarget(proposal) {
  if (typeof proposal.target_path !== 'string') throw new Error('target_path_required');
  const target = path.resolve(repositoryRoot, proposal.target_path);
  if (!isWithin(target, repositoryRoot)) throw new Error('target_outside_repository');
  const relative = path.relative(repositoryRoot, target);
  if (!(relative === 'docker-compose.yml' || /^[A-Za-z0-9_-]+\/Dockerfile$/.test(relative))) throw new Error('docker_target_not_allowed');
  return target;
}

function validateCandidateText(proposal) {
  if (typeof proposal.candidate_content !== 'string' || !proposal.candidate_content.trim() || proposal.candidate_content.length > 300_000 || proposal.candidate_content.includes('\u0000')) throw new Error('invalid_candidate_content');
  if (!/^[a-f0-9]{64}$/i.test(String(proposal.base_sha256 ?? ''))) throw new Error('invalid_base_sha256');
}

async function validateCompose() {
  return run('docker', ['compose', '-f', composePath, 'config'], repositoryRoot);
}

async function restartServices(services, rebuild) {
  const args = ['compose', '-f', composePath, 'up', '-d'];
  if (rebuild) args.push('--build');
  args.push(...services);
  return run('docker', args, repositoryRoot);
}

async function applyDocker(proposal) {
  validateCandidateText(proposal);
  const target = resolveDockerTarget(proposal);
  const current = await fs.readFile(target, 'utf8');
  if (sha256(current) !== proposal.base_sha256) throw new Error('base_sha256_mismatch');
  const backup = await backupFile(proposal.proposal_id, target);
  await writeTextAtomic(target, proposal.candidate_content);
  const configResult = await validateCompose();
  if (!configResult.ok) {
    await writeTextAtomic(target, backup.content);
    return { ok: false, rolled_back: true, stage: 'compose_config', validation: configResult };
  }
  const restart = await restartServices(proposal.affected_services, true);
  if (!restart.ok) {
    await writeTextAtomic(target, backup.content);
    await restartServices(proposal.affected_services, true);
    return { ok: false, rolled_back: true, stage: 'compose_up', validation: restart };
  }
  return { ok: true, target_path: target, backup_path: backup.backup_path, validation: { compose_config: configResult, restart } };
}

function dependencySpecifierAllowed(value) {
  return /^(?:@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@[A-Za-z0-9][A-Za-z0-9._+\-^~<>=|]*$/.test(String(value ?? ''));
}

async function applyDependency(proposal) {
  const directory = String(proposal.package_directory ?? '');
  const specifier = String(proposal.package_specifier ?? '');
  if (!allowedPackageDirectories.has(directory) || !dependencySpecifierAllowed(specifier)) throw new Error('dependency_not_allowed');
  const packageDirectory = path.join(repositoryRoot, directory);
  const packagePath = path.join(packageDirectory, 'package.json');
  const packageBackup = await backupFile(proposal.proposal_id, packagePath);
  const lockPath = path.join(packageDirectory, 'bun.lock');
  const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
  const lockBackup = lockExists ? await backupFile(proposal.proposal_id, lockPath) : null;
  const install = await run('bun', ['add', '--exact', '--ignore-scripts', specifier], packageDirectory);
  if (!install.ok) {
    await writeTextAtomic(packagePath, packageBackup.content);
    if (lockBackup) await writeTextAtomic(lockPath, lockBackup.content); else await fs.unlink(lockPath).catch(() => {});
    return { ok: false, rolled_back: true, stage: 'bun_add', validation: install };
  }
  const verify = await run('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], packageDirectory);
  if (!verify.ok) {
    await writeTextAtomic(packagePath, packageBackup.content);
    if (lockBackup) await writeTextAtomic(lockPath, lockBackup.content); else await fs.unlink(lockPath).catch(() => {});
    return { ok: false, rolled_back: true, stage: 'bun_install', validation: verify };
  }
  const restart = await restartServices(proposal.affected_services, true);
  if (!restart.ok) {
    await writeTextAtomic(packagePath, packageBackup.content);
    if (lockBackup) await writeTextAtomic(lockPath, lockBackup.content); else await fs.unlink(lockPath).catch(() => {});
    await restartServices(proposal.affected_services, true);
    return { ok: false, rolled_back: true, stage: 'compose_up', validation: restart };
  }
  return { ok: true, target_path: packagePath, backup_path: packageBackup.backup_path, validation: { install, verify, restart } };
}

function stripMcpConfig(config) {
  const result = clone(config);
  if (result.defaults) delete result.defaults.mcp;
  if (Array.isArray(result.agents)) result.agents = result.agents.map((agent) => { const value = clone(agent); delete value.mcp; return value; });
  return result;
}

async function parseToml(filePath) {
  const result = await run('python3', ['-c', 'import json,sys,tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], "rb")), sort_keys=True))', filePath], repositoryRoot);
  if (!result.ok) throw new Error(`toml_parse_failed:${result.output}`);
  return JSON.parse(result.output);
}

function validateMcpEndpoints(config) {
  const mcps = [ ...(config?.defaults?.mcp ?? []), ...((config?.agents ?? []).flatMap((agent) => agent.mcp ?? [])) ];
  for (const mcp of mcps) {
    if (!/^[a-z][a-z0-9_-]{1,80}$/i.test(String(mcp?.name ?? '')) || mcp.transport !== 'http' || !/^http:\/\/project-[a-z0-9-]+:\d{2,5}\/mcp$/.test(String(mcp.url ?? ''))) throw new Error('invalid_mcp_endpoint');
  }
}

async function applyMcp(proposal) {
  validateCandidateText(proposal);
  if (proposal.target_path !== 'instance/config.toml') throw new Error('mcp_target_not_allowed');
  const target = path.join(repositoryRoot, 'instance', 'config.toml');
  const current = await fs.readFile(target, 'utf8');
  if (sha256(current) !== proposal.base_sha256) throw new Error('base_sha256_mismatch');
  const temporary = path.join(workspace, 'temp', `mcp-${safeName(proposal.proposal_id)}.toml`);
  await ensureDir(path.dirname(temporary));
  await fs.writeFile(temporary, proposal.candidate_content, 'utf8');
  try {
    const before = await parseToml(target);
    const after = await parseToml(temporary);
    if (JSON.stringify(stripMcpConfig(before)) !== JSON.stringify(stripMcpConfig(after))) throw new Error('mcp_candidate_changes_non_mcp_config');
    validateMcpEndpoints(after);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  const backup = await backupFile(proposal.proposal_id, target);
  await writeTextAtomic(target, proposal.candidate_content);
  const restart = await restartServices(proposal.affected_services, false);
  if (!restart.ok) {
    await writeTextAtomic(target, backup.content);
    await restartServices(proposal.affected_services, false);
    return { ok: false, rolled_back: true, stage: 'spacebot_restart', validation: restart };
  }
  return { ok: true, target_path: target, backup_path: backup.backup_path, validation: { restart } };
}

async function applyProposal(filePath) {
  let proposal;
  try {
    proposal = await readJson(filePath);
    validateCommon(proposal);
    const result = proposal.change_type === 'dependency' ? await applyDependency(proposal) : proposal.change_type === 'docker' ? await applyDocker(proposal) : await applyMcp(proposal);
    proposal.status = result.ok ? 'auto_applied_environment_change' : 'validation_failed_rolled_back';
    proposal.applied_at = nowIso();
    proposal.result = result;
    await writeJsonAtomic(filePath, proposal);
    await writeAudit(proposal.proposal_id, { event: proposal.status, at: nowIso(), proposal_id: proposal.proposal_id, change_type: proposal.change_type, result });
    return { proposal_id: proposal.proposal_id, status: proposal.status, result };
  } catch (error) {
    if (proposal) {
      proposal.status = 'invalid_proposal';
      proposal.updated_at = nowIso();
      proposal.error = String(error.message ?? error);
      await writeJsonAtomic(filePath, proposal);
    }
    await writeAudit(proposal?.proposal_id ?? path.basename(filePath), { event: 'invalid_proposal', at: nowIso(), reason: String(error.message ?? error) });
    return { proposal_id: proposal?.proposal_id ?? null, status: 'invalid_proposal', reason: String(error.message ?? error) };
  }
}

async function scanAndApply() {
  if (!enabled) return { status: 'disabled', processed: [] };
  if (running) return { status: 'busy', processed: [] };
  running = true;
  try {
    await Promise.all([ensureDir(proposalRoot), ensureDir(backupRoot), ensureDir(auditRoot)]);
    await publishCatalog();
    const processed = [];
    for (const filename of (await fs.readdir(proposalRoot)).sort()) {
      if (!filename.endsWith('.json')) continue;
      const filePath = path.join(proposalRoot, filename);
      const proposal = await readJson(filePath).catch(() => null);
      if (!proposal || !['queued', 'pending_validation'].includes(proposal.status)) continue;
      processed.push(await applyProposal(filePath));
    }
    await publishCatalog();
    lastCycle = { status: 'ok', completed_at: nowIso(), processed };
    return lastCycle;
  } finally { running = false; }
}

app.get('/healthz', (_request, response) => response.status(200).json({ status: 'ok', service: 'project-environment-evolver', enabled, interval_seconds: intervalSeconds, last_cycle: lastCycle }));
app.post('/internal/scan', requireInternalToken, async (_request, response) => {
  try { response.json(await scanAndApply()); }
  catch (error) { response.status(500).json({ error: String(error.message ?? error) }); }
});

setTimeout(() => { scanAndApply().catch((error) => { lastCycle = { status: 'error', at: nowIso(), error: error.message }; }); }, 5000);
setInterval(() => { scanAndApply().catch((error) => { lastCycle = { status: 'error', at: nowIso(), error: error.message }; }); }, intervalSeconds * 1000);
app.listen(port, '0.0.0.0', () => console.log(`project-environment-evolver listening on ${port}`));
