import { ValidationError } from '../errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (value) => typeof value === 'string' && UUID.test(value);

export function requireUuid(value, what) {
  if (!isUuid(value)) throw new ValidationError(`${what} is not valid`);
  return value;
}

export function requireDeviceId(value) {
  if (typeof value !== 'string' || !DEVICE_ID.test(value)) throw new ValidationError('Invalid deviceId');
  return value;
}

export function requireDate(value, what = 'date') {
  if (typeof value !== 'string' || !DATE.test(value)) throw new ValidationError(`${what} must look like 2026-10-31`);
  return value;
}

export function requireInt(value, what, { min, max }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ValidationError(`${what} must be a whole number from ${min} to ${max}`);
  }
  return number;
}

export const isLatitude = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
export const isLongitude = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

// Device names and place names: no control characters or angle brackets, trimmed, length-capped.
export function cleanText(value, maxLength, fallback = '') {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}
