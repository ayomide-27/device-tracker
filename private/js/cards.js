import { el } from '/js/shared/dom.js';
import { dateTimeLabel, FLAGS, STATUS } from './format.js';

export const statusChip = (status) => el('span', { class: `chip ${STATUS[status]?.cls ?? ''}`, text: STATUS[status]?.label ?? status });

export const flagChips = (flags) =>
  flags.map((flag) => el('span', { class: 'chip flag', title: FLAGS[flag]?.help ?? '', text: FLAGS[flag]?.label ?? flag }));

// The details of one check-in, used in the list and in the pop-up card on the map.
export function visitDetails(visit, ui) {
  const parts = [dateTimeLabel(visit.t, ui.timezone)];
  if (visit.distanceM !== null) parts.push(`${visit.distanceM} m from site`);
  if (visit.accuracyM !== null) parts.push(`GPS ±${Math.round(visit.accuracyM)} m`);
  return [
    el('h3', { text: visit.name }),
    el('div', { class: 'meta', text: `${visit.deviceLabel} · ${parts.join(' · ')}` }),
    el('div', { class: 'chips' }, statusChip(visit.status), ...flagChips(visit.flags)),
    visit.hasPhoto ? el('button', { type: 'button', class: 'secondary', text: 'View photo', onclick: () => ui.showPhoto(visit) }) : null,
  ];
}
