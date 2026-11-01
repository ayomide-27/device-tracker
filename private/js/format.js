// Dates, times and wording. Day boundaries are decided by the server (in its time zone);
// the browser only does date-string arithmetic, so the two can never disagree about "today".

export const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const dayLabel = (date) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export const timeLabel = (ms, timezone) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone });

export const dateTimeLabel = (ms, timezone) =>
  new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone });

export function ago(seconds) {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export const km = (metres) => (metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`);

export const STATUS = {
  verified: { label: 'Verified', cls: 'ok' },
  off_site: { label: 'Off site', cls: 'warn' },
  unplanned: { label: 'Unplanned', cls: 'info' },
  not_visited: { label: 'Not visited', cls: 'muted' },
};

export const FLAGS = {
  weak_gps: { label: 'Weak GPS', help: 'The phone only had a vague GPS fix when checking in.' },
  no_track: { label: 'No tracking', help: 'The phone sent no location points around this check-in.' },
  track_mismatch: { label: 'Track elsewhere', help: 'Tracking points around this time were all far from the check-in.' },
  impossible_travel: { label: 'Impossible travel', help: 'Too far from the previous check-in for the time between them.' },
  clock_ahead: { label: 'Clock ahead', help: 'The phone clock was ahead of the server clock.' },
};
