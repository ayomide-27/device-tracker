// Reads settings from environment variables once, validates them, and freezes the result.
export class ConfigError extends Error {}

function readInt(env, name, fallback, { min = 1, max = 1_000_000 } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number between ${min} and ${max} (got "${raw}")`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  if (!env.DATABASE_URL) {
    throw new ConfigError(
      'DATABASE_URL is not set. On Render: open your service > Environment > add DATABASE_URL ' +
        '(your Neon connection string). Locally: put it in a .env file.'
    );
  }
  return Object.freeze({
    port: readInt(env, 'PORT', 3000, { max: 65535 }),
    databaseUrl: env.DATABASE_URL,
    dashboardPassword: env.DASHBOARD_PASSWORD ?? '', // protects the map and every API that returns locations
    deviceKey: env.DEVICE_KEY ?? '', // optional access code the phones must send
    retentionDays: readInt(env, 'RETENTION_DAYS', 90, { max: 3650 }),
    timezone: env.TIMEZONE || 'Africa/Lagos', // "today" and "this week" are counted in this time zone
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY ?? '',
    googleMapId: env.GOOGLE_MAP_ID || 'DEMO_MAP_ID',
  });
}
