import { el, $ } from '/js/shared/dom.js';

// PLAN tab, "All sites": rename-free housekeeping. Change a site's check-in radius, retire it,
// or add it to this week for the FO shown above.
export function createLibraryPanel({ store, api, map, ui }) {
  async function load() {
    const { sites } = await api.sites();
    $('libraryEmpty').hidden = sites.length > 0;
    $('libraryList').replaceChildren(
      ...sites.map((site) =>
        el(
          'li',
          { class: 'row', onclick: () => map.panTo(site.lat, site.lng, 16) },
          el('div', { class: 'row-main' }, el('strong', { text: site.name }), el('span', { class: 'meta', text: `Check-in area ${site.radiusM} m` })),
          el(
            'div',
            { class: 'row-actions' },
            el('button', { type: 'button', text: 'Radius', onclick: (e) => { e.stopPropagation(); changeRadius(site); } }),
            el('button', { type: 'button', text: 'Archive', onclick: (e) => { e.stopPropagation(); archive(site); } })
          )
        )
      )
    );
  }

  const bump = () => store.set({ planVersion: store.get().planVersion + 1 });

  function changeRadius(site) {
    const answer = prompt(`Check-in radius for ${site.name} in metres (20 to 2000):`, String(site.radiusM));
    if (answer === null) return;
    ui.guard(async () => {
      await api.updateSite(site.id, { radiusM: Number(answer) });
      bump();
    });
  }

  function archive(site) {
    if (!confirm(`Archive ${site.name}? It disappears from lists and plans; old check-ins keep their record.`)) return;
    ui.guard(async () => {
      await api.archiveSite(site.id);
      bump();
    });
  }

  let active = false;
  store.subscribe((state, patch) => {
    if (active && 'planVersion' in patch) ui.guard(load);
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
