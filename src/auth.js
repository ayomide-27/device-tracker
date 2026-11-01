import crypto from 'node:crypto';

// Compares via hashes so the check takes the same time whatever the input.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// The browser shows its own login box. The username is ignored; the password must match.
export function dashboardAuth({ dashboardPassword }) {
  return (req, res, next) => {
    if (!dashboardPassword) return next();
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(password, dashboardPassword)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="FO Tracker dashboard"');
    res.status(401).send('Login required');
  };
}

// Phones prove themselves with an access code in the x-device-key header (when one is configured).
export function deviceAuth({ deviceKey }) {
  return (req, res, next) => {
    if (!deviceKey) return next();
    if (safeEqual(req.get('x-device-key') || '', deviceKey)) return next();
    res.status(401).json({ error: 'Access code not accepted' });
  };
}
