import { h } from './dom';

export function toast(message: string, level: 'info' | 'ok' | 'warn' | 'error' = 'info', ms = 4500): void {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const el = h('div', { class: `toast ${level}`, text: message, onclick: () => el.remove() });
  host.append(el);
  setTimeout(() => el.remove(), level === 'error' ? ms * 2 : ms);
}
