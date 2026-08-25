import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
app.use(express.json({ limit: '256kb' }));

const port = Number.parseInt(process.env.PORT ?? '3016', 10);
const workspace = process.env.OASIS_WORKSPACE ?? '/data/shared-workspace';
const instanceRoot = process.env.OASIS_INSTANCE_ROOT ?? '/data';
const apiBase = (process.env.OASIS_SPACEBOT_API_URL ?? 'http://spacebot-oasis-v2:19898/api').replace(/\/$/, '');
const enabled = !['0', 'false', 'no', 'off'].includes((process.env.OASIS_APPROVAL_BRIDGE_ENABLED ?? 'true').trim().toLowerCase());
const intervalSeconds = Math.max(15, Number.parseInt(process.env.OASIS_APPROVAL_BRIDGE_INTERVAL_SECONDS ?? '60', 10) || 60);
const bridgeToken = process.env.OASIS_APPROVAL_BRIDGE_TOKEN ?? '';
const createdBy = 'oasis-approval-bridge';
const ownerAgentId = 'oasis-coordination';

const optimizationRoot = path.join(workspace, '00_systeme', 'optimisation');
const bridgeRoot = path.join(optimizationRoot, 'approval-bridge');
const promotionsRoot = path.join(bridgeRoot, 'promotions');
const dspyTargets = new Set(['oasis-coordination', 'oasis-finances', 'oasis-calendrier', 'oasis-pse-sig', 'oasis-reddition', 'oasis-gouvernance']);
const skillTargets = {
  'oasis-coordination': 'oasis-coordination',
  'oasis-financial-control': 'oasis-finances',
  'oasis-schedule-governance': 'oasis-calendrier',
  'oasis-pse-sig': 'oasis-pse-sig',
  'oasis-reporting': 'oasis-reddition',
  'oasis-governance': 'oasis-gouvernance',
  'oasis-document-studio': 'oasis-coordination',
};

let lastCycle = { status: 'not_started' };
let running = false;

function nowIso() { return new Date().toISOString(); }
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]/g, '_'); }
function isApprovedTask(task) { return task?.status === 'ready'; }
function isRejectedTask(task) { return task?.status === 'backlog'; }

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

async function apiRequest(relativePath, options = {}) {
  const response = await fetch(`${apiBase}${relativePath}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Spacebot API ${relativePath}: ${payload.error ?? response.status}`);
  return payload;
}

async function listBridgeTasks() {
  const payload = await apiRequest(`/tasks?created_by=${encodeURIComponent(createdBy)}&limit=500`);
  return new Map((payload.tasks ?? []).map((task) => [String(task.metadata?.oasis_approval?.proposal_id ?? ''), task]));
}

function summarizeDspy(proposal) {
  const best = proposal.best_candidate ?? {};
  return [
    `Proposition DSPy ${proposal.proposal_id}.`,
    `Score de base : ${proposal.baseline?.mean_score ?? 'n/d'}; meilleure candidate : ${best.mean_score ?? 'n/d'}; amélioration : ${proposal.improvement ?? 'n/d'}.`,
    `Cas de référence : ${proposal.reference_case_count ?? 'n/d'}; budget d’appels : ${proposal.call_budget?.planned ?? 'n/d'} / ${proposal.call_budget?.limit ?? 'n/d'}.`,
  ].join(' ');
}
function summarizeSkillOpt(proposal) {
  const partitions = proposal.reference_partitions ?? {};
  return [
    `Proposition SkillOpt ${proposal.proposal_id} pour la compétence ${proposal.skill_id}.`,
    `Modification détectée : ${proposal.candidate_changed === true ? 'oui' : 'non'}.`,
    `Partitions indépendantes : apprentissage ${partitions.training ?? 0}, validation ${partitions.validation ?? 0}, contrôle final ${partitions.holdout ?? 0}.`,
  ].join(' ');
}
function taskDescription(kind, proposal, proposalPath, proposalDir) {
  const summary = kind === 'dspy' ? summarizeDspy(proposal) : summarizeSkillOpt(proposal);
  return [
    '## Approbation finale requise',
    '',
    summary,
    '',
    `- Proposition : \`${proposalPath}\``,
    `- Artefacts de revue : \`${proposalDir}\``,
    `- Statut de promotion : **bloqué jusqu’à votre approbation**`,
    '',
    '**Approuver** dans l’interface applique uniquement cette candidate contrôlée et consigne un audit local. **Dismiss/Rejeter** replace la tâche dans le backlog et conserve les artefacts sans les appliquer.',
  ].join('\n');
}

