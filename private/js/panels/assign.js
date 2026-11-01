import { el, $ } from '/js/shared/dom.js';

// PLAN tab, "Assign sites": paste the WhatsApp list, or place one site by clicking the map.
export function createAssignPanel({ store, api, map, ui }) {
  const checked = () => [...document.querySelectorAll('#targetList input:checked')].map((i) => i.value);

  function renderTargets({ devices }) {
    const previous = new Set(checked());
    const first = $('targetList').children.length === 0;
    $('targetList').replaceChildren(
      ...devices.map((d) =>
        el('label', {}, el('input', { type: 'checkbox', value: d.deviceId, checked: first || previous.has(d.deviceId) }), d.label)
      )
    );
  }

  async function assign(text) {
    const deviceIds = checked();
    if (deviceIds.length === 0) return ui.error('Tick at least one FO to give the sites to.');
    const { weekStart } = store.get();
    const result = await api.importSites({ text, deviceIds, weekStart });
    store.set({ planVersion: store.get().planVersion + 1 });
    return result;
  }

  $('importBtn').addEventListener('click', async () => {
    const button = $('importBtn');
    button.disabled = true;
    await ui.guard(async () => {
      const result = await assign($('importText').value);
      if (!result) return;
      $('importResult').textContent = `${result.created} new, ${result.reused} already known, ${result.sites.length} given to ${checked().length} FO(s).`;
      $('importErrors').replaceChildren(...result.errors.map((e) => el('li', { text: `Line ${e.line}: ${e.reason} (${e.text})` })));
      if (result.errors.length === 0) $('importText').value = '';
    });
    button.disabled = false;
  });

  $('pinBtn').addEventListener('click', async () => {
    const name = $('pinName').value.trim();
    if (!name) return ui.error('Type the site name first.');
    ui.pickBanner(true);
    const spot = await map.pickPoint();
    ui.pickBanner(false);
    if (!spot) return;
    await ui.guard(async () => {
      const result = await assign(`${name}, ${spot.lat.toFixed(6)}, ${spot.lng.toFixed(6)}`);
      if (result) {
        $('pinName').value = '';
        $('importResult').textContent = `${name} added and given to ${checked().length} FO(s).`;
        $('importErrors').replaceChildren();
      }
    });
  });
  $('pickCancel').addEventListener('click', () => map.cancelPick());

  store.subscribe((state, patch) => {
    if ('devices' in patch) renderTargets(state);
  });
}
