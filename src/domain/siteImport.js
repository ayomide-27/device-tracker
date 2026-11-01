import { RULES } from '../rules.js';
import { cleanText, isLatitude, isLongitude } from './validate.js';

// Understands the lines a supervisor pastes in. One site per line:
//   Name, latitude, longitude
//   Name, latitude, longitude, radius-in-metres
//   Name, https://www.google.com/maps/place/.../@9.0765,7.3986,17z/...   (a long Google Maps link)
// Lines starting with # and blank lines are ignored.

const URL_COORDS = [
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /[?&](?:q|query|ll|destination)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
];

const isNumeric = (token) => /^-?\d+(?:\.\d+)?$/.test(token);

function fromUrl(line) {
  const name = line.slice(0, line.indexOf('http')).replace(/[\s,;\t:-]+$/, '').trim();
  for (const pattern of URL_COORDS) {
    const match = line.match(pattern);
    if (match) return { name, lat: Number(match[1]), lng: Number(match[2]), radiusM: null };
  }
  return { error: 'Could not find coordinates in that link. Short links (maps.app.goo.gl) must be opened first and the long link copied.' };
}

function fromColumns(line) {
  const tokens = line.split(/[,;\t]/).map((t) => t.trim()).filter(Boolean);
  const numbers = [];
  while (tokens.length > 0 && numbers.length < 3 && isNumeric(tokens[tokens.length - 1])) {
    numbers.unshift(Number(tokens.pop()));
  }
  if (numbers.length < 2) return { error: 'Expected: name, latitude, longitude' };
  const [lat, lng, radiusM = null] = numbers;
  return { name: tokens.join(', '), lat, lng, radiusM };
}

export function parseSiteLines(text) {
  const sites = [];
  const errors = [];

  String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const fail = (reason) => errors.push({ line: index + 1, text: line.slice(0, 80), reason });

    const parsed = /https?:\/\//i.test(line) ? fromUrl(line) : fromColumns(line);
    if (parsed.error) return fail(parsed.error);

    const name = cleanText(parsed.name, 80);
    if (!name) return fail('Missing site name');
    if (!isLatitude(parsed.lat) || !isLongitude(parsed.lng)) return fail('Coordinates out of range (latitude first, then longitude)');
    const radiusM = parsed.radiusM ?? RULES.defaultSiteRadiusM;
    if (!Number.isInteger(radiusM) || radiusM < RULES.minSiteRadiusM || radiusM > RULES.maxSiteRadiusM) {
      return fail(`Radius must be a whole number from ${RULES.minSiteRadiusM} to ${RULES.maxSiteRadiusM} metres`);
    }
    sites.push({ name, lat: parsed.lat, lng: parsed.lng, radiusM });
  });

  return { sites, errors };
}
