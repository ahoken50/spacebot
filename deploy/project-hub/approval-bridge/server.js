import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
app.use(express.json({ limit: '256kb' }));

const port = Number.parseInt(process.env.PORT ?? '3016', 10);
const workspace = process.env.PROJECT_HUB_WORKSPACE ?? '/data/shared-workspace';
const instanceRoot = process.env.PROJECT_HUB_INSTANCE_ROOT ?? '/data';
const apiBase = (process.env.PROJECT_HUB_SPACEBOT_API_URL ?? 'http://spacebot-project-hub:19898/api').replace(/\/$/, '');
const enabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_APPROVAL_BRIDGE_ENABLED ?? 'true').trim().toLowerCase());
const intervalSeconds = Math.max(15, Number.parseInt(process.env.PROJECT_HUB_APPROVAL_BRIDGE_INTERVAL_SECONDS ?? '60', 10) || 60);
const bridgeToken = process.env.PROJECT_HUB_APPROVAL_BRIDGE_TOKEN ?? '';
const createdBy = 'project-approval-bridge';
const ownerAgentId = 'project-coordination';

const optimizationRoot = path.join(workspace, '00_systeme', 'optimisation');
const bridgeRoot = path.join(optimizationRoot, 'approval-bridge');
const promotionsRoot = path.join(bridgeRoot, 'promotions');
const dspyTargets = new Set(['project-coordination', 'project-finance', 'project-planning', 'project-analysis', 'project-reporting', 'project-governance']);
const skillTargets = {
  'project-coordination': 'project-coordination',
  'project-finance-control': 'project-finance',
  'project-planning-governance': 'project-planning',
  'project-analysis': 'project-analysis',
  'project-reporting': 'project-reporting',
  'project-governance': 'project-governance',
  'project-document-studio': 'project-coordination',
};
const failureTargets = new Set(['project-coordination', 'project-finance', 'project-planning', 'project-analysis', 'project-reporting', 'project-governance']);
const approvedOverlayRoot = path.join(instanceRoot, 'approved-skill-overlays');
const skillInstallAuthorizationRoot = path.join(instanceRoot, 'skill-install-authorizations');

let lastCycle = { status: 'not_started' };
let running = false;

function nowIso() { return new Date().toISOString(); }
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]/g, '_'); }
function isWithin(child, parent) { return child === parent || child.startsWith(`${parent}${path.sep}`); }
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
  return new Map((payload.tasks ?? []).map((task) => [String(task.metadata?.project_hub_approval?.proposal_id ?? ''), task]));
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
function summarizeFailureRemediation(proposal) {
  return [
    `Leçon de prévention ${proposal.proposal_id} issue de la tâche échouée #${proposal.source_task_number}.`,
    `Catégorie diagnostiquée : ${proposal.failure_category ?? 'non classée'}.`,
    `La candidate ne modifie ni MCP, ni outils, ni modèles, ni Docker, ni permissions; elle documente une conduite à tenir pour éviter une répétition identique.`,
  ].join(' ');
}
function summarizeCapabilitySkill(proposal) {
  return [
    `Demande de compétence externe ${proposal.proposal_id} pour ${proposal.target_agent_id}.`,
    `Source proposée : ${proposal.skill_source}.`,
    `L’approbation autorise uniquement l’agent ciblé à utiliser install_skill dans son workspace; elle n’autorise ni MCP, ni dépendance système, ni secret, ni permission ou changement Docker.`,
  ].join(' ');
}
function proposalRequiresReview(proposal) {
  return proposal?.proposal_id && !['approved_promoted', 'approved_for_agent_install', 'rejected_by_user', 'installed_after_approval'].includes(proposal.status);
}
function taskDescription(kind, proposal, proposalPath, proposalDir) {
  const summary = kind === 'dspy'
    ? summarizeDspy(proposal)
    : kind === 'skillopt'
      ? summarizeSkillOpt(proposal)
      : kind === 'failure_remediation'
        ? summarizeFailureRemediation(proposal)
        : summarizeCapabilitySkill(proposal);
  const decisionText = kind === 'capability_skill_acquisition'
    ? '**Approuver** autorise uniquement l’agent ciblé à installer cette compétence avec l’outil natif `install_skill` dans son workspace, après une dernière vérification. Le pont n’installe aucun code et ne change aucune capacité système. **Dismiss/Rejeter** replace la tâche dans le backlog et conserve les artefacts sans installation.'
    : '**Approuver** dans l’interface applique uniquement cette candidate contrôlée et consigne un audit local. **Dismiss/Rejeter** replace la tâche dans le backlog et conserve les artefacts sans les appliquer.';
  return [
    '## Approbation finale requise',
    '',
    summary,
    '',
    `- Proposition : \`${proposalPath}\``,
    `- Artefacts de revue : \`${proposalDir}\``,
    `- Statut de promotion : **bloqué jusqu’à votre approbation**`,
    '',
    decisionText,
  ].join('\n');
}

