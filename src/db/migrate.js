import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 727_274; // any constant: makes two starting servers take turns instead of racing

// Applies every migrations/*.sql file that has not run yet, in filename order.
// Each file runs once, inside its own transaction, and is recorded in schema_migrations.
// Rule: never edit a migration that has been deployed. Add a new numbered file instead.
export async function migrate(db) {
  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  const applied = [];

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');

    await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      await tx.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           id         text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`
      );
      const done = await tx.query('SELECT 1 FROM schema_migrations WHERE id = $1', [id]);
      if (done.length > 0) return;

      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
      applied.push(id);
    });
  }
  return applied;
}
