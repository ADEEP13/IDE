import { crc32, fromHex, toHex } from '../util/bytes';
import { DeviceError } from '../util/errors';
import { assertOk, extractResult, pyStr } from './pyutil';
import type { DeviceSession } from './DeviceSession';

export interface DevEntry { name: string; path: string; isDir: boolean; size: number }
export type Progress = (done: number, total: number) => void;

const T = { idleTimeoutMs: 10000 };
const CHUNK = 2048; // bytes per exec (hex-encoded: 4 KB of source)

export const joinPath = (dir: string, name: string): string => (dir.endsWith('/') ? dir : dir + '/') + name;
export const normPath = (p: string): string => '/' + p.split('/').filter(Boolean).join('/');

/**
 * Device filesystem access. There is no host-side filesystem API: everything
 * is plain Python (`os`, `open`, `binascii`) executed over the raw REPL, the
 * same mechanism Thonny and mpremote use. Data travels hex-encoded.
 */
export class DeviceFs {
  constructor(private s: DeviceSession) {}

  list(dir = '/', opts: { background?: boolean } = {}): Promise<DevEntry[]> {
    return this.s.withRaw('Listing files', async (raw) => {
      const r = assertOk(await raw.exec(
        `import os,json\n__d=${pyStr(dir)}\nprint('@@'+json.dumps([[e[0],e[1],e[3] if len(e)>3 else 0] for e in os.ilistdir(__d)])+'@@')`, T));
      const rows = extractResult(r.stdout) as [string, number, number][];
      return rows
        .map(([name, type, size]) => ({ name, path: joinPath(dir, name), isDir: (type & 0x4000) !== 0, size }))
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    }, opts);
  }

  readFile(path: string, onProgress?: Progress): Promise<Uint8Array> {
    return this.s.withRaw(`Reading ${path}`, async (raw) => {
      const p = pyStr(path);
      const size = extractResult(assertOk(await raw.exec(`import os\nprint('@@'+str(os.stat(${p})[6])+'@@')`, T)).stdout) as number;
      const out = new Uint8Array(size);
      assertOk(await raw.exec(`import binascii\n__f=open(${p},'rb')\n__h=binascii.hexlify`, T));
      try {
        let off = 0;
        while (off < size) {
          const r = assertOk(await raw.exec(`print(__h(__f.read(${CHUNK})).decode())`, T));
          const chunk = fromHex(r.stdout.trim());
          if (!chunk.length) throw new DeviceError('Unexpected end of file while reading');
          out.set(chunk.subarray(0, size - off), off);
          off += chunk.length;
          onProgress?.(Math.min(off, size), size);
        }
      } finally {
        await raw.exec('try:\n __f.close()\nexcept:\n pass', T).catch(() => undefined);
      }
      return out;
    });
  }

  /** Writes a file (creating parent folders) and verifies size + CRC32. */
  writeFile(path: string, data: Uint8Array, onProgress?: Progress): Promise<{ size: number; crcVerified: boolean }> {
    return this.s.withRaw(`Writing ${path}`, async (raw) => {
      const p = pyStr(path);
      assertOk(await raw.exec(
        `import os,binascii\n__u=binascii.unhexlify\n__d=''\nfor __s in ${p}.split('/')[:-1]:\n if __s:\n  __d+='/'+__s\n  try:\n   os.mkdir(__d)\n  except OSError:\n   pass\n__f=open(${p},'wb')`, T));
      try {
        for (let off = 0; off < data.length; off += CHUNK) {
          assertOk(await raw.exec(`__f.write(__u('${toHex(data.subarray(off, off + CHUNK))}'))`, T));
          onProgress?.(Math.min(off + CHUNK, data.length), data.length);
        }
        assertOk(await raw.exec('__f.close()\ndel __f', T));
      } catch (e) {
        await raw.exec('try:\n __f.close()\nexcept:\n pass', T).catch(() => undefined);
        throw e;
      }
      const v = extractResult(assertOk(await raw.exec(
        `import os\n__n=os.stat(${p})[6]\n__c=0\ntry:\n import binascii\n with open(${p},'rb') as __f:\n  while True:\n   __b=__f.read(512)\n   if not __b:\n    break\n   __c=binascii.crc32(__b,__c)\nexcept Exception:\n __c=-1\nprint('@@['+str(__n)+','+str(__c&0xffffffff if __c>=0 else -1)+']@@')`, T)).stdout) as [number, number];
      if (v[0] !== data.length) throw new DeviceError(`Verification failed: device has ${v[0]} bytes, expected ${data.length}`);
      if (v[1] >= 0 && v[1] !== crc32(data)) throw new DeviceError('Verification failed: CRC32 mismatch after write');
      return { size: v[0], crcVerified: v[1] >= 0 };
    });
  }

  async remove(path: string): Promise<void> {
    const p = pyStr(path);
    await this.s.execOnce('Deleting', `import os\ntry:\n os.remove(${p})\nexcept OSError:\n os.rmdir(${p})`, T);
  }
  async mkdir(path: string): Promise<void> {
    await this.s.execOnce('Creating folder', `import os\nos.mkdir(${pyStr(path)})`, T);
  }
  async rename(from: string, to: string): Promise<void> {
    await this.s.execOnce('Renaming', `import os\nos.rename(${pyStr(from)},${pyStr(to)})`, T);
  }
}
