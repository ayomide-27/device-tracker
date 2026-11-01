const toIso = (date) => date.toISOString();

export function createVisitsStore(db) {
  return {
    async get(visitId) {
      const rows = await db.query(
        `SELECT v.visit_id, v.device_id, v.site_id, v.distance_m, s.radius_m
         FROM visits v LEFT JOIN sites s ON s.site_id = v.site_id WHERE v.visit_id = $1`,
        [visitId]
      );
      const r = rows[0];
      return r ? { id: r.visit_id, deviceId: r.device_id, siteId: r.site_id, distanceM: r.distance_m, radiusM: r.radius_m } : null;
    },

    // Saves a check-in. Returns its distance from the site, or null if it was already stored.
    // The distance is worked out inside the database so there is one definition of "distance".
    async insert({ deviceId, checkin }) {
      const rows = await db.query(
        `INSERT INTO visits (visit_id, device_id, site_id, place_name, recorded_at, lat, lng, accuracy, distance_m)
         SELECT $1::uuid, $2::text, $3::uuid, $4::text, $5::timestamptz, $6::float8, $7::float8, $8::real,
                (SELECT haversine_m($6::float8, $7::float8, s.lat, s.lng) FROM sites s WHERE s.site_id = $3::uuid)
         ON CONFLICT (visit_id) DO NOTHING
         RETURNING distance_m`,
        [checkin.id, deviceId, checkin.siteId, checkin.placeName, toIso(checkin.recordedAt), checkin.lat, checkin.lng, checkin.accuracy]
      );
      if (rows.length === 0) return null;

      if (checkin.photo) {
        await db.query('INSERT INTO visit_photos (visit_id, mime, bytes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
          checkin.id,
          checkin.photo.mime,
          checkin.photo.bytes,
        ]);
      }
      return { distanceM: rows[0].distance_m };
    },

    // Check-ins starting in [start, end) with everything needed to judge them:
    // the previous check-in by the same device, and how much tracking exists around each one.
    async listForReview({ start, end, deviceId = null, trackWindowSeconds }) {
      const rows = await db.query(
        `WITH ordered AS (
           SELECT v.visit_id, v.device_id, v.site_id, v.place_name, v.recorded_at, v.received_at,
                  v.lat, v.lng, v.accuracy, v.distance_m,
                  LAG(v.lat) OVER w AS prev_lat, LAG(v.lng) OVER w AS prev_lng, LAG(v.recorded_at) OVER w AS prev_at
           FROM visits v
           WHERE v.recorded_at >= $1::timestamptz - interval '2 days' AND v.recorded_at < $2::timestamptz
             AND ($3::text IS NULL OR v.device_id = $3::text)
           WINDOW w AS (PARTITION BY v.device_id ORDER BY v.recorded_at)
         )
         SELECT o.visit_id, o.device_id, d.label AS device_label, o.site_id, s.name AS site_name, s.radius_m,
                o.place_name, o.recorded_at, o.received_at, o.lat, o.lng, o.accuracy, o.distance_m,
                (p.visit_id IS NOT NULL) AS has_photo,
                haversine_m(o.prev_lat, o.prev_lng, o.lat, o.lng) AS prev_distance_m,
                EXTRACT(EPOCH FROM (o.recorded_at - o.prev_at))::float8 AS prev_gap_s,
                t.points AS track_points, t.nearest_m AS track_nearest_m
         FROM ordered o
         JOIN devices d ON d.device_id = o.device_id
         LEFT JOIN sites s ON s.site_id = o.site_id
         LEFT JOIN visit_photos p ON p.visit_id = o.visit_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS points, MIN(haversine_m(l.lat, l.lng, o.lat, o.lng)) AS nearest_m
           FROM locations l
           WHERE l.device_id = o.device_id
             AND l.recorded_at BETWEEN o.recorded_at - make_interval(secs => $4::float8)
                                   AND o.recorded_at + make_interval(secs => $4::float8)
         ) t ON true
         WHERE o.recorded_at >= $1::timestamptz
         ORDER BY o.recorded_at`,
        [toIso(start), toIso(end), deviceId, trackWindowSeconds]
      );
      return rows.map((r) => ({
        id: r.visit_id,
        deviceId: r.device_id,
        deviceLabel: r.device_label,
        siteId: r.site_id,
        name: r.site_name ?? r.place_name,
        radiusM: r.radius_m,
        recordedAt: r.recorded_at,
        receivedAt: r.received_at,
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy,
        distanceM: r.distance_m,
        hasPhoto: r.has_photo,
        prevDistanceM: r.prev_distance_m,
        prevGapS: r.prev_gap_s,
        trackPoints: r.track_points,
        trackNearestM: r.track_nearest_m,
      }));
    },

    async photo(visitId) {
      const rows = await db.query('SELECT mime, bytes FROM visit_photos WHERE visit_id = $1', [visitId]);
      return rows[0] ?? null;
    },

    async purge(days) {
      const rows = await db.query(
        'DELETE FROM visits WHERE recorded_at < now() - make_interval(days => $1::int) RETURNING 1',
        [days]
      );
      return rows.length;
    },
  };
}
