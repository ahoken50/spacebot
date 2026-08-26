import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

const port = Number.parseInt(process.env.PORT ?? '3015', 10);
const workspace = process.env.PROJECT_HUB_WORKSPACE ?? '/data/shared-workspace';
const memoryExportUrl = requiredEnvironment('PROJECT_HUB_MEMORY_EXPORT_URL');
const memoryExportToken = requiredEnvironment('PROJECT_HUB_MEMORY_EXPORT_TOKEN');
const enabled = isEnabled(process.env.PROJECT_HUB_REFERENCE_MINER_ENABLED, true);
const autonomousEnabled = isEnabled(process.env.PROJECT_HUB_REFERENCE_MINER_AUTONOMOUS_ENABLED, true);
const maxCandidates = Number.parseInt(process.env.PROJECT_HUB_REFERENCE_MINER_MAX_CANDIDATES ?? '3', 10);
const maxRunsPerDay = Number.parseInt(process.env.PROJECT_HUB_REFERENCE_MINER_MAX_RUNS_PER_DAY ?? '1', 10);
const cycleHours = Number.parseInt(process.env.PROJECT_HUB_REFERENCE_MINER_CYCLE_HOURS ?? '24', 10);
const autonomousPipelineEnabled = isEnabled(process.env.PROJECT_HUB_AUTONOMOUS_PIPELINE_ENABLED, false);
const autonomousPipelineToken = process.env.PROJECT_HUB_AUTONOMOUS_PIPELINE_TOKEN ?? '';
const optimizerUrl = process.env.PROJECT_HUB_OPTIMIZER_AUTONOMOUS_URL ?? 'http://project-optimizer:3013/internal/autonomous-run';
const skilloptUrl = process.env.PROJECT_HUB_SKILLOPT_AUTONOMOUS_URL ?? 'http://project-skillopt:3014/internal/autonomous-run';

