import { $, el } from '/js/shared/dom.js';
import { api } from './api.js';

// Things that float over the page: error bar, info card, photo viewer, "click the map" banner.
export function createUi({ timezone }) {
  const errorBar = $('errorBar');
  const infoCard = $('infoCard');
  const modal = $('photoModal');
  let errorTimer = null;

  const closePhoto = () => {
    modal.hidden = true;
    $('photoImg').removeAttribute('src');
  };
  $('photoClose').addEventListener('click', closePhoto);
  modal.addEventListener('click', (e) => e.target === modal && closePhoto());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closePhoto());

  return {
    timezone,

    error(message) {
      errorBar.textContent = message;
      errorBar.hidden = false;
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => (errorBar.hidden = true), 8000);
    },

    // Runs an async action, showing any failure in the error bar instead of losing it.
    async guard(action) {
      try {
        return await action();
      } catch (err) {
        this.error(err.message);
        return undefined;
      }
    },

    showInfo(...children) {
      infoCard.replaceChildren(
        el('button', { type: 'button', class: 'icon close', 'aria-label': 'Close', text: '✕', onclick: () => (infoCard.hidden = true) }),
        ...children
      );
      infoCard.hidden = false;
    },
    hideInfo: () => (infoCard.hidden = true),

    showPhoto(visit) {
      $('photoCaption').textContent = `${visit.deviceLabel}: ${visit.name}`;
      $('photoImg').src = api.photoUrl(visit.id);
      modal.hidden = false;
    },

    pickBanner(show) {
      $('pickBanner').hidden = !show;
    },
  };
}
