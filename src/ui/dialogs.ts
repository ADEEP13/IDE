import { h } from './dom';

function modal<T>(build: (close: (v: T) => void) => HTMLElement[], cancelValue: T): Promise<T> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'modal' });
    const close = (v: T) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(...build(close));
    dlg.addEventListener('cancel', () => close(cancelValue));
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function promptText(title: string, initial = '', hint = ''): Promise<string | null> {
  return modal<string | null>((close) => {
    const input = h('input', { type: 'text', value: initial, spellcheck: 'false' });
    const ok = () => { const v = input.value.trim(); close(v || null); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    queueMicrotask(() => { input.focus(); input.select(); });
    return [
      h('h3', { text: title }), input, hint ? h('p', { class: 'hint', text: hint }) : h('span'),
      h('div', { class: 'row end' }, h('button', { text: 'Cancel', onclick: () => close(null) }), h('button', { class: 'primary', text: 'OK', onclick: ok })),
    ];
  }, null);
}

export function confirmBox(message: string, okLabel = 'OK'): Promise<boolean> {
  return modal<boolean>((close) => [
    h('p', { text: message }),
    h('div', { class: 'row end' }, h('button', { text: 'Cancel', onclick: () => close(false) }), h('button', { class: 'primary', text: okLabel, onclick: () => close(true) })),
  ], false);
}
