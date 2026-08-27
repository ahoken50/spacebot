import pg from 'pg';

const { Pool } = pg;
const databaseUrl = requiredEnvironment('DATABASE_URL');
const openRouterApiKey = requiredEnvironment('OPENROUTER_API_KEY');
const embeddingModel = process.env.OASIS_EMBEDDING_MODEL ?? 'voyageai/voyage-4';
const embeddingDimensions = Number.parseInt(process.env.OASIS_EMBEDDING_DIMENSIONS ?? '1024', 10);
const embeddingProfile = `${embeddingModel}:${embeddingDimensions}`;
const batchSize = 20;

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function vectorLiteral(vector) {
  return `[${vector.join(',')}]`;
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
      dimensions: embeddingDimensions,
      provider: { allow_fallbacks: false, data_collection: 'deny' },
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

async function main() {
  await pool.query("ALTER TABLE shared_records ADD COLUMN IF NOT EXISTS embedding_profile TEXT NOT NULL DEFAULT ''");

  let processed = 0;
  while (true) {
    const { rows } = await pool.query(
      `SELECT id, title, content
       FROM shared_records
       WHERE embedding_profile IS DISTINCT FROM $1
       ORDER BY updated_at ASC
       LIMIT $2`,
      [embeddingProfile, batchSize],
    );
    if (rows.length === 0) break;

    for (const record of rows) {
      const embedding = await embed(`${record.title}\n\n${record.content}`);
      await pool.query(
        `UPDATE shared_records
         SET embedding = $2::vector, embedding_profile = $3, updated_at = now()
         WHERE id = $1`,
        [record.id, vectorLiteral(embedding), embeddingProfile],
      );
      processed += 1;
      console.log(`reindexed ${record.id}`);
    }
  }

  console.log(JSON.stringify({ status: 'success', embedding_model: embeddingModel, dimensions: embeddingDimensions, reindexed_records: processed }));
}

try {
  await main();
} finally {
  await pool.end();
}
