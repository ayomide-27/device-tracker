import { RULES } from '../rules.js';
import { ValidationError } from '../errors.js';
import { cleanText, isLatitude, isLongitude, requireDeviceId, requireUuid } from './validate.js';

const MAX_FUTURE_MS = 24 * 3_600_000; // a phone clock more than a day ahead is rejected outright
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function parsePhoto(photo) {
  if (photo === undefined || photo === null) return null;
  if (photo.mime !== 'image/jpeg' || typeof photo.data !== 'string') {
    throw new ValidationError('Photo must be a JPEG');
  }
  const bytes = Buffer.from(photo.data, 'base64');
  if (bytes.length === 0 || bytes.length > RULES.maxPhotoBytes) {
    throw new ValidationError(`Photo must be under ${Math.round(RULES.maxPhotoBytes / 1000)} KB`);
  }
  if (!JPEG_MAGIC.every((byte, i) => bytes[i] === byte)) throw new ValidationError('Photo is not a valid JPEG');
  return { mime: 'image/jpeg', bytes };
}

// Turns the JSON a phone sends for a check-in into a clean, trusted object (or throws ValidationError).
export function parseCheckin(body, { now = Date.now(), retentionDays }) {
  const c = body ?? {};
  const deviceId = requireDeviceId(c.deviceId);
  const id = requireUuid(c.id, 'Check-in id');

  const siteId = c.siteId ?? null;
  if (siteId !== null) requireUuid(siteId, 'siteId');
  const placeName = cleanText(c.placeName, 80);
  if (siteId === null && !placeName) throw new ValidationError('Choose a site or type the place name');
  if (siteId !== null && placeName) throw new ValidationError('Send either a site or a place name, not both');

  if (!isLatitude(c.lat) || !isLongitude(c.lng)) throw new ValidationError('Invalid coordinates');
  if (!Number.isFinite(c.t) || c.t > now + MAX_FUTURE_MS || c.t < now - retentionDays * 86_400_000) {
    throw new ValidationError('Check-in time is not believable. Check the phone clock.');
  }
  const accuracy = Number.isFinite(c.acc) && c.acc >= 0 ? Math.min(c.acc, 100_000) : null;

  return {
    deviceId,
    label: cleanText(c.label, 60) || null,
    checkin: {
      id,
      siteId,
      placeName: siteId === null ? placeName : null,
      recordedAt: new Date(Math.round(c.t)),
      lat: c.lat,
      lng: c.lng,
      accuracy,
      photo: parsePhoto(c.photo),
    },
  };
}