async function discoverProposals() {
  const dspyDirectory = path.join(optimizationRoot, 'propositions');
  const skilloptDirectory = path.join(optimizationRoot, 'skillopt', 'propositions');
  const proposals = [];
  for (const filename of await fs.readdir(dspyDirectory).catch(() => [])) {
    if (!filename.endsWith('.json')) continue;
    const proposalPath = path.join(dspyDirectory, filename);
    const proposal = await readJson(proposalPath);
    if (proposal?.proposal_id && proposal.status !== 'approved_promoted' && proposal.status !== 'rejected_by_user') {
      proposals.push({ kind: 'dspy', proposalPath, proposalDir: dspyDirectory, proposal });
    }
  }
  for (const directory of await fs.readdir(skilloptDirectory).catch(() => [])) {
    const proposalDir = path.join(skilloptDirectory, directory);
    const proposalPath = path.join(proposalDir, 'proposal.json');
    const proposal = await readJson(proposalPath);
    if (proposal?.proposal_id && proposal.status !== 'approved_promoted' && proposal.status !== 'rejected_by_user') {
      proposals.push({ kind: 'skillopt', proposalPath, proposalDir, proposal });
    }
  }
  return proposals.sort((left, right) => String(left.proposal.created_at).localeCompare(String(right.proposal.created_at)));
}

async function createApprovalTask(record) {
  const { kind, proposal, proposalPath, proposalDir } = record;
  const title = `${kind === 'dspy' ? 'DSPy' : 'SkillOpt'} — approbation finale : ${proposal.proposal_id}`;
  const metadata = {
    oasis_approval: {
      proposal_id: proposal.proposal_id,
      proposal_kind: kind,
      proposal_path: proposalPath,
      proposal_dir: proposalDir,
      promotion: 'blocked_pending_user_approval',
    },
  };
  const payload = await apiRequest('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      owner_agent_id: ownerAgentId,
      assigned_agent_id: ownerAgentId,
      title,
      description: taskDescription(kind, proposal, proposalPath, proposalDir),
      priority: 'high',
      metadata,
      created_by: createdBy,
      author_type: 'system',
      author_id: createdBy,
      source: 'api',
      edit_summary: `Demande d’approbation OASIS créée pour ${proposal.proposal_id}`,
    }),
  });
  proposal.approval_bridge = {
    task_number: payload.task.task_number,
    created_at: nowIso(),
    status: 'pending_user_approval',
  };
  proposal.status = 'pending_approval';
  proposal.promotion = 'blocked_pending_user_approval';
  await writeJson(proposalPath, proposal);
  return payload.task;
}

async function writePromotionAudit(proposalId, payload) {
  await writeJson(path.join(promotionsRoot, `${safeName(proposalId)}.json`), payload);
}

