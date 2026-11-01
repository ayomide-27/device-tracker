// Tiny helpers for building page content safely: text goes in as text, never as HTML.
export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// Fills a <select>. Does nothing when the options have not changed, so a dropdown the user has
// open is not rebuilt (and closed) by a background refresh.
export function setOptions(select, options, selected = '') {
  const signature = JSON.stringify(options);
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...options.map(({ value, text }) => el('option', { value, text })));
    select.dataset.signature = signature;
  }
  select.value = selected;
}
