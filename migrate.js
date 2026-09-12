const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureMigrationsTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT now()
  )`);
}

async function run() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort() : [];
    for (const file of files) {
      const name = file;
      const found = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (found.rowCount) { console.log(`Skipping ${name}`); continue; }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Applying ${name}...`);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
    console.log('Migrations complete');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
