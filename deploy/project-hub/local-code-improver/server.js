import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const app = express();
app.use(express.json({ limit: '128kb' }));

const port = Number.parseInt(process.env.PORT ?? '3019', 10);
const workspace = path.resolve(process.env.PROJECT_HUB_WORKSPACE ?? '/workspace');
const enabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_LOCAL_CODE_IMPROVER_ENABLED ?? 'true').trim().toLowerCase());
const intervalSeconds = Math.max(30, Number.parseInt(process.env.PROJECT_HUB_LOCAL_CODE_IMPROVER_INTERVAL_SECONDS ?? '300', 10) || 300);
const internalToken = process.env.PROJECT_HUB_LOCAL_CODE_IMPROVER_TOKEN ?? '';
const scriptsRoot = path.resolve(workspace, '05_automatisation', '01_scripts');
const improvementRoot = path.resolve(workspace, '00_systeme', 'optimisation', 'self-improvement');
const proposalRoot = path.join(improvementRoot, 'proposals');
const backupRoot = path.join(improvementRoot, 'backups');
const auditRoot = path.join(improvementRoot, 'audits');
const temporaryRoot = path.join(workspace, 'temp', 'self-improvement');
const allowedExtensions = new Set(['.py', '.js', '.mjs', '.sh']);
let running = false;
let lastCycle = { status: 'not_started' };

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeName(value) { return String(value).replace(/[^A-Za-z0-9._-]/g, '_'); }
function isWithin(child, parent) { return child === parent || child.startsWith(`${parent}${path.sep}`); }
function hasExactTrue(value) { return value === true; }

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

function requireInternalToken(request, response, next) {
  if (!internalToken || request.get('x-project-hub-token') !== internalToken) {
    response.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

function validateConstraints(proposal) {
  const constraints = proposal?.constraints ?? {};
  const required = [
    'local_workspace_only', 'external_side_effects', 'config_change',
    'dependency_change', 'secret_access', 'network_access',
  ];
  for (const field of required) {
    if (!(field in constraints)) throw new Error(`constraint_missing:${field}`);
  }
  if (!hasExactTrue(constraints.local_workspace_only)) throw new Error('constraint_local_workspace_only');
  for (const field of ['external_side_effects', 'config_change', 'dependency_change', 'secret_access', 'network_access']) {
    if (constraints[field] !== false) throw new Error(`constraint_forbidden:${field}`);
  }
}

function resolveTarget(proposal) {
  if (typeof proposal?.target_path !== 'string' || !proposal.target_path.trim()) throw new Error('target_path_required');
  if (path.isAbsolute(proposal.target_path)) throw new Error('target_path_must_be_relative');
  const targetPath = path.resolve(workspace, proposal.target_path);
  if (!isWithin(targetPath, scriptsRoot)) throw new Error('target_path_outside_scripts_root');
  if (!allowedExtensions.has(path.extname(targetPath).toLowerCase())) throw new Error('target_extension_not_allowed');
  return targetPath;
}

function validateShape(proposal) {
  if (proposal?.kind !== 'local_code_improvement') throw new Error('invalid_kind');
  if (!proposal?.proposal_id || !/^[A-Za-z0-9._-]{4,160}$/.test(String(proposal.proposal_id))) throw new Error('invalid_proposal_id');
  if (typeof proposal?.candidate_content !== 'string' || !proposal.candidate_content.trim() || proposal.candidate_content.length > 200_000 || proposal.candidate_content.includes('\u0000')) throw new Error('invalid_candidate_content');
  if (!/^[a-f0-9]{64}$/i.test(String(proposal?.base_sha256 ?? ''))) throw new Error('invalid_base_sha256');
  if (typeof proposal?.reason !== 'string' || !proposal.reason.trim() || proposal.reason.length > 4000) throw new Error('invalid_reason');
  validateConstraints(proposal);
}

function validationCommand(targetPath, temporaryPath) {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === '.py') return { command: 'python3', args: ['-m', 'py_compile', temporaryPath], kind: 'python_syntax' };
  if (extension === '.js' || extension === '.mjs') return { command: 'bun', args: ['--check', temporaryPath], kind: 'javascript_syntax' };
  if (extension === '.sh') return { command: 'bash', args: ['-n', temporaryPath], kind: 'shell_syntax' };
  throw new Error('unsupported_validation');
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', (error) => resolve({ ok: false, exit_code: null, output: `${output}\n${error.message}`.trim() }));
    child.on('close', (code) => resolve({ ok: code === 0, exit_code: code, output: output.slice(0, 8000) }));
  });
}

async function validateCandidate(targetPath, proposal) {
  await ensureDir(temporaryRoot);
  const extension = path.extname(targetPath).toLowerCase();
  const temporaryPath = path.join(temporaryRoot, `${safeName(proposal.proposal_id)}-${crypto.randomUUID()}${extension}`);
  try {
    await fs.writeFile(temporaryPath, proposal.candidate_content, { encoding: 'utf8', mode: 0o600 });
    const command = validationCommand(targetPath, temporaryPath);
    const result = await runCommand(command.command, command.args);
    return { ...result, kind: command.kind };
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
    await fs.unlink(`${temporaryPath}c`).catch(() => {});
  }
}

