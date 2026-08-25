import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const port = Number.parseInt(process.env.PORT ?? '3013', 10);
const workspace = process.env.OASIS_WORKSPACE ?? '/data/shared-workspace';
const optimizerPath = new URL('./optimizer.py', import.meta.url).pathname;

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function runOptimizer(args) {
  const { stdout, stderr } = await execFileAsync('python3', [optimizerPath, ...args], {
    env: { ...process.env, OASIS_WORKSPACE: workspace },
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
  const server = new McpServer({ name: 'oasis-supervised-optimizer', version: '0.1.0' });

  server.registerTool(
    'optimizer_status',
    { description: 'Consulter la présence du jeu de référence approuvé, les limites de coût et les propositions DSPy en attente. Aucun appel de modèle.', inputSchema: {} },
    async () => textResult(await runOptimizer(['status'])),
  );

  server.registerTool(
    'optimizer_validate_reference_pack',
    { description: 'Valider le jeu de référence dépersonnalisé et approuvé avant toute optimisation. Aucun appel de modèle.', inputSchema: {} },
    async () => textResult(await runOptimizer(['validate'])),
  );

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

  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok', service: 'oasis-supervised-optimizer' }));
app.listen(port, '0.0.0.0', () => console.log(`oasis-supervised-optimizer listening on ${port}`));
