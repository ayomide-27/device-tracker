// GPS points uploaded by a phone: keep the believable ones, count the rest.

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function cleanPoints(raw, { now = Date.now(), retentionDays }) {
  const oldest = now - retentionDays * 86_400_000;
  const good = [];
  let rejected = 0;

  for (const p of raw) {
    const believable =
      p &&
      Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 &&
      Number.isFinite(p.lng) && p.lng >= -180 && p.lng <= 180 &&
      Number.isFinite(p.t) && p.t <= now + FUTURE_TOLERANCE_MS && p.t >= oldest;
    if (!believable) {
      rejected += 1;
      continue;
    }
    good.push({
      t: Math.round(p.t),
      lat: p.lat,
      lng: p.lng,
      acc: Number.isFinite(p.acc) && p.acc >= 0 ? Math.min(p.acc, 100_000) : null,
    });
  }
  return { good, rejected };
}

// Evenly thins a long list down to about `max` entries, always keeping the first and last.
export function downsample(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const thinned = [];
  for (let i = 0; i < max; i += 1) thinned.push(points[Math.floor(i * step)]);
  const last = points[points.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}
