import { settings } from './storage.js';

// This week's sites. The last copy from the server is kept on the phone, so the list still
// shows when there is no internet.
export function createPlan({ api, config, getIdentity, onChange }) {
  let plan = settings.getJson('plan', null); // { weekStart, sites, rules, fetchedAt }
  let timer = null;

  async function refresh() {
    try {
      const response = await api.getPlan(getIdentity());
      if (response.ok) {
        plan = { ...response.data, fetchedAt: Date.now() };
        settings.setJson('plan', plan);
        onChange();
      }
    } catch {
      /* offline: keep the saved copy */
    }
  }

  return {
    get: () => plan,
    visitAccuracyM: () => plan?.rules?.visitAccuracyM ?? config.DEFAULT_VISIT_ACCURACY_M,
    refresh,
    start() {
      refresh();
      timer = setInterval(refresh, config.PLAN_REFRESH_SECONDS * 1000);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
