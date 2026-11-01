export function createDevicesStore(db) {
  return {
    // Registers a device and marks it as "heard from just now". A name is only changed
    // when one is given, so an upload without a name never wipes a good one.
    touch: ({ deviceId, label = null }) =>
      db.query(
        `INSERT INTO devices (device_id, label, last_seen) VALUES ($1, COALESCE($2, 'Unnamed device'), now())
         ON CONFLICT (device_id) DO UPDATE SET label = COALESCE($2, devices.label), last_seen = now()`,
        [deviceId, label]
      ),

    // Points the device's "latest position" at its newest stored GPS reading.
    refreshLastFix: (deviceId) =>
      db.query(
        `UPDATE devices d SET last_lat = l.lat, last_lng = l.lng, last_fix_at = l.recorded_at
         FROM (SELECT lat, lng, recorded_at FROM locations
               WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1) l
         WHERE d.device_id = $1`,
        [deviceId]
      ),

    async list() {
      const rows = await db.query(
        `SELECT device_id, label, last_lat, last_lng, last_fix_at,
                EXTRACT(EPOCH FROM (now() - last_seen))::int AS age_seconds
         FROM devices ORDER BY label`
      );
      return rows.map((r) => ({
        deviceId: r.device_id,
        label: r.label,
        lat: r.last_lat,
        lng: r.last_lng,
        lastFixAt: r.last_fix_at ? r.last_fix_at.toISOString() : null,
        ageSeconds: r.age_seconds,
      }));
    },

    async remove(deviceId) {
      const rows = await db.query('DELETE FROM devices WHERE device_id = $1 RETURNING 1', [deviceId]);
      return rows.length > 0;
    },

    async purgeIdle(days) {
      const rows = await db.query(
        'DELETE FROM devices WHERE last_seen < now() - make_interval(days => $1::int) RETURNING 1',
        [days]
      );
      return rows.length;
    },
  };
}
