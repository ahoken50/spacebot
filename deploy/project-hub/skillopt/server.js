import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const port = Number.parseInt(process.env.PORT ?? '3014', 10);
const workspace = process.env.PROJECT_HUB_WORKSPACE ?? '/data/shared-workspace';
const runnerPath = new URL('./skillopt_runner.py', import.meta.url).pathname;
const enabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_SKILLOPT_ENABLED ?? 'true').trim().toLowerCase());
const autonomousEnabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_SKILLOPT_AUTONOMOUS_ENABLED ?? 'true').trim().toLowerCase());
const autonomousIntervalHours = Math.max(1, Number.parseInt(process.env.PROJECT_HUB_SKILLOPT_INTERVAL_HOURS ?? '24', 10) || 24);
const autonomousPipelineToken = process.env.PROJECT_HUB_AUTONOMOUS_PIPELINE_TOKEN ?? '';

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function runSkillOpt(args, overrides = {}) {
  const { stdout, stderr } = await execFileAsync('python3', [runnerPath, ...args], {
    env: { ...process.env, PROJECT_HUB_WORKSPACE: workspace, ...overrides },
    timeout: 660_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const raw = stdout.trim() || stderr.trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Réponse non structurée de SkillOpt : ${raw.slice(0, 1000)}`);
  }
}

async function autonomousCycle() {
  if (!enabled || !autonomousEnabled) return;
  try {
    const result = await runSkillOpt(['autonomous']);
    console.log(JSON.stringify({ event: 'skillopt_autonomous_cycle', ...result }));
  } catch (error) {
    // L’absence d’un pack approuvé ne dégrade pas le service MCP; aucun appel LLM n’a alors été effectué.
    console.warn(JSON.stringify({ event: 'skillopt_autonomous_cycle_error', message: String(error.message ?? error) }));
  }
}

function createServer() {
  const server = new McpServer({ name: 'project-skillopt', version: '0.1.0' });

  server.registerTool(
    'skillopt_status',
    { description: 'Consulter l’état de SkillOpt, le jeu de référence, les propositions de compétences et les plafonds. Aucun appel de modèle.', inputSchema: {} },
    async () => textResult(await runSkillOpt(['status'])),
  );

  server.registerTool(
    'skillopt_validate_reference_pack',
    { description: 'Valider le jeu SkillOpt dépersonnalisé et approuvé, incluant les partitions séparées apprentissage, validation et contrôle final. Aucun appel de modèle.', inputSchema: {} },
    async () => textResult(await runSkillOpt(['validate'])),
  );

  if (enabled) {
    server.registerTool(
      'skillopt_learn',
      {
        description: 'Lancer une amélioration SkillOpt strictement bornée d’une seule compétence autorisée à partir d’un jeu approuvé. Produit seulement une proposition pending_approval avec un diff et des scores; ne modifie jamais la production.',
        inputSchema: {
          confirm_approved_reference_pack: z.literal(true).describe('Confirmer que le jeu est approuvé, dépersonnalisé, séparé en partitions et ne contient aucune pièce municipale confidentielle.'),
        },
      },
      async () => textResult(await runSkillOpt(['learn'])),
    );

    server.registerTool(
      'skillopt_autonomous_cycle',
      {
        description: 'Déclencher immédiatement le cycle autonome SkillOpt. Il s’arrête sans appel de modèle si le pack n’autorise pas autonomous_learning, si la limite quotidienne est atteinte ou si le jeu n’est pas valide.',
        inputSchema: {
          confirm_autonomous_learning_scope: z.literal(true).describe('Confirmer que le cycle est limité aux compétences autorisées, aux cas dépersonnalisés et à des propositions sans promotion automatique.'),
        },
      },
      async () => textResult(await runSkillOpt(['autonomous'])),
    );
  }

  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.post('/internal/autonomous-run', async (req, res) => {
  if (!enabled || !autonomousPipelineToken || req.get('authorization') !== `Bearer ${autonomousPipelineToken}`) {
    res.status(403).json({ error: 'Autonomous pipeline not authorized' });
    return;
  }
  const referencePackPath = String(req.body?.reference_pack_path ?? '');
  if (!referencePackPath.startsWith(`${workspace}/00_systeme/optimisation/reference-miner/`)) {
    res.status(400).json({ error: 'Invalid autonomous reference pack path' });
    return;
  }
  try {
    const result = await runSkillOpt(['autonomous'], {
      PROJECT_HUB_SKILLOPT_REFERENCE_PACK_PATH: referencePackPath,
      PROJECT_HUB_SKILLOPT_ALLOW_AUTONOMOUS_PACKS: 'true',
    });
    res.status(200).json({ status: 'completed', promotion: 'blocked_pending_human_approval', result });
  } catch (error) {
    res.status(422).json({ status: 'failed', error: String(error.message ?? error) });
  }
});

app.get('/healthz', (_req, res) => res.status(200).json({
  status: 'ok',
  service: 'project-skillopt',
  enabled,
  autonomous_enabled: autonomousEnabled,
  interval_hours: autonomousIntervalHours,
  autonomous_pipeline: Boolean(autonomousPipelineToken),
}));
app.listen(port, '0.0.0.0', () => {
  console.log(`project-skillopt listening on ${port}`);
  if (enabled && autonomousEnabled) {
    const intervalMs = autonomousIntervalHours * 60 * 60 * 1000;
    setTimeout(autonomousCycle, 30_000);
    setInterval(autonomousCycle, intervalMs);
  }
});
