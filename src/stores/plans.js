export function createPlansStore(db, timezone) {
  return {
    // Replaces the sites assigned to one FO for one week.
    async replace({ deviceId, weekStart, siteIds }) {
      await db.query('DELETE FROM plan_items WHERE device_id = $1 AND week_start = $2::date', [deviceId, weekStart]);
      await this.add({ deviceId, weekStart, siteIds });
    },

    // Adds sites to an FO's week, keeping what is already there.
    async add({ deviceId, weekStart, siteIds }) {
      if (siteIds.length === 0) return;
      await db.query(
        `INSERT INTO plan_items (device_id, site_id, week_start)
         SELECT $1, site_id, $3::date FROM unnest($2::uuid[]) AS site_id
         ON CONFLICT DO NOTHING`,
        [deviceId, siteIds, weekStart]
      );
    },

    // What an FO's phone shows: this week's sites.
    async forDevice({ deviceId, weekStart }) {
      const rows = await db.query(
        `SELECT s.site_id, s.name, s.lat, s.lng, s.radius_m
         FROM plan_items p JOIN sites s ON s.site_id = p.site_id
         WHERE p.device_id = $1 AND p.week_start = $2::date AND NOT s.archived
         ORDER BY s.name`,
        [deviceId, weekStart]
      );
      return rows.map((r) => ({ id: r.site_id, name: r.name, lat: r.lat, lng: r.lng, radiusM: r.radius_m }));
    },

    // The visited / not-visited board: every planned site with the best check-in made at it that week.
    async board({ weekStart, deviceId = null }) {
      const rows = await db.query(
        `SELECT p.device_id, d.label AS device_label,
                s.site_id, s.name, s.lat, s.lng, s.radius_m,
                v.visit_id, v.recorded_at, v.distance_m
         FROM plan_items p
         JOIN devices d ON d.device_id = p.device_id
         JOIN sites s ON s.site_id = p.site_id
         LEFT JOIN LATERAL (
           SELECT vi.visit_id, vi.recorded_at, vi.distance_m
           FROM visits vi
           WHERE vi.device_id = p.device_id AND vi.site_id = p.site_id
             AND vi.recorded_at >= ($1::date::timestamp AT TIME ZONE $2)
             AND vi.recorded_at <  (($1::date + 7)::timestamp AT TIME ZONE $2)
           ORDER BY (vi.distance_m <= s.radius_m) DESC, vi.recorded_at DESC
           LIMIT 1
         ) v ON true
         WHERE p.week_start = $1::date AND ($3::text IS NULL OR p.device_id = $3)
         ORDER BY d.label, s.name`,
        [weekStart, timezone, deviceId]
      );
      return rows.map((r) => ({
        deviceId: r.device_id,
        deviceLabel: r.device_label,
        site: { id: r.site_id, name: r.name, lat: r.lat, lng: r.lng, radiusM: r.radius_m },
        visit: r.visit_id
          ? { id: r.visit_id, t: r.recorded_at.getTime(), distanceM: r.distance_m, radiusM: r.radius_m }
          : null,
      }));
    },

    async purge(days) {
      const rows = await db.query(
        `DELETE FROM plan_items WHERE week_start < ((now() AT TIME ZONE $2)::date - $1::int) RETURNING 1`,
        [days, timezone]
      );
      return rows.length;
    },
  };
}
