import { createCalendarStore } from './calendar.js';
import { createDevicesStore } from './devices.js';
import { createLocationsStore } from './locations.js';
import { createPlansStore } from './plans.js';
import { createSitesStore } from './sites.js';
import { createVisitsStore } from './visits.js';

// All stores bound to one database handle. Pass a transaction handle (from db.transaction)
// to make several store calls succeed or fail together.
export function createStores(db, { timezone }) {
  return {
    calendar: createCalendarStore(db, timezone),
    devices: createDevicesStore(db),
    locations: createLocationsStore(db),
    plans: createPlansStore(db, timezone),
    sites: createSitesStore(db),
    visits: createVisitsStore(db),
  };
}
