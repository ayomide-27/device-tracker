import { ValidationError, NotFoundError } from '../errors.js';
import { RULES } from '../rules.js';
import { parseSiteLines } from '../domain/siteImport.js';
import { cleanText, isLatitude, isLongitude, requireDeviceId, requireInt, requireUuid } from '../domain/validate.js';

const parseRadius = (value) =>
  value === undefined || value === null || value === ''
    ? RULES.defaultSiteRadiusM
    : requireInt(value, 'radiusM', { min: RULES.minSiteRadiusM, max: RULES.maxSiteRadiusM });

// Sites and weekly plans: who should visit what, this week.
export function createPlanningService({ db, makeStores }) {
  const { calendar } = makeStores(db);

  const requireDeviceIds = (body) => {
    const ids = body.deviceIds ?? (body.deviceId ? [body.deviceId] : []);
    if (!Array.isArray(ids)) throw new ValidationError('deviceIds must be a list');
    return ids.map(requireDeviceId);
  };

  return {
    async addSite(body) {
      const name = cleanText(body?.name, 80);
      if (!name) throw new ValidationError('Site needs a name');
      if (!isLatitude(body.lat) || !isLongitude(body.lng)) throw new ValidationError('Invalid coordinates');
      return makeStores(db).sites.findOrCreate({ name, lat: body.lat, lng: body.lng, radiusM: parseRadius(body.radiusM) });
    },

    async updateSite(siteId, body) {
      requireUuid(siteId, 'Site id');
      const name = body?.name === undefined ? null : cleanText(body.name, 80);
      if (body?.name !== undefined && !name) throw new ValidationError('Site needs a name');
      const radiusM = body?.radiusM === undefined ? null : parseRadius(body.radiusM);
      const site = await makeStores(db).sites.update(siteId, { name, radiusM });
      if (!site) throw new NotFoundError('Site not found');
      return site;
    },

    async archiveSite(siteId) {
      requireUuid(siteId, 'Site id');
      if (!(await makeStores(db).sites.archive(siteId))) throw new NotFoundError('Site not found');
    },

    async setPlan(body) {
      const deviceIds = requireDeviceIds(body ?? {});
      if (deviceIds.length === 0) throw new ValidationError('Choose at least one FO');
      if (!Array.isArray(body.siteIds)) throw new ValidationError('siteIds must be a list');
      const siteIds = body.siteIds.map((id) => requireUuid(id, 'Site id'));
      const weekStart = await calendar.weekStart(body.weekStart ?? null);

      await db.transaction(async (tx) => {
        const { plans } = makeStores(tx);
        for (const deviceId of deviceIds) await plans.replace({ deviceId, weekStart, siteIds });
      });
      return { weekStart };
    },

    // Pasted list of sites (one per line) -> sites created or reused, optionally added to FOs' weeks.
    async importSites(body) {
      const { sites: parsed, errors } = parseSiteLines(String(body?.text ?? ''));
      const deviceIds = requireDeviceIds(body ?? {});
      const weekStart = await calendar.weekStart(body?.weekStart ?? null);

      const result = await db.transaction(async (tx) => {
        const { sites, plans } = makeStores(tx);
        const imported = [];
        let created = 0;
        for (const line of parsed) {
          const { site, created: isNew } = await sites.findOrCreate(line);
          if (isNew) created += 1;
          imported.push(site);
        }
        const siteIds = imported.map((s) => s.id);
        for (const deviceId of deviceIds) await plans.add({ deviceId, weekStart, siteIds });
        return { sites: imported, created };
      });

      return { weekStart, ...result, reused: result.sites.length - result.created, errors };
    },
  };
}
