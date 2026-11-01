// Deletes data older than the retention period. Runs at startup and every few hours.
export function createMaintenanceService({ config, makeStores, db }) {
  return {
    async purge() {
      const { locations, visits, plans, devices } = makeStores(db);
      const days = config.retentionDays;
      const counts = {
        points: await locations.purge(days),
        visits: await visits.purge(days),
        planItems: await plans.purge(days),
        devices: await devices.purgeIdle(days),
      };
      return counts;
    },
  };
}
