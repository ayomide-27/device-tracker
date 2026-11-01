import { RULES } from '../rules.js';
import { ValidationError } from '../errors.js';
import { downsample } from '../domain/points.js';
import { planItemStatus, visitFlags, visitStatus } from '../domain/visitAssessment.js';
import { requireDate, requireDeviceId, requireInt } from '../domain/validate.js';

const optionalDeviceId = (value) => (value === undefined || value === '' ? null : requireDeviceId(value));

// What supervisors look at: routes, judged check-ins, the weekly board.
export function createReviewService({ db, makeStores }) {
  const { calendar, devices, locations, visits, plans } = makeStores(db);

  const dayRange = async (query, maxDays) => {
    const date = query.date ? requireDate(query.date) : await calendar.today();
    const days = requireInt(query.days ?? 1, 'days', { min: 1, max: maxDays });
    return { date, days, ...(await calendar.range(date, days)) };
  };

  return {
    async devices() {
      const list = await devices.list();
      return list.map((d) => ({ ...d, online: d.ageSeconds < RULES.onlineWindowSeconds }));
    },

    async route(query) {
      const deviceId = requireDeviceId(query.deviceId);
      const range = await dayRange(query, RULES.maxRouteDays);
      const all = await locations.route(deviceId, range, 50_000);
      const points = downsample(all, RULES.maxRoutePointsShown);
      return { deviceId, date: range.date, days: range.days, total: all.length, shown: points.length, points };
    },

    async visits(query) {
      const range = await dayRange(query, RULES.maxRouteDays);
      const rows = await visits.listForReview({
        start: range.start,
        end: range.end,
        deviceId: optionalDeviceId(query.deviceId),
        trackWindowSeconds: RULES.trackWindowSeconds,
      });
      const now = new Date();
      return {
        date: range.date,
        days: range.days,
        visits: rows.map((v) => ({
          id: v.id,
          deviceId: v.deviceId,
          deviceLabel: v.deviceLabel,
          siteId: v.siteId,
          name: v.name,
          t: v.recordedAt.getTime(),
          lat: v.lat,
          lng: v.lng,
          accuracyM: v.accuracyM,
          distanceM: v.distanceM === null ? null : Math.round(v.distanceM),
          hasPhoto: v.hasPhoto,
          status: visitStatus(v),
          flags: visitFlags(v, { now }),
        })),
      };
    },

    async photo(visitId) {
      const photo = await visits.photo(visitId);
      if (!photo) throw new ValidationError('No photo for that check-in');
      return photo;
    },

    async board(query) {
      const weekStart = await calendar.weekStart(query.week ? requireDate(query.week, 'week') : null);
      const rows = await plans.board({ weekStart, deviceId: optionalDeviceId(query.deviceId) });
      const items = rows.map((r) => ({
        deviceId: r.deviceId,
        deviceLabel: r.deviceLabel,
        site: r.site,
        status: planItemStatus(r.visit),
        visit: r.visit && { id: r.visit.id, t: r.visit.t, distanceM: Math.round(r.visit.distanceM) },
      }));
      const count = (status) => items.filter((i) => i.status === status).length;
      return {
        weekStart,
        summary: { planned: items.length, verified: count('verified'), offSite: count('off_site'), notVisited: count('not_visited') },
        items,
      };
    },
  };
}
