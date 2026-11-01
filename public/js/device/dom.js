export { $, el } from '../shared/dom.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
