// Small settings kept in localStorage (survives closing the browser). Keys match version 2
// of the app, so phones already in use keep their identity.
const PREFIX = 'fot_';

export const settings = {
  get(key) {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
  getJson(key, fallback) {
    try {
      return JSON.parse(this.get(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  setJson(key, value) {
    return this.set(key, JSON.stringify(value));
  },
};
