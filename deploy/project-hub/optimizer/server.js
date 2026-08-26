import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const port = Number.parseInt(process.env.PORT ?? '3013', 10);
const workspace = process.env.PROJECT_HUB_WORKSPACE ?? '/data/shared-workspace';
const optimizerPath = new URL('./optimizer.py', import.meta.url).pathname;
const optimizerEnabled = !['0', 'false', 'no', 'off'].includes((process.env.PROJECT_HUB_OPTIMIZER_ENABLED ?? 'true').trim().toLowerCase());
const autonomousPipelineToken = process.env.PROJECT_HUB_AUTONOMOUS_PIPELINE_TOKEN ?? '';

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function runOptimizer(args, overrides = {}) {
  const { stdout, stderr } = await execFileAsync('python3', [optimizerPath, ...args], {
    env: { ...process.env, PROJECT_HUB_WORKSPACE: workspace, ...overrides },
    timeout: 300_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const raw = stdout.trim() || stderr.trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Réponse non structurée de l’optimiseur : ${raw.slice(0, 1000)}`);
  }
}

function createServer() {
  const server = new McpServer({ name: 'project-supervised-optimizer', version: '0.1.0' });

  server.registerTool(
    'optimizer_status',
    { description: 'Consulter l’activation du service, la présence du jeu de référence approuvé, les limites de coût et les propositions DSPy en attente. Aucun appel de modèle.', inputSchema: {} },
    async () => textResult({ enabled: optimizerEnabled, ...(await runOptimizer(['status'])) }),
  );

  server.registerTool(
    'optimizer_validate_reference_pack',
    { description: 'Valider le jeu de référence dépersonnalisé et approuvé avant toute optimisation. Aucun appel de modèle.', inputSchema: {} },
    async () => textResult(await runOptimizer(['validate'])),
  );

  if (optimizerEnabled) {
    server.registerTool(
      'optimizer_propose',
      {
        description: 'Exécuter une optimisation DSPy limitée sur des cas de référence approuvés. Produit seulement un candidat pending_approval dans 00_systeme/optimisation/propositions; ne modifie jamais la production.',
        inputSchema: {
          confirm_approved_reference_pack: z.literal(true).describe('Confirmer que le jeu de référence est approuvé, dépersonnalisé et ne contient aucune pièce municipale confidentielle.'),
          max_candidates: z.number().int().min(1).max(2).default(1),
        },
      },
      async ({ max_candidates }) => {
        const result = await runOptimizer(['optimize', '--max-candidates', String(max_candidates)]);
        return textResult(result);
      },
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
  if (!optimizerEnabled || !autonomousPipelineToken || req.get('authorization') !== `Bearer ${autonomousPipelineToken}`) {
    res.status(403).json({ error: 'Autonomous pipeline not authorized' });
    return;
  }
  const referencePackPath = String(req.body?.reference_pack_path ?? '');
  if (!referencePackPath.startsWith(`${workspace}/00_systeme/optimisation/reference-miner/`)) {
    res.status(400).json({ error: 'Invalid autonomous reference pack path' });
    return;
  }
  try {
    const result = await runOptimizer(['optimize', '--max-candidates', '1'], {
      PROJECT_HUB_OPTIMIZER_REFERENCE_PACK_PATH: referencePackPath,
      PROJECT_HUB_OPTIMIZER_ALLOW_AUTONOMOUS_PACKS: 'true',
    });
    res.status(200).json({ status: 'completed', promotion: 'blocked_pending_human_approval', result });
  } catch (error) {
    res.status(422).json({ status: 'failed', error: String(error.message ?? error) });
  }
});

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok', service: 'project-supervised-optimizer', enabled: optimizerEnabled, autonomous_pipeline: Boolean(autonomousPipelineToken) }));
app.listen(port, '0.0.0.0', () => console.log(`project-supervised-optimizer listening on ${port}`));
