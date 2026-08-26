import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
app.use(express.json({ limit: '128kb' }));

const port = Number.parseInt(process.env.PORT ?? '3017', 10);
const workspace = process.env.PROJECT_HUB_WORKSPACE ?? '/data/shared-workspace';
const apiBase = (process.env.PROJECT_HUB_SPACEBOT_API_URL ?? 'http://spacebot-project-hub:19898/api').replace(/\/$/, '');
const enabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_FAILURE_REMEDIATOR_ENABLED ?? 'true').trim().toLowerCase());
const intervalSeconds = Math.max(30, Number.parseInt(process.env.PROJECT_HUB_FAILURE_REMEDIATOR_INTERVAL_SECONDS ?? '120', 10) || 120);
const maxProposalsPerDay = Math.max(1, Number.parseInt(process.env.PROJECT_HUB_FAILURE_REMEDIATOR_MAX_PROPOSALS_PER_DAY ?? '3', 10) || 3);
const serviceToken = process.env.PROJECT_HUB_FAILURE_REMEDIATOR_TOKEN ?? '';
const ownerAgentId = 'project-coordination';
const allowedAgents = new Set(['project-coordination', 'project-finance', 'project-planning', 'project-analysis', 'project-reporting', 'project-governance']);
const actionableOutcomes = new Set(['failed', 'blocked', 'timed_out']);

const remediationRoot = path.join(workspace, '00_systeme', 'optimisation', 'failure-remediator');
const proposalsRoot = path.join(remediationRoot, 'proposals');
const auditsRoot = path.join(remediationRoot, 'audits');
const statePath = path.join(remediationRoot, 'state.json');

let lastCycle = { status: 'not_started' };
let running = false;

function nowIso() { return new Date().toISOString(); }
function todayUtc() { return nowIso().slice(0, 10); }
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function isWithin(child, parent) { return child === parent || child.startsWith(`${parent}${path.sep}`); }

async function ensureDir(directory) { await fs.mkdir(directory, { recursive: true }); }
async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}
async function writeTextAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, 'utf8');
  await fs.rename(temporary, filePath);
}

