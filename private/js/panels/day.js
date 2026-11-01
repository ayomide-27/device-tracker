import { el, $, setOptions } from '/js/shared/dom.js';
import { metresBetween } from '/js/shared/geo.js';
import { flagChips, statusChip, visitDetails } from '../cards.js';
import { addDays, km, timeLabel } from '../format.js';

const AUTO_REFRESH_MS = 30_000;

// DAY tab: one FO's route and check-ins for a day (or a few days), on the map and as a list.
export function createDayPanel({ store, api, map, ui }) {
  let token = 0; // ignores answers that arrive after the supervisor has already changed the filter

  const filter = () => {
    const { selectedId, date, days } = store.get();
    return { deviceId: selectedId, date, days };
  };

  const routeLength = (points) => points.reduce((sum, p, i) => (i === 0 ? 0 : sum + metresBetween(points[i - 1], p)), 0);

  async function load({ refit = true } = {}) {
    const mine = ++token;
    const params = filter();
    const [route, visits] = await Promise.all([
      params.deviceId ? api.route(params) : null,
      api.visits(params),
    ]);
    if (mine !== token) return;

    const points = route?.points ?? [];
    map.setRoute(points);
    map.setVisits(visits.visits);
    render(visits.visits, route);
    if (refit) map.fit(['route', 'visits']);
  }

  function render(visits, route) {
    const { timezone } = store.get().config;
    const flagged = visits.filter((v) => v.flags.length > 0 || v.status === 'off_site').length;
    const parts = [];
    if (route) parts.push(route.total === 0 ? 'No route points' : `Route: ${route.total} points, about ${km(routeLength(route.points))}`);
    else parts.push('Pick an FO to see their route');
    parts.push(`${visits.length} check-in${visits.length === 1 ? '' : 's'}${flagged ? `, ${flagged} to review` : ''}`);
    $('daySummary').textContent = parts.join(' · ');

    $('visitEmpty').hidden = visits.length > 0;
    $('visitList').replaceChildren(
      ...visits.map((v) =>
        el(
          'li',
          {
            class: 'row',
            onclick: () => {
              map.panTo(v.lat, v.lng, 17);
              ui.showInfo(...visitDetails(v, ui));
            },
          },
          el(
            'div',
            { class: 'row-main' },
            el('strong', { text: v.name }),
            el('span', { class: 'meta', text: `${store.get().selectedId ? '' : `${v.deviceLabel} · `}${timeLabel(v.t, timezone)}${v.distanceM === null ? '' : ` · ${v.distanceM} m from site`}` }),
            el('div', { class: 'chips' }, statusChip(v.status), ...flagChips(v.flags))
          ),
          v.hasPhoto
            ? el('div', { class: 'row-actions' }, el('button', { type: 'button', text: 'Photo', onclick: (e) => { e.stopPropagation(); ui.showPhoto(v); } }))
            : null
        )
      )
    );
    $('visitsCsv').href = api.visitsCsvUrl(filter());
  }

  function syncControls({ devices, selectedId, date, days }) {
    setOptions(
      $('dayDevice'),
      [{ value: '', text: 'All FOs (check-ins only)' }, ...devices.map((d) => ({ value: d.deviceId, text: d.label }))],
      selectedId ?? ''
    );
    $('dayDate').value = date;
    $('dayRange').value = String(days);
  }

  $('dayDevice').addEventListener('change', (e) => store.set({ selectedId: e.target.value || null }));
  $('dayDate').addEventListener('change', (e) => e.target.value && store.set({ date: e.target.value }));
  $('dayRange').addEventListener('change', (e) => store.set({ days: Number(e.target.value) }));
  $('dayPrev').addEventListener('click', () => store.set({ date: addDays(store.get().date, -1) }));
  $('dayNext').addEventListener('click', () => store.set({ date: addDays(store.get().date, 1) }));
  $('dayToday').addEventListener('click', () => store.set({ date: store.get().config.today }));

  let active = false;
  store.subscribe((state, patch) => {
    if ('devices' in patch || 'selectedId' in patch || 'date' in patch || 'days' in patch) syncControls(state);
    if (active && ('selectedId' in patch || 'date' in patch || 'days' in patch)) ui.guard(() => load());
  });
  map.on('visitClick', (v) => ui.showInfo(...visitDetails(v, ui)));

  setInterval(() => {
    const { date, config } = store.get();
    if (active && date <= config.today) ui.guard(() => load({ refit: false }));
  }, AUTO_REFRESH_MS);

  return {
    activate() {
      active = true;
      syncControls(store.get());
      return ui.guard(() => load());
    },
    deactivate() {
      active = false;
    },
  };
}
