import { RULES } from '../rules.js';

// How a check-in is judged. Pure functions: numbers in, verdict out. The database supplies the numbers.

export const VISIT_STATUS = Object.freeze({
  VERIFIED: 'verified', // at the assigned site (within its radius)
  OFF_SITE: 'off_site', // checked in for a site but too far from it
  UNPLANNED: 'unplanned', // "somewhere not on my list"
});

export const FLAGS = Object.freeze({
  WEAK_GPS: 'weak_gps', // the GPS fix was vague
  NO_TRACK: 'no_track', // no tracking points around that time at all
  TRACK_MISMATCH: 'track_mismatch', // tracking points exist but all were far from the check-in
  IMPOSSIBLE_TRAVEL: 'impossible_travel', // too far from the previous check-in for the time between them
  CLOCK_AHEAD: 'clock_ahead', // the phone clock was ahead of the server clock
});

export function visitStatus({ siteId, distanceM, radiusM }) {
  if (siteId === null) return VISIT_STATUS.UNPLANNED;
  return distanceM <= radiusM ? VISIT_STATUS.VERIFIED : VISIT_STATUS.OFF_SITE;
}

// v: accuracyM, recordedAt (Date), receivedAt (Date),
//    trackPoints (count of tracking points around the check-in), trackNearestM (closest one),
//    prevDistanceM / prevGapS (the previous check-in by the same device; null if none)
export function visitFlags(v, { now = new Date() } = {}) {
  const flags = [];

  if (v.accuracyM !== null && v.accuracyM > RULES.visitAccuracyM) flags.push(FLAGS.WEAK_GPS);

  // Tracking points can still be on their way (phone offline), so recent check-ins are not judged yet.
  const windowClosed = v.recordedAt.getTime() + RULES.trackWindowSeconds * 1000 <= now.getTime();
  if (windowClosed) {
    if (v.trackPoints === 0) flags.push(FLAGS.NO_TRACK);
    else if (v.trackNearestM > RULES.trackMatchRadiusM) flags.push(FLAGS.TRACK_MISMATCH);
  }

  if (v.prevDistanceM !== null && v.prevGapS > 0 && v.prevDistanceM >= RULES.minTravelDistanceM) {
    const speedKmh = (v.prevDistanceM / v.prevGapS) * 3.6;
    if (speedKmh > RULES.maxTravelSpeedKmh) flags.push(FLAGS.IMPOSSIBLE_TRAVEL);
  }

  const aheadSeconds = (v.recordedAt.getTime() - v.receivedAt.getTime()) / 1000;
  if (aheadSeconds > RULES.clockSkewSeconds) flags.push(FLAGS.CLOCK_AHEAD);

  return flags;
}

// Status of a planned site for a week, given the best check-in at it (or none).
export function planItemStatus(visit) {
  if (!visit) return 'not_visited';
  return visit.distanceM <= visit.radiusM ? VISIT_STATUS.VERIFIED : VISIT_STATUS.OFF_SITE;
}
