import { createGoogleEngine } from './googleEngine.js';
import { createLeafletEngine } from './leafletEngine.js';
import { createMapView } from './view.js';

const FLAG = 'fot_map_fallback';

// Opens the best map available. Google Maps when a key is set and works; otherwise OpenStreetMap.
// If Google rejects the key after loading, the page remembers that for this browser session and
// reloads in OpenStreetMap mode so the supervisor is never left with a broken map.
// Add ?map=google to the address to try Google again.
export async function openMap(container, config) {
  const params = new URLSearchParams(location.search);
  if (params.get('map') === 'google') sessionStorage.removeItem(FLAG);

  let note = '';
  const fallbackReason = sessionStorage.getItem(FLAG);

  if (config.googleMapsApiKey && !fallbackReason) {
    try {
      const engine = await createGoogleEngine(container, {
        apiKey: config.googleMapsApiKey,
        mapId: config.googleMapId,
        onAuthFailure: () => {
          sessionStorage.setItem(FLAG, 'Google rejected the API key (check the key restrictions, enabled APIs and billing)');
          location.reload();
        },
      });
      return { view: createMapView(engine), note };
    } catch (err) {
      note = `Google Maps unavailable (${err.message}); showing OpenStreetMap.`;
      container.replaceChildren(); // discard anything the failed attempt left behind
    }
  } else if (fallbackReason) {
    note = `${fallbackReason}. Showing OpenStreetMap. Add ?map=google to the address to retry.`;
  } else {
    note = 'No Google Maps key set; showing OpenStreetMap.';
  }
  return { view: createMapView(await createLeafletEngine(container)), note };
}
