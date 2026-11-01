// Starts the tracker: read settings -> connect to the database -> update its tables -> listen.
import { ConfigError, loadConfig } from './src/config.js';
import { createDb } from './src/db/index.js';
import { migrate } from './src/db/migrate.js';
import { createApp } from './src/http/app.js';
import { createStores } from './src/stores/index.js';
import { createMaintenanceService } from './src/services/maintenance.js';

const PURGE_EVERY_MS = 6 * 3_600_000;

async function main() {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);

  const applied = await migrate(db);
  if (applied.length) console.log(`Database updated: ${applied.join(', ')}`);

  const maintenance = createMaintenanceService({
    config,
    db,
    makeStores: (executor) => createStores(executor, { timezone: config.timezone }),
  });
  const purge = async () => {
    try {
      const counts = await maintenance.purge();
      if (Object.values(counts).some(Boolean)) console.log('Purged old data:', counts);
    } catch (err) {
      console.error('Purge failed:', err.message);
    }
  };
  await purge();
  setInterval(purge, PURGE_EVERY_MS).unref();

  const server = createApp({ config, db }).listen(config.port, () => {
    console.log(`Tracker running on port ${config.port}`);
    console.log(`History kept for ${config.retentionDays} days, times counted in ${config.timezone}`);
    if (!config.dashboardPassword) console.log('WARNING: DASHBOARD_PASSWORD not set - anyone with the link can see locations');
    if (!config.googleMapsApiKey) console.log('Note: GOOGLE_MAPS_API_KEY not set - the dashboard will use OpenStreetMap');
  });

  const shutdown = () => {
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? `Setup problem: ${err.message}` : `Could not start: ${err.message}`);
  process.exit(1);
});