const root = path.join(workspace, '00_systeme', 'optimisation', 'reference-miner');
const autonomousDir = path.join(root, 'autonomous-packs');
const policyPath = path.join(root, 'reference_mining_policy.approved.json');
const statePath = path.join(root, 'autonomy_state.json');
const dspyCandidatesPath = path.join(root, 'dspy_candidates.json');
const skilloptCandidatesPath = path.join(root, 'skillopt_candidates.json');

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function isEnabled(value, fallback) {
  if (value === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return nowIso().slice(0, 10);
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(normalize(value)).digest('hex').slice(0, 20);
}

function redactText(value) {
  return String(value ?? '')
    .replace(/[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{1,}(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ'’-]{1,})+/g, '[PERSONNE]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[COURRIEL]')
    .replace(/(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}/g, '[TELEPHONE]')
    .replace(/\$\s?\d[\d\s,.]*/g, '[MONTANT]')
    .replace(/\b\d{7,}\b/g, '[NUMERO]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

function validatePolicy(policy) {
  if (policy.status !== 'approved') throw new Error('La politique de découverte doit porter le statut approved.');
  if (policy.allow_reference_mining !== true) throw new Error('La politique doit autoriser explicitement allow_reference_mining=true.');
  if (policy.redaction_required !== true) throw new Error('La politique doit exiger redaction_required=true.');
  if (!Array.isArray(policy.allowed_record_types) || policy.allowed_record_types.length === 0) {
    throw new Error('La politique doit définir allowed_record_types.');
  }
  if (policy.auto_promote === true) {
    throw new Error('La promotion automatique vers les packs actifs reste interdite dans Project Hub.');
  }
  return policy;
}

async function loadPolicy() {
  return validatePolicy(await readJson(policyPath));
}

async function exportEligibleRecords(policy) {
  const url = new URL(memoryExportUrl);
  url.searchParams.set('limit', String(Math.min(50, Math.max(maxCandidates * 8, 12))));
  url.searchParams.set('record_types', policy.allowed_record_types.join(','));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${memoryExportToken}` },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Export mémoire indisponible (${response.status}): ${detail}`);
  }
  const body = await response.json();
  if (!Array.isArray(body.records)) throw new Error('L’export mémoire ne contient pas de liste records.');
  return body.records;
}

function isEligible(record, policy) {
  const payload = record.payload ?? {};
  return record.status === 'approved'
    && payload.learning_eligible === true
    && payload.completed === true
    && policy.allowed_record_types.includes(record.record_type)
    && Array.isArray(record.source_references)
    && record.source_references.length > 0
    && typeof payload.reference_expected === 'object'
    && payload.reference_expected !== null
    && typeof (payload.reference_task_input ?? record.content) === 'string';
}

function expectedFor(record) {
  const expected = record.payload.reference_expected ?? {};
  const requiredTerms = Array.isArray(expected.required_terms) ? expected.required_terms.map(redactText).filter(Boolean).slice(0, 8) : [];
  const forbiddenTerms = Array.isArray(expected.forbidden_terms) ? expected.forbidden_terms.map(redactText).filter(Boolean).slice(0, 8) : [];
  return {
    required_terms: requiredTerms,
    forbidden_terms: forbiddenTerms,
    require_source_markers: expected.require_source_markers === true,
    max_chars: Math.min(6000, Math.max(200, Number.parseInt(expected.max_chars ?? '2000', 10) || 2000)),
  };
}

function candidateFor(record, target) {
  const payload = record.payload ?? {};
  const taskInput = redactText(payload.reference_task_input ?? record.content);
  const expected = expectedFor(record);
  const base = {
    id: `CAND-${target.toUpperCase()}-${fingerprint(`${record.id}:${taskInput}`)}`,
    status: 'candidate',
    target,
    source_record_id: record.id,
    source_external_key_fingerprint: record.external_key ? fingerprint(record.external_key) : null,
    source_record_type: record.record_type,
    source_references: record.source_references.map(redactText).filter(Boolean).slice(0, 10),
    task_input: taskInput,
    expected,
    redacted: true,
    evidence_complete: true,
    provenance: 'shared_memory_approved_learning_eligible',
    created_at: nowIso(),
    promotion: 'blocked_pending_approval',
  };
  if (target === 'dspy') {
    const baselineInstruction = redactText(payload.baseline_instruction);
    const agentId = redactText(payload.agent_id ?? 'project-coordination');
    if (!baselineInstruction || !agentId) return null;
    return { ...base, agent_id: agentId, baseline_instruction: baselineInstruction };
  }
  const skillId = redactText(payload.skill_id);
  if (!skillId) return null;
  return { ...base, skill_id: skillId };
}

function candidatesFrom(records, policy, target) {
  const seen = new Set();
  const candidates = [];
  for (const record of records) {
    if (!isEligible(record, policy)) continue;
    const candidate = candidateFor(record, target);
    if (!candidate || candidate.task_input.length < 40) continue;
    const key = fingerprint(`${target}:${candidate.task_input}:${JSON.stringify(candidate.expected)}`);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
    if (candidates.length >= maxCandidates) break;
  }
  return candidates;
}

async function mineCandidates({ autonomous = false } = {}) {
  if (!enabled) throw new Error('Le mineur de références est désactivé administrativement.');
  const policy = await loadPolicy();
  const records = await exportEligibleRecords(policy);
  const dspyCandidates = candidatesFrom(records, policy, 'dspy');
  const skilloptCandidates = candidatesFrom(records, policy, 'skillopt');
  const createdAt = nowIso();
  const common = {
    status: 'candidates_pending_approval',
    promotion: 'blocked_pending_approval',
    redaction_required: true,
    auto_promotion: false,
    policy_path: policyPath,
    source_record_count: records.length,
    autonomous,
    created_at: createdAt,
  };
  await writeJson(dspyCandidatesPath, { ...common, target: 'dspy', candidates: dspyCandidates });
  await writeJson(skilloptCandidatesPath, { ...common, target: 'skillopt', candidates: skilloptCandidates });
  return {
    discovered: true,
    source_record_count: records.length,
    dspy_candidates: dspyCandidates.length,
    skillopt_candidates: skilloptCandidates.length,
    outputs: [dspyCandidatesPath, skilloptCandidatesPath],
    promotion: 'blocked_pending_approval',
  };
}

function groupCandidates(candidates, key) {
  const groups = new Map();
  for (const candidate of candidates) {
    const value = String(candidate[key] ?? '');
    if (!value) continue;
    const group = groups.get(value) ?? [];
    group.push(candidate);
    groups.set(value, group);
  }
  return [...groups.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
}

async function writeAutonomousPacks() {
  const [dspyPayload, skilloptPayload] = await Promise.all([
    readJson(dspyCandidatesPath, { candidates: [] }),
    readJson(skilloptCandidatesPath, { candidates: [] }),
  ]);
  const createdAt = nowIso();
  const outputs = {};
  const dspyGroup = groupCandidates(dspyPayload.candidates ?? [], 'agent_id').find(([, candidates]) => candidates.length >= 1);
  if (dspyGroup) {
    const [agentId, candidates] = dspyGroup;
    const packPath = path.join(autonomousDir, 'dspy_reference_cases.system_validated.json');
    await writeJson(packPath, {
      schema_version: '1.0', status: 'system_validated', autonomous_generated: true, redacted: true,
      scope: 'instruction_appendix_only', auto_execute: true, created_at: createdAt, agent_id: agentId,
      source: 'project-reference-miner', promotion: 'blocked_pending_human_approval',
      cases: candidates.slice(0, 2).map(({ id, agent_id, task_input, baseline_instruction, expected, source_record_id, source_references }) => ({ id, agent_id, task_input, baseline_instruction, expected, source_record_id, source_references })),
    });
    outputs.dspy = packPath;
  }
  const skilloptGroup = groupCandidates(skilloptPayload.candidates ?? [], 'skill_id').find(([, candidates]) => candidates.length >= 3);
  if (skilloptGroup) {
    const [skillId, candidates] = skilloptGroup;
    const partition = (candidate) => ({ id: candidate.id, task_input: candidate.task_input, expected: candidate.expected, source_record_id: candidate.source_record_id, source_references: candidate.source_references });
    const packPath = path.join(autonomousDir, 'skillopt_reference_pack.system_validated.json');
    await writeJson(packPath, {
      schema_version: '1.0', status: 'system_validated', autonomous_generated: true, redacted: true,
      scope: 'skill_text_only', autonomous_learning: true, created_at: createdAt, skill_id: skillId,
      source: 'project-reference-miner', promotion: 'blocked_pending_human_approval',
      training_cases: [partition(candidates[0])], validation_cases: [partition(candidates[1])], holdout_cases: [partition(candidates[2])],
    });
    outputs.skillopt = packPath;
  }
  return outputs;
}

async function callAutonomousRunner(url, referencePackPath) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${autonomousPipelineToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference_pack_path: referencePackPath }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} a refusé le pack autonome : ${payload.error ?? response.status}`);
  return payload;
}

async function autonomousCycle() {
  if (!enabled || !autonomousEnabled) return { started: false, reason: 'miner_disabled' };
  const policy = await loadPolicy();
  if (policy.autonomous_mining !== true) return { started: false, reason: 'policy_autonomous_mining_not_enabled' };
  if (policy.autonomous_pipeline !== true || !autonomousPipelineEnabled) return { started: false, reason: 'autonomous_pipeline_not_enabled' };
  if (!autonomousPipelineToken) return { started: false, reason: 'autonomous_pipeline_token_missing' };
  const state = await readJson(statePath, {});
  const runsToday = state.day === today() ? Number(state.runs_today ?? 0) : 0;
  if (runsToday >= maxRunsPerDay) return { started: false, reason: 'daily_limit_reached', runs_today: runsToday };
  const mining = await mineCandidates({ autonomous: true });
  const packs = await writeAutonomousPacks();
  const evaluations = {};
  if (packs.dspy) {
    try { evaluations.dspy = await callAutonomousRunner(optimizerUrl, packs.dspy); }
    catch (error) { evaluations.dspy = { status: 'failed', error: String(error.message ?? error) }; }
  }
  if (packs.skillopt) {
    try { evaluations.skillopt = await callAutonomousRunner(skilloptUrl, packs.skillopt); }
    catch (error) { evaluations.skillopt = { status: 'failed', error: String(error.message ?? error) }; }
  }
  const result = { mining, packs, evaluations, promotion: 'blocked_pending_human_approval' };
  await writeJson(statePath, { day: today(), runs_today: runsToday + 1, last_run_at: nowIso(), last_result: result });
  return { started: true, ...result };
}

async function status() {
  const [policy, state, dspyCandidates, skilloptCandidates] = await Promise.all([
    readJson(policyPath, null),
    readJson(statePath, {}),
    readJson(dspyCandidatesPath, {}),
    readJson(skilloptCandidatesPath, {}),
  ]);
  return {
    enabled,
    autonomous_enabled: autonomousEnabled,
    policy_present: policy !== null,
    policy_status: policy?.status ?? null,
    autonomous_mining: policy?.autonomous_mining === true,
    autonomous_pipeline: policy?.autonomous_pipeline === true && autonomousPipelineEnabled,
    dspy_candidate_count: Array.isArray(dspyCandidates.candidates) ? dspyCandidates.candidates.length : 0,
    skillopt_candidate_count: Array.isArray(skilloptCandidates.candidates) ? skilloptCandidates.candidates.length : 0,
    state,
    limits: { max_candidates: maxCandidates, max_runs_per_day: maxRunsPerDay, cycle_hours: cycleHours },
    promotion: 'always_blocked_pending_approval',
  };
}

function createServer() {
  const server = new McpServer({ name: 'project-reference-miner', version: '0.1.0' });
  server.registerTool('reference_miner_status', { description: 'Consulter l’état du mineur local de candidats de référence, ses limites et ses sorties.', inputSchema: {} }, async () => textResult(await status()));
  server.registerTool('reference_miner_validate_policy', { description: 'Valider la politique locale autorisant la découverte de candidats, sans interroger de documents ni de modèle.', inputSchema: {} }, async () => {
    const policy = await loadPolicy();
    return textResult({ valid: true, autonomous_mining: policy.autonomous_mining === true, auto_promotion: false });
  });
  server.registerTool('reference_miner_discover_candidates', {
    description: 'Découvrir des candidats de référence dans les enregistrements terminés, approuvés et explicitement marqués learning_eligible. Écrit uniquement des fichiers candidates séparés des packs actifs.',
    inputSchema: {},
  }, async () => textResult(await mineCandidates()));
  server.registerTool('reference_miner_autonomous_cycle', { description: 'Exécuter la découverte autonome bornée si la politique approuvée l’autorise. Ne promeut jamais un candidat vers DSPy ou SkillOpt.', inputSchema: {} }, async () => textResult(await autonomousCycle()));
  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });
app.post('/mcp', async (request, response) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
    response.on('close', () => {
      transport.close().catch((error) => console.error('MCP transport close failed', error));
      server.close().catch((error) => console.error('MCP server close failed', error));
    });
  } catch (error) {
    console.error('MCP request failed', error);
    if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});
app.get('/mcp', (_request, response) => response.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
app.get('/healthz', async (_request, response) => {
  try {
    const minerStatus = await status();
    response.status(200).json({ status: 'ok', ...minerStatus });
  } catch (error) {
    response.status(503).json({ status: 'unavailable', error: String(error) });
  }
});

const timer = setTimeout(() => autonomousCycle().catch((error) => console.error('Initial reference-miner cycle skipped:', error.message)), 30_000);
const interval = setInterval(() => autonomousCycle().catch((error) => console.error('Reference-miner cycle skipped:', error.message)), Math.max(1, cycleHours) * 60 * 60 * 1000);
const httpServer = app.listen(port, () => console.log(`Project Hub reference-miner MCP server listening on port ${port}`));

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Project Hub reference-miner`);
  clearTimeout(timer);
  clearInterval(interval);
  httpServer.close();
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
