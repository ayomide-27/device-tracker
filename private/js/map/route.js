// Turns a list of GPS points into line segments. A long silence between two points (phone off,
// no signal) is drawn as a dashed "gap" line instead of pretending the FO moved in a straight line.
export const GAP_MS = 5 * 60 * 1000;

export function splitRoute(points, gapMs = GAP_MS) {
  const segments = [];
  let current = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const previous = points[i - 1];
    if (previous && p.t - previous.t > gapMs) {
      if (current.length > 0) segments.push({ path: current, dashed: false });
      segments.push({ path: [previous, p].map(({ lat, lng }) => ({ lat, lng })), dashed: true });
      current = [];
    }
    current.push({ lat: p.lat, lng: p.lng });
  }
  if (current.length > 0) segments.push({ path: current, dashed: false });
  // A one-point segment cannot be drawn as a line; keep only real lines.
  return segments.filter((s) => s.path.length >= 2);
}
