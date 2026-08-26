import crypto from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import pg from 'pg';
import * as z from 'zod/v4';

const { Pool } = pg;
const port = Number.parseInt(process.env.PORT ?? '3010', 10);
const databaseUrl = requiredEnvironment('DATABASE_URL');
const openRouterApiKey = requiredEnvironment('OPENROUTER_API_KEY');
const referenceExportToken = requiredEnvironment('PROJECT_HUB_MEMORY_EXPORT_TOKEN');
const embeddingModel = process.env.PROJECT_HUB_EMBEDDING_MODEL ?? 'qwen/qwen3-embedding-0.6b';
const embeddingDimensions = Number.parseInt(process.env.PROJECT_HUB_EMBEDDING_DIMENSIONS ?? '1024', 10);
const queryEmbeddingCache = new Map();
const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_CACHE_MAX_ENTRIES = 256;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

await initializeDatabase();

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function initializeDatabase() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_records (
      id UUID PRIMARY KEY,
      external_key TEXT UNIQUE,
      record_type TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'project-hub',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      embedding vector(${embeddingDimensions}) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS shared_records_scope_index ON shared_records (scope, record_type, status)');
  await pool.query('CREATE INDEX IF NOT EXISTS shared_records_updated_index ON shared_records (updated_at DESC)');
  await pool.query(`CREATE INDEX IF NOT EXISTS shared_records_embedding_index ON shared_records USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_record_links (
      from_record_id UUID NOT NULL REFERENCES shared_records(id) ON DELETE RESTRICT,
      to_record_id UUID NOT NULL REFERENCES shared_records(id) ON DELETE RESTRICT,
      relation_type TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_record_id, to_record_id, relation_type)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID PRIMARY KEY,
      record_id UUID REFERENCES shared_records(id) ON DELETE RESTRICT,
      event_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function embed(text) {
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: embeddingModel,
      input: text,
      provider: {
        allow_fallbacks: false,
        data_collection: 'deny',
      },
    }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Embedding request failed (${response.status}): ${details.slice(0, 500)}`);
  }
  const body = await response.json();
  const vector = body?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== embeddingDimensions) {
    throw new Error(`Embedding dimension mismatch: expected ${embeddingDimensions}, received ${Array.isArray(vector) ? vector.length : 'no vector'}`);
  }
  return vector;
}

async function embedQuery(query) {
  const normalized = query.trim().replace(/\s+/g, ' ').slice(0, 1000);
  const cached = queryEmbeddingCache.get(normalized);
  if (cached && Date.now() - cached.createdAt < QUERY_CACHE_TTL_MS) return cached.vector;
  const vector = await embed(normalized);
  if (queryEmbeddingCache.size >= QUERY_CACHE_MAX_ENTRIES) {
    queryEmbeddingCache.delete(queryEmbeddingCache.keys().next().value);
  }
  queryEmbeddingCache.set(normalized, { vector, createdAt: Date.now() });
  return vector;
}

function vectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function normalizeRecords(rows) {
  return rows.map((row) => ({
    ...row,
    similarity: row.similarity === undefined ? undefined : Number(row.similarity),
  }));
}

