// Google Maps (Maps JavaScript API). Needs a key; billing applies after the free monthly allowance.
const ABUJA = { lat: 9.0765, lng: 7.3986 };
const LOAD_TIMEOUT_MS = 12000;

function loadGoogleScript(apiKey) {
  if (globalThis.google?.maps?.importLibrary) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Google Maps took too long to load')), LOAD_TIMEOUT_MS);
    globalThis.__googleMapsReady = () => {
      clearTimeout(timer);
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly&callback=__googleMapsReady`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Could not reach Google Maps'));
    };
    document.head.append(script);
  });
}

// onAuthFailure runs if Google rejects the key AFTER loading (wrong referrer, API not enabled, billing off).
export async function createGoogleEngine(container, { apiKey, mapId, onAuthFailure }) {
  globalThis.gm_authFailure = () => onAuthFailure?.();
  await loadGoogleScript(apiKey);
  const { Map, Polyline, Circle } = await google.maps.importLibrary('maps');
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

  const map = new Map(container, {
    center: ABUJA,
    zoom: 12,
    mapId,
    gestureHandling: 'greedy',
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: true,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
  });

  const wrap = (shape) => ({
    setVisible: (show) => {
      shape.setMap?.(show ? map : null);
      if ('map' in shape) shape.map = show ? map : null;
    },
    remove: () => {
      shape.setMap?.(null);
      if ('map' in shape) shape.map = null;
    },
  });

  return {
    provider: 'google',

    addMarker({ lat, lng, element, onClick }) {
      // Google anchors a marker by its bottom edge; shifting by half moves the anchor to the centre.
      const holder = document.createElement('div');
      holder.style.transform = 'translateY(50%)';
      holder.append(element);
      const marker = new AdvancedMarkerElement({ position: { lat, lng }, content: holder, gmpClickable: Boolean(onClick) });
      if (onClick) marker.addEventListener('gmp-click', onClick);
      return wrap(marker);
    },

    addLine({ path, color, weight, dashed, opacity }) {
      return wrap(new Polyline({
        path,
        strokeColor: color,
        strokeWeight: weight,
        strokeOpacity: dashed ? 0 : opacity,
        icons: dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: opacity, scale: 3 }, offset: '0', repeat: '12px' }] : undefined,
      }));
    },

    addCircle({ lat, lng, radiusM, color }) {
      return wrap(new Circle({
        center: { lat, lng },
        radius: radiusM,
        strokeColor: color,
        strokeWeight: 1.5,
        fillColor: color,
        fillOpacity: 0.12,
        clickable: false,
      }));
    },

    fitBounds(points) {
      const bounds = new google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 48);
      // A single point would zoom in to the maximum; keep it readable.
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if (map.getZoom() > 17) map.setZoom(17);
      });
    },
    panTo: (lat, lng, zoom) => {
      map.panTo({ lat, lng });
      if (zoom) map.setZoom(zoom);
    },
    onMapClick: (fn) => map.addListener('click', (e) => fn({ lat: e.latLng.lat(), lng: e.latLng.lng() })),
    setCursor: (cursor) => map.setOptions({ draggableCursor: cursor }),
  };
}
