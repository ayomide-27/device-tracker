import { el, $, setOptions } from '/js/shared/dom.js';
import { addDays, dayLabel, STATUS, timeLabel } from '../format.js';
import { statusChip } from '../cards.js';

// PLAN tab: the weekly board (who has visited which assigned site) and where the sites are on the map.
export function createPlanPanel({ store, api, map, ui }) {
  let token = 0;
  let filterId = '';
  const RANK = { verified: 3, off_site: 2, not_visited: 1 };

  async function load() {
    const mine = ++token;
    const { weekStart } = store.get();
    const board = await api.board({ week: weekStart });
    if (mine !== token) return;
    store.set({ board });
    render();
  }

  const visibleItems = () => (store.get().board?.items ?? []).filter((i) => !filterId || i.deviceId === filterId);

  function render() {
    const { board, weekStart, devices, config } = store.get();
    $('weekLabel').textContent = `Week of ${dayLabel(weekStart)}`;
    setOptions($('planDevice'), [{ value: '', text: 'All FOs' }, ...devices.map((d) => ({ value: d.deviceId, text: d.label }))], filterId);
    $('boardCsv').href = api.boardCsvUrl({ week: weekStart, deviceId: filterId });
    if (!board) return;

    const items = visibleItems();
    const count = (status) => items.filter((i) => i.status === status).length;
    $('boardSummary').replaceChildren(
      el('span', { class: 'chip', text: `${items.length} planned` }),
      el('span', { class: 'chip ok', text: `${count('verified')} verified` }),
      el('span', { class: 'chip warn', text: `${count('off_site')} off site` }),
      el('span', { class: 'chip muted', text: `${count('not_visited')} not visited` })
    );
    $('boardEmpty').hidden = items.length > 0;

    // Grouped by FO.
    const byFo = Map.groupBy(items, (i) => i.deviceId);
    const rows = [];
    for (const [deviceId, group] of byFo) {
      const done = group.filter((i) => i.status === 'verified').length;
      rows.push(el('li', { class: 'meta', text: `${group[0].deviceLabel}: ${done} of ${group.length} verified` }));
      for (const item of group) {
        rows.push(
          el(
            'li',
            { class: 'row', onclick: () => map.panTo(item.site.lat, item.site.lng, 16) },
            el(
              'div',
              { class: 'row-main' },
              el('strong', { text: item.site.name }),
              item.visit ? el('span', { class: 'meta', text: `${timeLabel(item.visit.t, config.timezone)} · ${item.visit.distanceM} m from site` }) : null
            ),
            statusChip(item.status),
            el('div', { class: 'row-actions' }, el('button', {
              type: 'button',
              title: 'Take this site off this FO\'s list for the week',
              text: '✕',
              onclick: (event) => {
                event.stopPropagation();
                ui.guard(async () => {
                  const keep = store.get().board.items.filter((i) => i.deviceId === deviceId && i.site.id !== item.site.id).map((i) => i.site.id);
                  await api.setPlan({ deviceId, weekStart, siteIds: keep });
                  store.set({ planVersion: store.get().planVersion + 1 });
                });
              },
            }))
          )
        );
      }
    }
    $('boardList').replaceChildren(...rows);

    // On the map: one ring per site, coloured by the best result any FO got there.
    const best = new Map();
    for (const i of items) {
      const have = best.get(i.site.id);
      if (!have || RANK[i.status] > RANK[have.status]) best.set(i.site.id, { ...i.site, status: i.status });
    }
    map.setSites([...best.values()]);
  }

  $('weekPrev').addEventListener('click', () => store.set({ weekStart: addDays(store.get().weekStart, -7) }));
  $('weekNext').addEventListener('click', () => store.set({ weekStart: addDays(store.get().weekStart, 7) }));
  $('weekNow').addEventListener('click', () => store.set({ weekStart: store.get().config.weekStart }));
  $('planDevice').addEventListener('change', (e) => {
    filterId = e.target.value;
    store.set({ planFilter: filterId || null });
    render();
  });

  let active = false;
  store.subscribe((state, patch) => {
    if (active && ('weekStart' in patch || 'planVersion' in patch)) ui.guard(load);
    if (active && 'devices' in patch) render();
  });
  map.on('siteClick', (site) => {
    ui.showInfo(
      el('h3', { text: site.name }),
      el('div', { class: 'meta', text: `Check-in area: ${site.radiusM} m` }),
      el('div', { class: 'chips' }, statusChip(site.status))
    );
  });

  return {
    activate() {
      active = true;
      return ui.guard(load);
    },
    deactivate() {
      active = false;
    },
  };
}
