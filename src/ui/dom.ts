import { icon } from './icons';

type Child = Node | string | null | false | undefined;

/** Minimal hyperscript helper. `on*` props are event listeners; `class`/`text`/`icon` are shortcuts. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  let iconName = '';
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'icon') iconName = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  if (iconName) {
    el.prepend(icon(iconName));
    // icon-only buttons need an accessible name now that there is no glyph text
    if (!el.textContent && props.title && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', String(props.title));
  }
  return el;
}

export function download(name: string, data: Uint8Array | string): void {
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function downloadZip(name: string, files: readonly { name: string; data: string }[]): void {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const fileName = encoder.encode(file.name.replaceAll('\\', '/'));
    const data = encoder.encode(file.data);
    const header = new Uint8Array(30 + fileName.length);
    const view = new DataView(header.buffer);
    const checksum = crc32(data);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, fileName.length, true);
    header.set(fileName, 30);
    parts.push(header, data);

    const directory = new Uint8Array(46 + fileName.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0x0800, true);
    directoryView.setUint32(16, checksum, true);
    directoryView.setUint32(20, data.length, true);
    directoryView.setUint32(24, data.length, true);
    directoryView.setUint16(28, fileName.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(fileName, 46);
    central.push(directory);
    offset += header.length + data.length;
  }

  const directorySize = central.reduce((size, entry) => size + entry.length, 0);
  const footer = new Uint8Array(22);
  const footerView = new DataView(footer.buffer);
  footerView.setUint32(0, 0x06054b50, true);
  footerView.setUint16(8, files.length, true);
  footerView.setUint16(10, files.length, true);
  footerView.setUint32(12, directorySize, true);
  footerView.setUint32(16, offset, true);
  download(name, concat(parts.concat(central, footer)));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export function pickFiles(accept = '', multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