async function promoteDspy(record, task) {
  const { proposal, proposalPath } = record;
  const instructions = proposal.best_candidate?.instructions;
  if (!instructions || typeof instructions !== 'object' || !Object.keys(instructions).length) {
    throw new Error('La proposition DSPy ne contient aucune instruction candidate.');
  }
  const targetAgent = String(proposal.agent_id ?? '');
  if (!dspyTargets.has(targetAgent)) throw new Error('Agent cible DSPy invalide, absent ou non autorisé.');
  const targetPath = path.join(instanceRoot, 'agents', targetAgent, 'workspace', 'skills', 'oasis-approved-dspy-instructions', 'SKILL.md');
  let existing = '';
  try { existing = await fs.readFile(targetPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const body = [
    existing.trim(),
    `## Proposition approuvée ${proposal.proposal_id}`,
    '',
    `Approuvée dans l’interface Spacebot par \`${task.approved_by ?? 'human'}\` le ${nowIso()}.`,
    'Appliquer cette instruction uniquement aux tâches correspondant aux cas de référence ci-dessous; ne pas élargir sa portée sans une nouvelle proposition.',
    '',
    ...Object.entries(instructions).flatMap(([caseId, instruction]) => [`### Cas ${caseId}`, String(instruction).trim(), '']),
  ].filter(Boolean).join('\n');
  await writeTextAtomic(targetPath, `${body}\n`);
  return { target_path: targetPath, target_agent_id: targetAgent };
}

async function promoteSkillOpt(record, task) {
  const { proposal, proposalDir } = record;
  const targetAgent = skillTargets[proposal.skill_id];
  if (!targetAgent) throw new Error(`Compétence SkillOpt non autorisée pour promotion : ${proposal.skill_id}`);
  const candidatePath = path.join(proposalDir, 'candidate_SKILL.md');
  const candidate = await fs.readFile(candidatePath, 'utf8');
  if (!candidate.trim()) throw new Error('La candidate SkillOpt est vide.');
  const targetPath = path.join(instanceRoot, 'agents', targetAgent, 'workspace', 'skills', proposal.skill_id, 'SKILL.md');
  await writeTextAtomic(targetPath, candidate.endsWith('\n') ? candidate : `${candidate}\n`);
  return { target_path: targetPath, target_agent_id: targetAgent, candidate_path: candidatePath };
}

async function updateTask(taskNumber, expectedRevision, status, summary) {
  return apiRequest(`/tasks/${taskNumber}`, {
    method: 'PUT',
    body: JSON.stringify({
      status,
      expected_revision: expectedRevision,
      author_type: 'system',
      author_id: createdBy,
      source: 'api',
      edit_summary: summary,
    }),
  });
}

async function finishTask(task, summary) {
  let current = task;
  if (current.status === 'ready') {
    const started = await updateTask(current.task_number, current.revision, 'in_progress', `Exécution contrôlée : ${summary}`);
    current = started.task;
  }
  if (current.status === 'in_progress') {
    await updateTask(current.task_number, current.revision, 'done', summary);
  }
}

async function applyApprovedProposal(record, task) {
  const result = record.kind === 'dspy' ? await promoteDspy(record, task) : await promoteSkillOpt(record, task);
  record.proposal.status = 'approved_promoted';
  record.proposal.promotion = 'applied_after_spacebot_ui_approval';
  record.proposal.approval_bridge = {
    ...(record.proposal.approval_bridge ?? {}), task_number: task.task_number,
    approved_by: task.approved_by ?? 'human', approved_at: task.approved_at ?? nowIso(),
    promoted_at: nowIso(), result,
  };
  await writeJson(record.proposalPath, record.proposal);
  await writePromotionAudit(record.proposal.proposal_id, {
    proposal_id: record.proposal.proposal_id, kind: record.kind, task_number: task.task_number,
    approved_by: task.approved_by ?? 'human', promoted_at: nowIso(), result,
    promotion: 'applied_after_spacebot_ui_approval',
  });
  await finishTask(task, `Proposition ${record.proposal.proposal_id} appliquée après approbation dans l’interface.`);
  return result;
}

async function markRejected(record, task) {
  record.proposal.status = 'rejected_by_user';
  record.proposal.promotion = 'blocked_rejected_in_spacebot_ui';
  record.proposal.approval_bridge = {
    ...(record.proposal.approval_bridge ?? {}), task_number: task.task_number,
    rejected_at: nowIso(), task_status: task.status,
  };
  await writeJson(record.proposalPath, record.proposal);
  await writePromotionAudit(record.proposal.proposal_id, {
    proposal_id: record.proposal.proposal_id, kind: record.kind, task_number: task.task_number,
    rejected_at: nowIso(), promotion: 'blocked_rejected_in_spacebot_ui',
  });
}

async function scanAndReconcile() {
  if (!enabled) return { status: 'disabled' };
  if (running) return { status: 'already_running' };
  running = true;
  try {
    const [records, tasks] = await Promise.all([discoverProposals(), listBridgeTasks()]);
    const results = { created: [], promoted: [], rejected: [], pending: [], errors: [] };
    for (const record of records) {
      try {
        let task = tasks.get(String(record.proposal.proposal_id));
        if (!task) {
          task = await createApprovalTask(record);
          results.created.push({ proposal_id: record.proposal.proposal_id, task_number: task.task_number });
          continue;
        }
        if (isApprovedTask(task)) {
          const result = await applyApprovedProposal(record, task);
          results.promoted.push({ proposal_id: record.proposal.proposal_id, task_number: task.task_number, result });
        } else if (isRejectedTask(task)) {
          await markRejected(record, task);
          results.rejected.push({ proposal_id: record.proposal.proposal_id, task_number: task.task_number });
        } else {
          results.pending.push({ proposal_id: record.proposal.proposal_id, task_number: task.task_number, status: task.status });
        }
      } catch (error) {
        results.errors.push({ proposal_id: record.proposal.proposal_id, error: String(error.message ?? error) });
      }
    }
    lastCycle = { status: 'completed', at: nowIso(), ...results };
    return lastCycle;
  } finally {
    running = false;
  }
}

app.get('/healthz', (_req, res) => res.status(200).json({
  status: 'ok', service: 'oasis-approval-bridge', enabled, interval_seconds: intervalSeconds,
  api_base: apiBase, last_cycle: lastCycle,
}));
app.post('/internal/scan', async (req, res) => {
  if (!bridgeToken || req.get('authorization') !== `Bearer ${bridgeToken}`) {
    res.status(403).json({ error: 'Approval bridge scan not authorized' });
    return;
  }
  try { res.status(200).json(await scanAndReconcile()); }
  catch (error) { res.status(422).json({ error: String(error.message ?? error) }); }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`oasis-approval-bridge listening on ${port}`);
  if (enabled) {
    setTimeout(() => scanAndReconcile().catch((error) => console.warn(String(error))), 30_000);
    setInterval(() => scanAndReconcile().catch((error) => console.warn(String(error))), intervalSeconds * 1000);
  }
});
