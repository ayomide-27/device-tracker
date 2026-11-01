export function createLocationsStore(db) {
  return {
    // Saves points; ones already stored are skipped. Returns how many were new.
    async insertBatch(deviceId, points) {
      if (points.length === 0) return 0;
      const params = [deviceId];
      const rows = points.map((p) => {
        const at = params.length;
        params.push(new Date(p.t).toISOString(), p.lat, p.lng, p.acc);
        return `($1, $${at + 1}, $${at + 2}, $${at + 3}, $${at + 4})`;
      });
      const inserted = await db.query(
        `INSERT INTO locations (device_id, recorded_at, lat, lng, accuracy)
         VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING RETURNING 1`,
        params
      );
      return inserted.length;
    },

    // Points for one device between two moments, oldest first.
    async route(deviceId, { start, end }, limit) {
      const rows = await db.query(
        `SELECT recorded_at, lat, lng, accuracy FROM locations
         WHERE device_id = $1 AND recorded_at >= $2 AND recorded_at < $3
         ORDER BY recorded_at LIMIT $4`,
        [deviceId, start.toISOString(), end.toISOString(), limit]
      );
      return rows.map((r) => ({ t: r.recorded_at.getTime(), lat: r.lat, lng: r.lng, acc: r.accuracy }));
    },

    async purge(days) {
      const rows = await db.query(
        'DELETE FROM locations WHERE recorded_at < now() - make_interval(days => $1::int) RETURNING 1',
        [days]
      );
      return rows.length;
    },
  };
}