function createServer() {
  const server = new McpServer({
    name: 'project-shared-memory',
    version: '0.1.0',
  });

  server.registerTool(
    'save_shared_record',
    {
      description: 'Créer ou mettre à jour un enregistrement partagé. Utiliser external_key pour les entités stables : décision, dépense, indicateur, livrable ou réunion. Les actions contractuelles, financières et transmissions ministérielles sont enregistrées avec status=pending_approval jusqu’à approbation humaine.',
      inputSchema: {
        external_key: z.string().min(3).max(200).optional(),
        record_type: z.enum(['decision', 'financial_entry', 'contract', 'procurement', 'schedule', 'indicator', 'project', 'deliverable', 'meeting', 'risk', 'document', 'fact']),
        scope: z.string().min(1).max(160).default('project-hub'),
        title: z.string().min(3).max(500),
        content: z.string().min(10).max(6_000),
        payload: z.record(z.string(), z.unknown()).default({}),
        source_references: z.array(z.string().min(1).max(500)).max(30).default([]),
        created_by: z.string().min(3).max(100),
        status: z.enum(['draft', 'active', 'pending_approval', 'approved', 'superseded', 'archived']).default('active'),
      },
    },
    async ({ external_key, record_type, scope, title, content, payload, source_references, created_by, status }) => {
      // Une mise à jour identique d’une entité stable ne mérite ni nouvel embedding ni écriture d’audit.
      if (external_key) {
        const existing = await pool.query(
          'SELECT id, external_key, record_type, scope, title, content, payload, source_references, created_by, status, created_at, updated_at FROM shared_records WHERE external_key = $1 LIMIT 1',
          [external_key],
        );
        const record = existing.rows[0];
        if (record
          && record.record_type === record_type
          && record.scope === scope
          && record.title === title
          && record.content === content
          && record.created_by === created_by
          && record.status === status
          && JSON.stringify(record.payload) === JSON.stringify(payload)
          && JSON.stringify(record.source_references) === JSON.stringify(source_references)) {
          delete record.content;
          delete record.payload;
          delete record.source_references;
          return textResult({ ...record, unchanged: true, note: 'Aucun embedding ni écriture créé : le contenu indexé est identique.' });
        }
      }
      const embedding = await embed(`${title}\n\n${content}`);
      const recordId = crypto.randomUUID();
      const result = await pool.query(
        `
          INSERT INTO shared_records (
            id, external_key, record_type, scope, title, content, payload,
            source_references, created_by, status, embedding
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::vector)
          ON CONFLICT (external_key) DO UPDATE SET
            record_type = EXCLUDED.record_type,
            scope = EXCLUDED.scope,
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            payload = EXCLUDED.payload,
            source_references = EXCLUDED.source_references,
            created_by = EXCLUDED.created_by,
            status = EXCLUDED.status,
            embedding = EXCLUDED.embedding,
            updated_at = now()
          RETURNING id, external_key, record_type, scope, title, status, created_at, updated_at
        `,
        [recordId, external_key ?? null, record_type, scope, title, content, JSON.stringify(payload), JSON.stringify(source_references), created_by, status, vectorLiteral(embedding)],
      );
      const record = result.rows[0];
      await pool.query(
        'INSERT INTO audit_events (id, record_id, event_type, actor_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [crypto.randomUUID(), record.id, external_key ? 'upsert' : 'create', created_by, JSON.stringify({ record_type, status })],
      );
      return textResult(record);
    },
  );

  server.registerTool(
    'search_shared_memory',
    {
      description: 'Rechercher dans la mémoire commune de tous les profils Project Hub par similarité sémantique et filtres. Toujours citer les source_references dans les livrables produits à partir du résultat.',
      inputSchema: {
        query: z.string().min(3).max(1_000),
        scope: z.string().max(160).optional(),
        record_type: z.string().max(80).optional(),
        status: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(10).default(5),
      },
    },
    async ({ query, scope, record_type, status, limit }) => {
      const embedding = await embedQuery(query);
      const result = await pool.query(
        `
          SELECT id, external_key, record_type, scope, title, content, payload,
                 source_references, created_by, status, created_at, updated_at,
                 1 - (embedding <=> $1::vector) AS similarity
          FROM shared_records
          WHERE ($2::text IS NULL OR scope = $2)
            AND ($3::text IS NULL OR record_type = $3)
            AND ($4::text IS NULL OR status = $4)
          ORDER BY embedding <=> $1::vector
          LIMIT $5
        `,
        [vectorLiteral(embedding), scope ?? null, record_type ?? null, status ?? null, limit],
      );
      const compactRecords = normalizeRecords(result.rows).map((record) => ({
        ...record,
        content: record.content.length > 1200 ? `${record.content.slice(0, 1200)}…` : record.content,
        content_truncated: record.content.length > 1200,
      }));
      return textResult({ query, records: compactRecords, note: 'Les extraits sont limités pour réduire le contexte. Utiliser get_shared_record avec un id ou external_key seulement lorsqu’un enregistrement est réellement requis.' });
    },
  );

  server.registerTool(
    'get_shared_record',
    {
      description: 'Obtenir un enregistrement partagé par UUID ou par external_key, avec ses liens entrants et sortants.',
      inputSchema: {
        id: z.string().uuid().optional(),
        external_key: z.string().min(3).max(200).optional(),
      },
    },
    async ({ id, external_key }) => {
      if (!id && !external_key) {
        throw new Error('Provide either id or external_key');
      }
      const result = await pool.query(
        'SELECT * FROM shared_records WHERE ($1::uuid IS NOT NULL AND id = $1) OR ($2::text IS NOT NULL AND external_key = $2) LIMIT 1',
        [id ?? null, external_key ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        return textResult({ found: false });
      }
      const links = await pool.query(
        `
          SELECT relation_type, from_record_id, to_record_id
          FROM shared_record_links
          WHERE from_record_id = $1 OR to_record_id = $1
          ORDER BY relation_type
        `,
        [record.id],
      );
      return textResult({ found: true, record, links: links.rows });
    },
  );

  server.registerTool(
    'link_shared_records',
    {
      description: 'Créer un lien traçable entre deux enregistrements partagés. Exemples : dépend_de, justifie, mesure, remplace, concerne, produit_par.',
      inputSchema: {
        from_record_id: z.string().uuid(),
        to_record_id: z.string().uuid(),
        relation_type: z.enum(['depends_on', 'justifies', 'measures', 'replaces', 'concerns', 'produced_by', 'approved_by', 'evidenced_by']),
        created_by: z.string().min(3).max(100),
      },
    },
    async ({ from_record_id, to_record_id, relation_type, created_by }) => {
      await pool.query(
        `
          INSERT INTO shared_record_links (from_record_id, to_record_id, relation_type, created_by)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (from_record_id, to_record_id, relation_type) DO NOTHING
        `,
        [from_record_id, to_record_id, relation_type, created_by],
      );
      return textResult({ linked: true, from_record_id, to_record_id, relation_type });
    },
  );

  server.registerTool(
    'shared_memory_status',
    {
      description: 'Consulter l’état non sensible de la mémoire commune : nombre d’enregistrements par type et par statut, modèle d’embeddings et nombre de liens.',
      inputSchema: {},
    },
    async () => {
      const [recordCounts, linkCount] = await Promise.all([
        pool.query('SELECT record_type, status, count(*)::int AS count FROM shared_records GROUP BY record_type, status ORDER BY record_type, status'),
        pool.query('SELECT count(*)::int AS count FROM shared_record_links'),
      ]);
      return textResult({
        embedding_model: embeddingModel,
        embedding_dimensions: embeddingDimensions,
        records: recordCounts.rows,
        links: linkCount.rows[0].count,
      });
    },
  );

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
    if (!response.headersSent) {
      response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

app.get('/mcp', (_request, response) => {
  response.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});

app.get('/internal/reference-records', async (request, response) => {
  const authorization = request.get('authorization') ?? '';
  if (authorization !== `Bearer ${referenceExportToken}`) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(request.query.limit ?? '12'), 10) || 12));
  const recordTypes = String(request.query.record_types ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^[a-z_]{3,80}$/.test(value))
    .slice(0, 12);
  if (recordTypes.length === 0) {
    response.status(400).json({ error: 'record_types is required' });
    return;
  }
  try {
    const result = await pool.query(
      `
        SELECT id, external_key, record_type, scope, title,
               LEFT(content, 4000) AS content, payload, source_references,
               created_by, status, created_at, updated_at
        FROM shared_records
        WHERE status = 'approved'
          AND record_type = ANY($1::text[])
          AND payload @> '{"learning_eligible": true, "completed": true}'::jsonb
        ORDER BY updated_at DESC
        LIMIT $2
      `,
      [recordTypes, limit],
    );
    response.status(200).json({ records: result.rows, limit, record_types: recordTypes });
  } catch (error) {
    console.error('Reference record export failed', error);
    response.status(503).json({ error: 'Reference record export unavailable' });
  }
});

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.status(200).json({ status: 'ok', embedding_model: embeddingModel, embedding_dimensions: embeddingDimensions });
  } catch (error) {
    response.status(503).json({ status: 'unavailable', error: String(error) });
  }
});

const httpServer = app.listen(port, () => {
  console.log(`Project Hub shared-memory MCP server listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down shared-memory MCP server`);
  httpServer.close();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
