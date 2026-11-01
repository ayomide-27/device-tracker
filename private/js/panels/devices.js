import { el, $ } from '/js/shared/dom.js';
import { ago } from '../format.js';

// LIVE tab: where each phone is now. Also owns the phone markers on the map.
export function createDevicesPanel({ store, api, map, ui }) {
  const list = $('deviceList');
  let firstLoad = true;

  async function refresh() {
    const { devices } = await api.devices();
    store.set({ devices });
    if (firstLoad && devices.length > 0) {
      firstLoad = false;
      map.fit(['devices']);
    }
  }

  function render({ devices, selectedId }) {
    map.setDevices(devices, selectedId);
    $('deviceEmpty').hidden = devices.length > 0;
    list.replaceChildren(
      ...devices.map((d) =>
        el(
          'li',
          {
            class: `row${d.deviceId === selectedId ? ' selected' : ''}`,
            onclick: () => {
              store.set({ selectedId: d.deviceId });
              if (d.lat !== null) map.panTo(d.lat, d.lng, 16);
            },
          },
          el('span', { class: `dot${d.online ? ' online' : ''}` }),
          el(
            'div',
            { class: 'row-main' },
            el('strong', { text: d.label }),
            el('span', { class: 'meta', text: d.online ? 'Online' : `Offline · last contact ${ago(d.ageSeconds)}` })
          ),
          el(
            'div',
            { class: 'row-actions' },
            el('button', {
              type: 'button',
              title: 'Remove this phone and its history',
              text: 'Remove',
              onclick: (event) => {
                event.stopPropagation();
                if (!confirm(`Remove ${d.label} and all its saved routes and check-ins?`)) return;
                ui.guard(async () => {
                  await api.removeDevice(d.deviceId);
                  if (store.get().selectedId === d.deviceId) store.set({ selectedId: null });
                  await refresh();
                });
              },
            })
          )
        )
      )
    );
  }

  store.subscribe((state, patch) => {
    if ('devices' in patch || 'selectedId' in patch) render(state);
  });
  map.on('deviceClick', (d) => store.set({ selectedId: d.deviceId }));

  return { refresh };
}
