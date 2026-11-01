// The little pictures on the map. Plain HTML elements, so Google Maps and OpenStreetMap
// show exactly the same thing. Styles live in dashboard.css (.pin ...).
function pin(className, symbol, title) {
  const node = document.createElement('div');
  node.className = `pin ${className}`;
  node.textContent = symbol;
  if (title) node.title = title;
  return node;
}

export const deviceMarker = ({ label, online, selected }) => {
  const node = pin(`device ${online ? 'online' : 'offline'}${selected ? ' selected' : ''}`, '', label);
  const name = document.createElement('span');
  name.className = 'pin-label';
  name.textContent = label;
  node.append(name);
  return node;
};

export const visitMarker = (status, title) =>
  pin(`visit ${status}`, { verified: '✓', off_site: '!', unplanned: '◆' }[status] ?? '•', title);

export const siteMarker = (status, title) =>
  pin(`site ${status}`, { verified: '✓', off_site: '!', not_visited: '' }[status] ?? '', title);

export const endpointMarker = (kind) => pin(`endpoint ${kind}`, kind === 'start' ? 'S' : 'E', kind === 'start' ? 'Start' : 'Latest');
