const encoder = new TextEncoder();
export const bytes = (s: string): Uint8Array => encoder.encode(s);
export const text = (b: Uint8Array): string => new TextDecoder().decode(b);
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function indexOfSeq(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const last = hay.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function toHex(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += b.toString(16).padStart(2, '0');
  return s;
}
export function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

let table: Uint32Array | null = null;
/** CRC-32 (same as zlib / binascii.crc32). */
export function crc32(data: Uint8Array, seed = 0): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = (seed ^ 0xffffffff) >>> 0;
  for (const b of data) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Converts bare LF to CRLF across chunk boundaries (terminal output). */
export class NewlineFixer {
  private prev = 0;
  fix(chunk: Uint8Array): Uint8Array {
    let extra = 0;
    let p = this.prev;
    for (const b of chunk) { if (b === 0x0a && p !== 0x0d) extra++; p = b; }
    if (!extra) { this.prev = p; return chunk; }
    const out = new Uint8Array(chunk.length + extra);
    let o = 0; p = this.prev;
    for (const b of chunk) {
      if (b === 0x0a && p !== 0x0d) out[o++] = 0x0d;
      out[o++] = b; p = b;
    }
    this.prev = p;
    return out;
  }
}
