import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
const port = Number.parseInt(process.env.PORT ?? '3018', 10);
const workspace = process.env.PROJECT_HUB_WORKSPACE ?? '/workspace';
const enabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_MUNICIPAL_WATCH_ENABLED ?? 'true').trim().toLowerCase());
const intervalSeconds = Math.max(3_600, Number.parseInt(process.env.PROJECT_HUB_MUNICIPAL_WATCH_INTERVAL_SECONDS ?? '86400', 10) || 86_400);
const maxSources = Math.max(1, Math.min(30, Number.parseInt(process.env.PROJECT_HUB_MUNICIPAL_WATCH_MAX_SOURCES ?? '12', 10) || 12));
const runToken = process.env.PROJECT_HUB_MUNICIPAL_WATCH_TOKEN ?? '';
const allowTestHttp = process.env.PROJECT_HUB_MUNICIPAL_WATCH_ALLOW_TEST_HTTP === 'true';

const watchRoot = path.join(workspace, '00_systeme', 'veille-municipale');
const policyPath = path.join(watchRoot, 'municipal_watch_policy.approved.json');
const statePath = path.join(watchRoot, 'state.json');
const proposalsRoot = path.join(watchRoot, 'proposals');
const snapshotsRoot = path.join(watchRoot, 'snapshots');
let running = false;
let lastCycle = { status: 'not_started' };