async function discoverProposals() {
  const dspyDirectory = path.join(optimizationRoot, 'propositions');
  const skilloptDirectory = path.join(optimizationRoot, 'skillopt', 'propositions');
  const failureDirectory = path.join(optimizationRoot, 'failure-remediator', 'proposals');
  const capabilityDirectory = path.join(workspace, '00_systeme', 'propositions_capacites');
  const proposals = [];
  for (const filename of await fs.readdir(dspyDirectory).catch(() => [])) {
    if (!filename.endsWith('.json')) continue;
    const proposalPath = path.join(dspyDirectory, filename);
    const proposal = await readJson(proposalPath);
    if (proposalRequiresReview(proposal)) {
      proposals.push({ kind: 'dspy', proposalPath, proposalDir: dspyDirectory, proposal });
    }
  }
  for (const directory of await fs.readdir(skilloptDirectory).catch(() => [])) {
    const proposalDir = path.join(skilloptDirectory, directory);
    const proposalPath = path.join(proposalDir, 'proposal.json');
    const proposal = await readJson(proposalPath);
    if (proposalRequiresReview(proposal)) {
      proposals.push({ kind: 'skillopt', proposalPath, proposalDir, proposal });
    }
  }
  for (const directory of await fs.readdir(failureDirectory).catch(() => [])) {
    const proposalDir = path.join(failureDirectory, directory);
    const proposalPath = path.join(proposalDir, 'proposal.json');
    const proposal = await readJson(proposalPath);
    if (proposal?.kind === 'failure_remediation' && proposalRequiresReview(proposal)) {
      proposals.push({ kind: 'failure_remediation', proposalPath, proposalDir, proposal });
    }
  }
  for (const filename of await fs.readdir(capabilityDirectory).catch(() => [])) {
    if (!filename.endsWith('.json')) continue;
    const proposalPath = path.join(capabilityDirectory, filename);
    const proposal = await readJson(proposalPath);
    if (proposal?.kind === 'capability_skill_acquisition' && proposalRequiresReview(proposal)) {
      proposals.push({ kind: 'capability_skill_acquisition', proposalPath, proposalDir: capabilityDirectory, proposal });
    }
  }
  return proposals.sort((left, right) => String(left.proposal.created_at).localeCompare(String(right.proposal.created_at)));
}

