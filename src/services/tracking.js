import { RULES } from '../rules.js';
import { ValidationError } from '../errors.js';
import { cleanPoints } from '../domain/points.js';
import { parseCheckin } from '../domain/checkin.js';
import { visitStatus } from '../domain/visitAssessment.js';
import { cleanText, requireDeviceId } from '../domain/validate.js';

// What phones send us: GPS points and check-ins. Each upload is one transaction,
// so a device never ends up half-saved.
export function createTrackingService({ db, config, makeStores }) {
  return {
    async recordLocations(body) {
      const { deviceId, label, points } = body ?? {};
      requireDeviceId(deviceId);
      if (!Array.isArray(points) || points.length > RULES.maxPointsPerUpload) {
        throw new ValidationError(`points must be a list of at most ${RULES.maxPointsPerUpload}`);
      }
      const { good, rejected } = cleanPoints(points, { retentionDays: config.retentionDays });

      const saved = await db.transaction(async (tx) => {
        const { devices, locations } = makeStores(tx);
        await devices.touch({ deviceId, label: cleanText(label, 60) || null });
        const count = await locations.insertBatch(deviceId, good);
        if (count > 0) await devices.refreshLastFix(deviceId);
        return count;
      });
      return { ok: true, saved, rejected };
    },

    // Saving the same check-in twice (a retry after a dropped connection) is harmless.
    async recordCheckin(body) {
      const { deviceId, label, checkin } = parseCheckin(body, { retentionDays: config.retentionDays });

      return db.transaction(async (tx) => {
        const { devices, visits } = makeStores(tx);
        await devices.touch({ deviceId, label });
        const inserted = await visits.insert({ deviceId, checkin });
        const stored = await visits.get(checkin.id);
        if (stored.deviceId !== deviceId) throw new ValidationError('Check-in id already used');

        return {
          ok: true,
          saved: inserted !== null,
          status: visitStatus(stored),
          distanceM: stored.distanceM === null ? null : Math.round(stored.distanceM),
        };
      });
    },
  };
}
