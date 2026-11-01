import { $ } from '/js/shared/dom.js';
import { api } from './api.js';
import { openMap } from './map/index.js';
import { createStore } from './state.js';
import { createUi } from './ui.js';
import { createAssignPanel } from './panels/assign.js';
import { createDayPanel } from './panels/day.js';
import { createDevicesPanel } from './panels/devices.js';
import { createLibraryPanel } from './panels/library.js';
import { createPlanPanel } from './panels/plan.js';

const DEVICE_REFRESH_MS = 10_000;

async function main() {
  const config = await api.config(); // map key, time zone, and what "today" and "this week" are
  const ui = createUi({ timezone: config.timezone });
  const store = createStore({
    config,
    devices: [],
    selectedId: null, // the FO being looked at (null = all)
    date: config.today,
    days: 1,
    weekStart: config.weekStart,
    planFilter: null,
    board: null,
    planVersion: 0, // goes up whenever sites or plans change, so open panels reload
  });

  const { view: map, note } = await openMap($('map'), config);
  if (note) {
    $('mapNote').textContent = note;
    $('mapNote').hidden = false;
  }

  // ---------- Panels ----------
  const devices = createDevicesPanel({ store, api, map, ui });
  const day = createDayPanel({ store, api, map, ui });
  const plan = createPlanPanel({ store, api, map, ui });
  const library = createLibraryPanel({ store, api, map, ui });
  createAssignPanel({ store, api, map, ui });

  // ---------- Tabs ----------
  const tabs = {
    live: { panel: $('panel-live'), on: () => {}, off: () => {} },
    day: { panel: $('panel-day'), on: () => day.activate(), off: () => day.deactivate() },
    plan: {
      panel: $('panel-plan'),
      on: () => {
        setLayer('planned', true);
        return Promise.all([plan.activate(), library.activate()]);
      },
      off: () => {
        plan.deactivate();
        library.deactivate();
      },
    },
  };
  let current = 'live';
  function showTab(name) {
    tabs[current].off();
    current = name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    for (const [key, tab] of Object.entries(tabs)) tab.panel.hidden = key !== name;
    ui.hideInfo();
    tabs[name].on();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ---------- Layer toggles ----------
  function setLayer(layer, visible) {
    map.setLayerVisible(layer, visible);
    document.querySelector(`#layers input[data-layer="${layer}"]`).checked = visible;
  }
  document.querySelectorAll('#layers input').forEach((box) => box.addEventListener('change', () => map.setLayerVisible(box.dataset.layer, box.checked)));
  map.setLayerVisible('planned', false);
  $('fitBtn').addEventListener('click', () => map.fit());

  // ---------- Live updates ----------
  await ui.guard(devices.refresh);
  setInterval(() => ui.guard(devices.refresh), DEVICE_REFRESH_MS);
}

main().catch((err) => {
  document.body.insertAdjacentHTML('afterbegin', '<p class="error" id="fatal"></p>');
  document.getElementById('fatal').textContent = `The dashboard could not start: ${err.message}`;
  console.error(err);
});