function redactedText(value) {
  return String(value ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[courriel retiré]')
    .replace(/\+?\d[\d(). -]{7,}\d/g, '[numéro retiré]')
    .replace(/authorization\s*:\s*bearer\s+\S+/gi, '[secret retiré]')
    .replace(/(?:api[_ -]?key|bearer|token|password|secret)\s*[:=]\s*\S+/gi, '[secret retiré]')
    .replace(/\$\s?\d[\d\s,.]*/g, '[montant retiré]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function normalizedFailureText(task, attempt) {
  return redactedText([
    task.title,
    task.description ?? '',
    attempt?.outcome ?? 'failed',
    attempt?.outcome_summary ?? '',
  ].join(' ')).toLowerCase();
}

function classifyFailure(task, attempt) {
  const text = normalizedFailureText(task, attempt);
  if (/(?:mcp|model context protocol).{0,80}(?:not found|unknown|missing|unavailable|refused|failed)|(?:connection refused|econnrefused).{0,80}(?:3010|3011|3012|3013|3014|3015)/i.test(text)) {
    return {
      category: 'missing_or_unavailable_mcp',
      disposition: 'capability_request',
      remediation: 'Ne pas simuler le résultat du MCP. Vérifier les MCP préchargés, consigner le nom et l’erreur, puis demander une capacité approuvée si aucun outil existant ne couvre le besoin.',
    };
  }
  if (/(?:outil|tool).{0,80}(?:not found|unknown|missing|unavailable|not available)|(?:no such tool|unknown function)/i.test(text)) {
    return {
      category: 'missing_tool',
      disposition: 'capability_request',
      remediation: 'Vérifier d’abord les outils et compétences déjà chargés. Ne pas contourner les permissions ni installer un outil. Préparer une demande de capacité qui précise le résultat, les données et le moindre privilège requis.',
    };
  }
  if (/(?:compétence|skill).{0,80}(?:not found|unknown|missing|unavailable)|(?:no skill|skill unavailable)/i.test(text)) {
    return {
      category: 'missing_skill',
      disposition: 'instruction_candidate',
      remediation: 'Avant toute nouvelle tentative, parcourir les compétences préchargées et le répertoire de compétences de l’agent. Si aucune ne convient, documenter un protocole minimal, vérifiable et limité à la tâche.',
    };
  }
  if (/(?:unclear|ambiguous|clarif|insufficient context|not enough context|instruction.{0,30}(?:unclear|ambiguous)|précision|incomplet)/i.test(text)) {
    return {
      category: 'prompt_or_context_unclear',
      disposition: 'instruction_candidate',
      remediation: 'Avant d’agir, reformuler l’objectif, les livrables, les critères d’acceptation, les sources et les contraintes. Poser une question ciblée ou créer une sous-tâche de clarification plutôt que deviner.',
    };
  }
  if (attempt?.outcome === 'timed_out' || /(?:timeout|timed out|deadline exceeded|time limit)/i.test(text)) {
    return {
      category: 'timeout_or_capacity',
      disposition: 'instruction_candidate',
      remediation: 'Réduire la portée en sous-tâches vérifiables, limiter les sources au strict nécessaire et conserver les résultats intermédiaires. Ne pas relancer la même opération volumineuse sans changement de plan.',
    };
  }
  return {
    category: 'unclassified_execution_failure',
    disposition: 'instruction_candidate',
    remediation: 'Lire l’historique de tentatives, isoler une hypothèse à la fois, vérifier les préconditions et consigner une cause avant toute reprise. Ne jamais répéter automatiquement une tentative identique.',
  };
}

function proposalInstructions({ task, attempt, classification, signature }) {
  return [
    '---',
    `name: project-failure-lesson-${safeName(task.task_number)}-${signature.slice(0, 8)}`,
    'description: Prévenir la répétition d’un échec Project Hub déjà observé. Utiliser lorsqu’une tâche ressemble au cas décrit dans cette leçon approuvée.',
    '---',
    '',
    '# Leçon de remédiation Project Hub',
    '',
    `## Signature : ${signature.slice(0, 16)}`,
    '',
    `**Catégorie :** ${classification.category}`,
    '',
    '## Prévention obligatoire',
    '',
    classification.remediation,
    '',
    '## Signaux de référence',
    '',
    `- Tâche source : #${task.task_number} — ${redactedText(task.title)}`,
    `- Résultat de tentative : ${attempt?.outcome ?? 'failed'}`,
    `- Résumé dépersonnalisé : ${redactedText(attempt?.outcome_summary ?? 'Aucun résumé durable fourni.')}`,
    '',
    '## Limites',
    '',
    'Ne pas modifier la configuration, les modèles, les MCP, Docker, les permissions ou les données sources. Ne pas relancer une tâche échouée sans une différence explicite de plan et une validation humaine lorsque nécessaire.',
    '',
  ].join('\n');
}

async function apiRequest(relativePath, options = {}) {
  const response = await fetch(`${apiBase}${relativePath}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Spacebot API ${relativePath}: ${payload.error ?? response.status}`);
  return payload;
}

async function tasksWithPotentialFailure() {
  // L’issue d’un worker est durable avant toute modification éventuelle de la carte de tâche.
  // Lire les tâches non terminées évite de manquer un blocage ou un délai que Spacebot laisse in_progress.
  const payload = await apiRequest('/tasks?limit=500');
  return (payload.tasks ?? []).filter((task) => {
    const agentId = task.assigned_agent_id ?? task.owner_agent_id;
    return allowedAgents.has(agentId) && task.status !== 'done' && task.status !== 'pending_approval';
  });
}

async function latestActionableAttempt(taskNumber) {
  const payload = await apiRequest(`/tasks/${taskNumber}/attempts`);
  const latest = (payload.attempts ?? [])[0];
  return latest && actionableOutcomes.has(latest.outcome) ? latest : null;
}

function defaultState() {
  return { schema_version: 1, date: todayUtc(), proposals_created_today: 0, processed_attempt_ids: {}, signatures: {}, proposals: {} };
}
function normalizeState(state) {
  const result = state && typeof state === 'object' ? state : defaultState();
  if (result.date !== todayUtc()) {
    result.date = todayUtc();
    result.proposals_created_today = 0;
  }
  result.processed_attempt_ids ??= {};
  result.signatures ??= {};
  result.proposals ??= {};
  return result;
}

async function writeAudit(name, payload) {
  await writeJson(path.join(auditsRoot, `${safeName(name)}.json`), payload);
}

async function reconcileProposalDecisions(state) {
  for (const [proposalId, tracked] of Object.entries(state.proposals)) {
    const proposal = await readJson(tracked.proposal_path);
    if (!proposal) continue;
    const signature = state.signatures[tracked.signature];
    if (!signature) continue;
    if (proposal.status === 'approved_promoted') {
      signature.status = 'approved_lesson_active';
      signature.approved_at = proposal.approval_bridge?.promoted_at ?? nowIso();
    } else if (proposal.status === 'rejected_by_user') {
      signature.status = 'rejected_by_user';
      signature.rejected_at = proposal.approval_bridge?.rejected_at ?? nowIso();
    }
  }
}

async function createProposal(task, attempt, classification, signature, state) {
  const proposalId = `failure-${task.task_number}-${attempt?.attempt ?? 'task'}-${signature.slice(0, 12)}`;
  const proposalDir = path.join(proposalsRoot, proposalId);
  const candidatePath = path.join(proposalDir, 'candidate_SKILL.md');
  const proposalPath = path.join(proposalDir, 'proposal.json');
  const candidate = proposalInstructions({ task, attempt, classification, signature });
  const proposal = {
    proposal_id: proposalId,
    kind: 'failure_remediation',
    status: 'pending_approval',
    promotion: 'blocked_pending_user_approval',
    created_at: nowIso(),
    source_task_number: task.task_number,
    source_attempt_id: attempt?.id ?? null,
    source_attempt_number: attempt?.attempt ?? null,
    target_agent_id: task.assigned_agent_id ?? task.owner_agent_id,
    failure_category: classification.category,
    disposition: classification.disposition,
    signature,
    redacted_summary: redactedText(attempt?.outcome_summary ?? task.description ?? task.title),
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
  };
  await writeTextAtomic(candidatePath, candidate);
  await writeJson(proposalPath, proposal);
  state.proposals[proposalId] = { proposal_path: proposalPath, signature, source_task_number: task.task_number };
  state.proposals_created_today += 1;
  return { proposalId, proposalPath, proposalDir };
}

async function processFailure(task, attempt, state) {
  const eventId = String(attempt?.id ?? `task-${task.task_number}-${task.revision}`);
  if (state.processed_attempt_ids[eventId]) return { status: 'already_processed', event_id: eventId };
  const classification = classifyFailure(task, attempt);
  const signature = sha256(`${task.effective_agent_id ?? task.owner_agent_id}|${classification.category}|${normalizedFailureText(task, attempt).replace(/\d+/g, '#')}`);
  const record = state.signatures[signature] ?? { count: 0, category: classification.category, status: 'observed', task_numbers: [] };
  record.count += 1;
  record.last_seen_at = nowIso();
  record.task_numbers = [...new Set([...record.task_numbers, task.task_number])].slice(-20);
  state.signatures[signature] = record;
  state.processed_attempt_ids[eventId] = { task_number: task.task_number, signature, processed_at: nowIso() };

  if (record.count > 1) {
    record.status = 'repeat_suppressed';
    await writeAudit(`repeat-${task.task_number}-${eventId}`, {
      at: nowIso(), task_number: task.task_number, attempt_id: attempt?.id ?? null, signature,
      category: classification.category, action: 'repeat_suppressed_no_retry_or_new_learning_proposal',
    });
    return { status: 'repeat_suppressed', task_number: task.task_number, category: classification.category };
  }
  if (state.proposals_created_today >= maxProposalsPerDay) {
    record.status = 'daily_quota_reached';
    await writeAudit(`quota-${task.task_number}-${eventId}`, {
      at: nowIso(), task_number: task.task_number, attempt_id: attempt?.id ?? null, signature,
      category: classification.category, action: 'proposal_deferred_daily_quota', max_proposals_per_day: maxProposalsPerDay,
    });
    return { status: 'daily_quota_reached', task_number: task.task_number };
  }
  const proposal = await createProposal(task, attempt, classification, signature, state);
  record.status = 'pending_user_approval';
  record.proposal_id = proposal.proposalId;
  await writeAudit(`proposal-${task.task_number}-${eventId}`, {
    at: nowIso(), task_number: task.task_number, attempt_id: attempt?.id ?? null, signature,
    category: classification.category, action: 'candidate_created_pending_ui_approval', proposal_id: proposal.proposalId,
  });
  return { status: 'proposal_created', task_number: task.task_number, proposal_id: proposal.proposalId, category: classification.category };
}

async function scanAndDiagnose() {
  if (!enabled) return { status: 'disabled' };
  if (running) return { status: 'already_running' };
  running = true;
  try {
    await Promise.all([ensureDir(proposalsRoot), ensureDir(auditsRoot)]);
    const state = normalizeState(await readJson(statePath, defaultState()));
    await reconcileProposalDecisions(state);
    const tasks = await tasksWithPotentialFailure();
    const results = [];
    for (const task of tasks) {
      try {
        const attempt = await latestActionableAttempt(task.task_number);
        if (!attempt) {
          results.push({ status: 'no_actionable_attempt', task_number: task.task_number });
          continue;
        }
        results.push(await processFailure(task, attempt, state));
      } catch (error) {
        results.push({ status: 'error', task_number: task.task_number, error: String(error.message ?? error) });
      }
    }
    await writeJson(statePath, state);
    lastCycle = { status: 'completed', at: nowIso(), scanned_task_count: tasks.length, results };
    return lastCycle;
  } finally {
    running = false;
  }
}

app.get('/healthz', (_req, res) => res.status(200).json({
  status: 'ok', service: 'project-failure-remediator', enabled, interval_seconds: intervalSeconds,
  max_proposals_per_day: maxProposalsPerDay, api_base: apiBase, last_cycle: lastCycle,
}));
app.post('/internal/scan', async (req, res) => {
  if (!serviceToken || req.get('authorization') !== `Bearer ${serviceToken}`) {
    res.status(403).json({ error: 'Failure remediator scan not authorized' });
    return;
  }
  try { res.status(200).json(await scanAndDiagnose()); }
  catch (error) { res.status(422).json({ error: String(error.message ?? error) }); }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`project-failure-remediator listening on ${port}`);
  if (enabled) {
    setTimeout(() => scanAndDiagnose().catch((error) => console.warn(String(error))), 45_000);
    setInterval(() => scanAndDiagnose().catch((error) => console.warn(String(error))), intervalSeconds * 1000);
  }
});
