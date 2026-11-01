import pg from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Opens a connection pool and returns a small interface: query(), transaction(), close().
export function createDb(databaseUrl) {
  const url = new URL(databaseUrl);
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  // pg reads sslmode from the URL and warns about it; we set SSL explicitly instead.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');

  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10_000,
    // Neon puts idle databases to sleep. Dropping our idle connections quickly means we never
    // reuse one that the other side has already closed.
    idleTimeoutMillis: 10_000,
  });
  // Without this handler, one dropped idle connection would crash the whole server.
  pool.on('error', (err) => console.error('Idle database connection error:', err.message));

  const asRows = (result) => result.rows;

  return {
    query: (sql, params) => pool.query(sql, params).then(asRows),

    // Runs fn inside BEGIN/COMMIT. fn receives an object with the same query() method.
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (sql, params) => client.query(sql, params).then(asRows) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    close: () => pool.end(),
  };
}