async function createApprovalTask(record) {
  const { kind, proposal, proposalPath, proposalDir } = record;
  const label = kind === 'dspy' ? 'DSPy' : kind === 'skillopt' ? 'SkillOpt' : kind === 'failure_remediation' ? 'Leçon après échec' : 'Compétence externe';
  const title = `${label} — approbation finale : ${proposal.proposal_id}`;
  const metadata = {
    project_hub_approval: {
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
      edit_summary: `Demande d’approbation Project Hub créée pour ${proposal.proposal_id}`,
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

function runtimeSkillPath(targetAgent, skillId) {
  return path.join(instanceRoot, 'agents', targetAgent, 'workspace', 'skills', skillId, 'SKILL.md');
}
function overlaySkillPath(targetAgent, skillId) {
  return path.join(approvedOverlayRoot, targetAgent, skillId, 'SKILL.md');
}
async function persistAndInstallSkill(targetAgent, skillId, content) {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  const persistentPath = overlaySkillPath(targetAgent, skillId);
  const runtimePath = runtimeSkillPath(targetAgent, skillId);
  await writeTextAtomic(persistentPath, normalized);
  await writeTextAtomic(runtimePath, normalized);
  return { target_path: runtimePath, persistent_overlay_path: persistentPath, target_agent_id: targetAgent };
}

async function promoteDspy(record, task) {
  const { proposal } = record;
  const instructions = proposal.best_candidate?.instructions;
  if (!instructions || typeof instructions !== 'object' || !Object.keys(instructions).length) {
    throw new Error('La proposition DSPy ne contient aucune instruction candidate.');
  }
  const targetAgent = String(proposal.agent_id ?? '');
  if (!dspyTargets.has(targetAgent)) throw new Error('Agent cible DSPy invalide, absent ou non autorisé.');
  const skillId = 'project-approved-dspy-instructions';
  let existing = '';
  try { existing = await fs.readFile(overlaySkillPath(targetAgent, skillId), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const body = [
    existing.trim(),
    `## Proposition approuvée ${proposal.proposal_id}`,
    '',
    `Approuvée dans l’interface Spacebot par \`${task.approved_by ?? 'human'}\` le ${nowIso()}.`,
    'Appliquer cette instruction uniquement aux tâches correspondant aux cas de référence ci-dessous; ne pas élargir sa portée sans une nouvelle proposition.',
    '',
    ...Object.entries(instructions).flatMap(([caseId, instruction]) => [`### Cas ${caseId}`, String(instruction).trim(), '']),
  ].filter(Boolean).join('\n');
  return persistAndInstallSkill(targetAgent, skillId, body);
}

async function promoteSkillOpt(record) {
  const { proposal, proposalDir } = record;
  const targetAgent = skillTargets[proposal.skill_id];
  if (!targetAgent) throw new Error(`Compétence SkillOpt non autorisée pour promotion : ${proposal.skill_id}`);
  const candidatePath = path.join(proposalDir, 'candidate_SKILL.md');
  const candidate = await fs.readFile(candidatePath, 'utf8');
  if (!candidate.trim()) throw new Error('La candidate SkillOpt est vide.');
  const result = await persistAndInstallSkill(targetAgent, proposal.skill_id, candidate);
  return { ...result, candidate_path: candidatePath };
}

function stripFrontmatter(candidate) {
  return candidate.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
}
function validSkillSource(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/.test(String(value ?? ''));
}
async function promoteFailureRemediation(record, task) {
  const { proposal, proposalDir } = record;
  const targetAgent = String(proposal.target_agent_id ?? '');
  if (!failureTargets.has(targetAgent)) throw new Error('Agent cible de la leçon invalide ou non autorisé.');
  const constraints = proposal.constraints ?? {};
  for (const field of ['auto_promote', 'config_change', 'model_change', 'mcp_change', 'docker_change', 'permissions_change', 'source_data_access']) {
    if (constraints[field] !== false) throw new Error(`Contrôle de sécurité invalide pour la leçon : ${field}.`);
  }
  const candidatePath = path.resolve(String(proposal.candidate_path ?? ''));
  const permittedDir = path.resolve(proposalDir);
  if (!isWithin(candidatePath, permittedDir) || path.basename(candidatePath) !== 'candidate_SKILL.md') {
    throw new Error('Chemin de candidate de leçon non autorisé.');
  }
  const candidate = await fs.readFile(candidatePath, 'utf8');
  const lesson = stripFrontmatter(candidate);
  if (!lesson || lesson.length > 8000) throw new Error('Leçon candidate vide ou trop volumineuse.');
  const skillId = 'project-failure-lessons';
  let existing = '';
  try { existing = await fs.readFile(overlaySkillPath(targetAgent, skillId), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const header = [
    '---',
    'name: project-failure-lessons',
    'description: Leçons Project Hub approuvées après des échecs de tâche. Utiliser pour éviter de répéter une erreur, un blocage ou une préparation insuffisante déjà observés.',
    '---',
    '',
    '# Leçons approuvées après échec',
  ].join('\n');
  const body = existing.trim() || header;
  const updated = [body, '', `## ${proposal.proposal_id}`, '', `Approuvée dans l’interface Spacebot par \`${task.approved_by ?? 'human'}\` le ${nowIso()}.`, '', lesson].join('\n');
  const result = await persistAndInstallSkill(targetAgent, skillId, updated);
  return { ...result, candidate_path: candidatePath, source_task_number: proposal.source_task_number };
}

function capabilityAuthorizationPath(proposalId) {
  return path.join(skillInstallAuthorizationRoot, `${safeName(proposalId)}.json`);
}

async function authorizeCapabilitySkill(record, task) {
  const { proposal } = record;
  const targetAgent = String(proposal.target_agent_id ?? '');
  const source = String(proposal.skill_source ?? '');
  if (!failureTargets.has(targetAgent)) throw new Error('Agent cible de compétence externe invalide ou non autorisé.');
  if (!validSkillSource(source)) throw new Error('Source de compétence externe invalide; utiliser owner/repo ou owner/repo/skill-name.');
  const constraints = proposal.constraints ?? {};
  for (const field of ['mcp_change', 'model_change', 'docker_change', 'permissions_change', 'secret_change', 'system_dependency_change']) {
    if (constraints[field] !== false) throw new Error(`Contrôle de sécurité invalide pour la compétence externe : ${field}.`);
  }
  if (constraints.workspace_skill_only !== true) throw new Error('La compétence externe doit rester limitée au workspace de l’agent.');
  proposal.status = 'approved_for_agent_install';
  proposal.promotion = 'approved_install_authorization_only';
  proposal.approval_bridge = {
    ...(proposal.approval_bridge ?? {}), task_number: task.task_number,
    approved_by: task.approved_by ?? 'human', approved_at: task.approved_at ?? nowIso(), authorized_at: nowIso(),
    target_agent_id: targetAgent, skill_source: source,
  };
  await writeJson(record.proposalPath, proposal);
  const authorizationPath = capabilityAuthorizationPath(proposal.proposal_id);
  await writeJson(authorizationPath, {
    schema_version: 1,
    kind: 'capability_skill_install_authorization',
    status: 'approved_for_agent_install',
    proposal_id: proposal.proposal_id,
    task_number: task.task_number,
    target_agent_id: targetAgent,
    skill_source: source,
    workspace_skill_only: true,
    approved_by: task.approved_by ?? 'human',
    approved_at: task.approved_at ?? nowIso(),
    authorized_at: nowIso(),
  });
  await writePromotionAudit(proposal.proposal_id, {
    proposal_id: proposal.proposal_id, kind: record.kind, task_number: task.task_number,
    approved_by: task.approved_by ?? 'human', authorized_at: nowIso(), target_agent_id: targetAgent,
    skill_source: source, authorization_path: authorizationPath, promotion: 'approved_install_authorization_only',
  });
  return { target_agent_id: targetAgent, skill_source: source, authorization_path: authorizationPath, authorization: 'agent_must_call_install_skill_in_own_workspace' };
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
  if (record.kind === 'capability_skill_acquisition') {
    const result = await authorizeCapabilitySkill(record, task);
    await finishTask(task, `Compétence ${result.skill_source} autorisée pour installation contrôlée par ${result.target_agent_id}.`);
    return result;
  }
  const result = record.kind === 'dspy'
    ? await promoteDspy(record, task)
    : record.kind === 'skillopt'
      ? await promoteSkillOpt(record, task)
      : await promoteFailureRemediation(record, task);
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
  status: 'ok', service: 'project-approval-bridge', enabled, interval_seconds: intervalSeconds,
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
  console.log(`project-approval-bridge listening on ${port}`);
  if (enabled) {
    setTimeout(() => scanAndReconcile().catch((error) => console.warn(String(error))), 30_000);
    setInterval(() => scanAndReconcile().catch((error) => console.warn(String(error))), intervalSeconds * 1000);
  }
});