function nowIso() { return new Date().toISOString(); }
function safeId(value) { return String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function enabledFlag(value) { return value === true; }
function redact(text) {
  return String(text ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[courriel masqué]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[téléphone masqué]')
    .replace(/\b(?:Bearer|Token)\s+[A-Za-z0-9._~+\/-]+=*\b/gi, '$1 [secret masqué]');
}
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
function normalizeHtml(html) {
  return String(html ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function requireApprovedPolicy(policy) {
  if (!policy || policy.schema_version !== 1 || policy.status !== 'approved' || !enabledFlag(policy.allow_municipal_watch)) {
    throw new Error('La veille est inactive tant que municipal_watch_policy.approved.json n’est pas présent, approuvé et autorise explicitement la veille.');
  }
  if (policy.auto_apply !== false || policy.auto_send !== false || policy.legal_conclusions !== false || policy.grant_submission !== false) {
    throw new Error('La politique doit interdire l’application automatique, l’envoi automatique, les conclusions juridiques et les soumissions de subvention.');
  }
  if (!Array.isArray(policy.sources)) throw new Error('La politique ne contient aucune liste de sources.');
  return policy.sources.slice(0, maxSources);
}
function validateSource(source) {
  const id = safeId(source?.id);
  const url = String(source?.url ?? '');
  const kind = String(source?.kind ?? 'regulatory');
  const localTestUrl = allowTestHttp && /^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(url);
  if (!id || id !== String(source?.id) || (!/^https:\/\//.test(url) && !localTestUrl)) throw new Error('Source invalide : id sûr et URL HTTPS obligatoires.');
  if (!['regulatory', 'municipal', 'funding'].includes(kind)) throw new Error(`Type de source non autorisé : ${kind}`);
  if (source?.enabled !== true) return null;
  return { id, url, kind, title: String(source.title ?? id).slice(0, 200), scope: String(source.scope ?? '').slice(0, 600) };
}
async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'ProjectHubMunicipalWatch/1.0 (+local administrative monitoring)' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!/text\/html|application\/xml|text\/xml|application\/json|text\/plain/i.test(contentType)) {
      throw new Error(`Format non surveillable automatiquement : ${contentType || 'inconnu'}`);
    }
    const raw = await response.text();
    const normalized = normalizeHtml(raw).slice(0, 300_000);
    if (!normalized) throw new Error('Contenu source vide après normalisation.');
    return {
      final_url: response.url,
      fetched_at: nowIso(),
      content_type: contentType,
      etag: response.headers.get('etag') ?? null,
      last_modified: response.headers.get('last-modified') ?? null,
      content_hash: sha256(normalized),
      excerpt: redact(normalized.slice(0, 1_600)),
    };
  } finally {
    clearTimeout(timeout);
  }
}
async function proposalStillPending(proposalId) {
  if (!proposalId) return false;
  const proposal = await readJson(path.join(proposalsRoot, safeId(proposalId), 'proposal.json'));
  return proposal?.status === 'pending_approval';
}
function proposalForChange(source, previous, current) {
  const proposalId = `municipal-watch-${source.id}-${Date.now()}`;
  return {
    schema_version: 1,
    kind: 'municipal_watch',
    proposal_id: proposalId,
    status: 'pending_approval',
    created_at: nowIso(),
    source: {
      id: source.id,
      title: source.title,
      url: source.url,
      final_url: current.final_url,
      kind: source.kind,
      scope: source.scope,
    },
    change: {
      previous_hash: previous.content_hash,
      current_hash: current.content_hash,
      previous_last_modified: previous.last_modified ?? null,
      current_last_modified: current.last_modified ?? null,
      detected_at: current.fetched_at,
      excerpt: current.excerpt,
    },
    required_human_review: true,
    constraints: {
      auto_apply: false,
      auto_send: false,
      legal_conclusions: false,
      grant_submission: false,
      config_change: false,
      model_change: false,
      mcp_change: false,
      docker_change: false,
      permissions_change: false,
    },
    next_step: source.kind === 'funding'
      ? 'Vérifier manuellement la pertinence, l’admissibilité, l’échéance et les documents de l’appel avant toute préparation de demande.'
      : 'Lire la source officielle, qualifier l’incidence possible, puis demander la revue administrative ou juridique compétente avant toute conclusion ou diffusion.',
  };
}
async function runWatch() {
  if (!enabled) return { status: 'disabled' };
  if (running) return { status: 'already_running' };
  running = true;
  try {
    const policy = await readJson(policyPath);
    if (!policy) {
      lastCycle = { status: 'waiting_for_approved_policy', at: nowIso(), policy_path: policyPath };
      return lastCycle;
    }
    const sources = requireApprovedPolicy(policy).map(validateSource).filter(Boolean);
    const state = await readJson(statePath, { schema_version: 1, sources: {} });
    const results = { baseline: [], changed: [], unchanged: [], skipped_pending: [], errors: [] };
    for (const source of sources) {
      try {
        const previous = state.sources?.[source.id];
        if (await proposalStillPending(previous?.pending_proposal_id)) {
          results.skipped_pending.push(source.id);
          continue;
        }
        const current = await fetchSource(source);
        const snapshotPath = path.join(snapshotsRoot, source.id, `${current.content_hash}.json`);
        await writeJson(snapshotPath, { source, ...current });
        if (!previous?.content_hash) {
          state.sources[source.id] = { ...source, ...current, baseline_at: nowIso(), pending_proposal_id: null };
          results.baseline.push(source.id);
        } else if (previous.content_hash === current.content_hash) {
          state.sources[source.id] = { ...previous, ...source, ...current, pending_proposal_id: null };
          results.unchanged.push(source.id);
        } else {
          const proposal = proposalForChange(source, previous, current);
          const proposalDir = path.join(proposalsRoot, safeId(proposal.proposal_id));
          await writeJson(path.join(proposalDir, 'proposal.json'), proposal);
          state.sources[source.id] = { ...previous, ...source, ...current, pending_proposal_id: proposal.proposal_id, last_change_at: nowIso() };
          results.changed.push({ source_id: source.id, proposal_id: proposal.proposal_id });
        }
      } catch (error) {
        results.errors.push({ source_id: source.id, error: redact(String(error.message ?? error)) });
      }
    }
    await writeJson(statePath, { ...state, schema_version: 1, updated_at: nowIso() });
    lastCycle = { status: 'completed', at: nowIso(), ...results };
    return lastCycle;
  } finally {
    running = false;
  }
}

app.get('/healthz', (_req, res) => res.status(200).json({
  status: 'ok', service: 'project-municipal-watch', enabled, interval_seconds: intervalSeconds,
  max_sources: maxSources, last_cycle: lastCycle,
}));
app.post('/internal/run', async (req, res) => {
  if (!runToken || req.get('authorization') !== `Bearer ${runToken}`) {
    res.status(403).json({ error: 'Municipal watch run not authorized' });
    return;
  }
  try { res.status(200).json(await runWatch()); }
  catch (error) { res.status(422).json({ error: redact(String(error.message ?? error)) }); }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`project-municipal-watch listening on ${port}`);
  if (enabled) {
    setTimeout(() => runWatch().catch((error) => console.warn(redact(String(error)))), 45_000);
    setInterval(() => runWatch().catch((error) => console.warn(redact(String(error)))), intervalSeconds * 1_000);
  }
});