async function writeAudit(proposalId, event) {
  await writeJsonAtomic(path.join(auditRoot, `${safeName(proposalId)}.json`), event);
}

async function markValidationFailure(filePath, proposal, reason, validation = null) {
  proposal.status = 'validation_failed';
  proposal.updated_at = nowIso();
  proposal.validation_result = validation ?? { ok: false, output: String(reason).slice(0, 8000) };
  proposal.auto_apply = false;
  await writeJsonAtomic(filePath, proposal);
  await writeAudit(proposal.proposal_id ?? path.basename(filePath), {
    event: 'validation_failed', proposal_id: proposal.proposal_id ?? null, at: nowIso(), reason: String(reason), validation: proposal.validation_result,
  });
  return { proposal_id: proposal.proposal_id ?? null, status: 'validation_failed', reason: String(reason) };
}

async function applyProposal(filePath) {
  let proposal;
  try {
    proposal = await readJson(filePath);
    validateShape(proposal);
    const targetPath = resolveTarget(proposal);
    const currentContent = await fs.readFile(targetPath, 'utf8');
    const currentHash = sha256(currentContent);
    if (currentHash !== proposal.base_sha256) return markValidationFailure(filePath, proposal, 'base_sha256_mismatch');
    const validation = await validateCandidate(targetPath, proposal);
    if (!validation.ok) return markValidationFailure(filePath, proposal, 'syntax_validation_failed', validation);

    const backupDirectory = path.join(backupRoot, safeName(proposal.proposal_id));
    await ensureDir(backupDirectory);
    const backupPath = path.join(backupDirectory, path.basename(targetPath));
    await writeTextAtomic(backupPath, currentContent);
    await writeJsonAtomic(path.join(backupDirectory, 'manifest.json'), {
      proposal_id: proposal.proposal_id, target_path: proposal.target_path, base_sha256: currentHash, backed_up_at: nowIso(), backup_path: backupPath,
    });
    await writeTextAtomic(targetPath, proposal.candidate_content);
    proposal.status = 'auto_applied_local_code';
    proposal.auto_apply = true;
    proposal.applied_at = nowIso();
    proposal.applied_target_path = targetPath;
    proposal.backup_path = backupPath;
    proposal.applied_sha256 = sha256(proposal.candidate_content);
    proposal.validation_result = validation;
    await writeJsonAtomic(filePath, proposal);
    await writeAudit(proposal.proposal_id, {
      event: 'auto_applied_local_code', proposal_id: proposal.proposal_id, at: nowIso(), target_path: targetPath,
      backup_path: backupPath, base_sha256: currentHash, applied_sha256: proposal.applied_sha256, validation,
    });
    return { proposal_id: proposal.proposal_id, status: proposal.status, target_path: targetPath, backup_path: backupPath };
  } catch (error) {
    if (proposal?.proposal_id) return markValidationFailure(filePath, proposal, error.message);
    await writeAudit(path.basename(filePath), { event: 'invalid_proposal', at: nowIso(), reason: error.message });
    return { proposal_id: null, status: 'invalid_proposal', reason: error.message };
  }
}

async function scanAndApply() {
  if (!enabled) return { status: 'disabled', processed: [] };
  if (running) return { status: 'busy', processed: [] };
  running = true;
  try {
    await Promise.all([ensureDir(proposalRoot), ensureDir(backupRoot), ensureDir(auditRoot)]);
    const processed = [];
    for (const filename of (await fs.readdir(proposalRoot)).sort()) {
      if (!filename.endsWith('.json')) continue;
      const filePath = path.join(proposalRoot, filename);
      const proposal = await readJson(filePath).catch(() => null);
      if (!proposal || !['pending_validation', 'queued'].includes(proposal.status)) continue;
      processed.push(await applyProposal(filePath));
    }
    lastCycle = { status: 'ok', completed_at: nowIso(), processed };
    return lastCycle;
  } finally {
    running = false;
  }
}

app.get('/healthz', (_request, response) => response.status(200).json({ status: 'ok', service: 'project-local-code-improver', enabled, interval_seconds: intervalSeconds, last_cycle: lastCycle }));
app.post('/internal/scan', requireInternalToken, async (_request, response) => {
  try { response.json(await scanAndApply()); }
  catch (error) { response.status(500).json({ error: error.message }); }
});

setTimeout(() => { scanAndApply().catch((error) => { lastCycle = { status: 'error', completed_at: nowIso(), error: error.message }; }); }, 2000);
setInterval(() => { scanAndApply().catch((error) => { lastCycle = { status: 'error', completed_at: nowIso(), error: error.message }; }); }, intervalSeconds * 1000);

app.listen(port, '0.0.0.0', () => console.log(`project-local-code-improver listening on ${port}`));
