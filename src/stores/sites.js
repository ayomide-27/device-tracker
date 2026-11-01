import { RULES } from '../rules.js';

const toSite = (r) => ({ id: r.site_id, name: r.name, lat: r.lat, lng: r.lng, radiusM: r.radius_m });

export function createSitesStore(db) {
  return {
    async list() {
      const rows = await db.query('SELECT * FROM sites WHERE NOT archived ORDER BY name');
      return rows.map(toSite);
    },

    async get(siteId) {
      const rows = await db.query('SELECT * FROM sites WHERE site_id = $1', [siteId]);
      return rows[0] ? toSite(rows[0]) : null;
    },

    // Weekly lists repeat the same places, so an existing site with the same name very close
    // by is reused instead of creating a duplicate.
    async findOrCreate({ name, lat, lng, radiusM }) {
      const existing = await db.query(
        `SELECT * FROM sites
         WHERE NOT archived AND lower(name) = lower($1) AND haversine_m(lat, lng, $2, $3) <= $4
         LIMIT 1`,
        [name, lat, lng, RULES.siteMatchRadiusM]
      );
      if (existing[0]) return { site: toSite(existing[0]), created: false };

      const [row] = await db.query(
        'INSERT INTO sites (name, lat, lng, radius_m) VALUES ($1, $2, $3, $4) RETURNING *',
        [name, lat, lng, radiusM]
      );
      return { site: toSite(row), created: true };
    },

    async update(siteId, { name, radiusM }) {
      const rows = await db.query(
        `UPDATE sites SET name = COALESCE($2, name), radius_m = COALESCE($3, radius_m)
         WHERE site_id = $1 AND NOT archived RETURNING *`,
        [siteId, name, radiusM]
      );
      return rows[0] ? toSite(rows[0]) : null;
    },

    async archive(siteId) {
      const rows = await db.query('UPDATE sites SET archived = true WHERE site_id = $1 AND NOT archived RETURNING 1', [siteId]);
      return rows.length > 0;
    },
  };
}
