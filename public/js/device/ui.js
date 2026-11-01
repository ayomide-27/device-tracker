import { $, clock, el, plural } from './dom.js';

// Everything that changes what the FO sees. No logic about GPS or uploads lives here.

export function showSetup({ message, leftoverText }) {
  $('running').hidden = true;
  $('setup').hidden = false;
  $('setupMessage').hidden = !message;
  $('setupMessage').textContent = message ?? '';
  $('leftover').hidden = !leftoverText;
  $('leftover').textContent = leftoverText ?? '';
}

export function showRunning() {
  $('setup').hidden = true;
  $('running').hidden = false;
}

export function renderStatus(model) {
  $('dot').className = `dot ${model.cls}`;
  $('stateText').textContent = model.text;
  $('lastFix').textContent = model.lastFix;
  $('pending').textContent = model.pending;
  $('lastUpload').textContent = model.lastUpload;
  $('hint').textContent = model.hint;
}

const STATUS_TEXT = {
  verified: 'Verified',
  off_site: 'Marked off site',
  unplanned: 'Saved',
};

function visitState(visit) {
  if (visit.state === 'pending') return { cls: 'pending', text: 'Waiting to upload' };
  if (visit.state === 'rejected') return { cls: 'bad', text: `Not accepted: ${visit.result?.error ?? 'rejected'}` };
  const status = visit.result?.status;
  const distance = visit.result?.distanceM;
  const text = `${STATUS_TEXT[status] ?? 'Saved'}${distance == null ? '' : ` (${distance} m from site)`}`;
  return { cls: status === 'off_site' ? 'warn' : 'ok', text };
}

// planned sites for the week, each with a Check in button and a Navigate link
export function renderSites({ plan, checkedInToday, onCheckin }) {
  const list = $('siteList');
  list.replaceChildren();

  if (!plan) {
    $('planMeta').textContent = 'No site list yet. Your supervisor will assign sites; this updates by itself.';
    return;
  }
  const when = new Date(plan.fetchedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  $('planMeta').textContent =
    plan.sites.length === 0
      ? `No sites assigned this week yet. Last checked ${when}.`
      : `${plural(plan.sites.length, 'site')} this week. List updated ${when}.`;

  for (const site of plan.sites) {
    const done = checkedInToday.has(site.id);
    list.append(
      el(
        'li',
        { class: 'site' },
        el(
          'div',
          { class: 'site-main' },
          el('strong', { text: site.name }),
          done ? el('span', { class: 'chip ok', text: 'Checked in today' }) : null
        ),
        el(
          'div',
          { class: 'site-actions' },
          el('button', { type: 'button', class: 'small', text: 'Check in', onclick: () => onCheckin(site) }),
          el('a', {
            class: 'link',
            text: 'Navigate',
            target: '_blank',
            rel: 'noopener',
            href: `https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lng}`,
          })
        )
      )
    );
  }
}

export function renderToday(visits) {
  const list = $('todayList');
  list.replaceChildren();
  $('todayEmpty').hidden = visits.length > 0;

  for (const visit of visits) {
    const state = visitState(visit);
    list.append(
      el(
        'li',
        { class: 'visit' },
        el('div', {}, el('strong', { text: visit.siteName ?? visit.placeName }), el('div', { class: 'meta', text: clock(visit.t) })),
        el('span', { class: `chip ${state.cls}`, text: state.text })
      )
    );
  }
}
