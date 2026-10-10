import type { DeviceFs, Progress } from '../device/DeviceFs';
import { pyStr } from '../device/pyutil';
import type { DeviceSession } from '../device/DeviceSession';
import type { DeviceInfo } from '../device/types';
import { DeviceError } from '../util/errors';

/**
 * Size of every SLG47910 bitstream in Vicharak's reference set (community-verified:
 * github.com/Xenoah/shrike-lite-playground). Official docs do not state it, so a
 * mismatch is only a warning.
 */
export const EXPECTED_BITSTREAM_SIZE = 46408;

export interface CompatReport {
  level: 'ok' | 'warn' | 'fail';
  messages: string[];
  info: DeviceInfo | null;
}

/** Pure check of probe results. `flash` is the only API we require (documented: shrike.flash("name.bin")). */
export function evaluateCompat(info: DeviceInfo | null): CompatReport {
  if (!info) return { level: 'fail', messages: ['Not connected, or the device has not been probed yet.'], info };
  const fail: string[] = [];
  const warn: string[] = [];
  if (!info.hasShrike)
    fail.push(`The "shrike" module is not available (${info.importError || 'import failed'}). Install Vicharak's custom MicroPython UF2 for your board from github.com/vicharak-in/shrike/releases.`);
  else if (!info.hasFlash) fail.push('The "shrike" module has no flash() function; this firmware is not supported.');
  if (info.impl !== 'micropython') fail.push(`Firmware is "${info.impl}", expected MicroPython.`);
  if (info.platform !== 'rp2') warn.push(`Platform is "${info.platform}", Shrike-Lite uses an RP2040 ("rp2").`);
  if (info.hasShrike && !/shrike/i.test(info.machine)) warn.push(`Board string "${info.machine}" does not mention Shrike.`);
  const messages = [...fail, ...warn];
  if (!messages.length) messages.push(`MicroPython ${info.version} · ${info.machine} · shrike.flash() available${info.hasReset ? ' · shrike.reset() available' : ''}.`);
  return { level: fail.length ? 'fail' : warn.length ? 'warn' : 'ok', messages, info };
}

export function inspectBitstream(name: string, data: Uint8Array): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^[\w.\-]+\.bin$/i.test(name)) errors.push('Name must be letters/digits/._- and end in .bin');
  if (!data.length) errors.push('File is empty.');
  if (data.length && data.length !== EXPECTED_BITSTREAM_SIZE)
    warnings.push(`Size is ${data.length} bytes; Shrike-Lite bitstreams are normally ${EXPECTED_BITSTREAM_SIZE}. Use the project's FPGA_bitstream_MCU.bin, not other files in the build folder.`);
  return { errors, warnings };
}

export class FpgaTools {
  constructor(private s: DeviceSession, private fs: DeviceFs) {}

  async check(): Promise<CompatReport> {
    return evaluateCompat(await this.s.refreshInfo());
  }

  async upload(name: string, data: Uint8Array, onProgress?: Progress) {
    const { errors } = inspectBitstream(name, data);
    if (errors.length) throw new DeviceError(errors.join(' '));
    return this.fs.writeFile('/' + name, data, onProgress);
  }

  async listBitstreams(opts: { background?: boolean } = {}): Promise<string[]> {
    return (await this.fs.list('/', opts)).filter((e) => !e.isDir && /\.bin$/i.test(e.name)).map((e) => e.name);
  }

  /** Re-verifies compatibility, then runs `import shrike; shrike.flash("<name>")` on the board. */
  async flash(name: string, opts: { reset?: boolean } = {}): Promise<void> {
    if (!/^[\w.\-/]+\.bin$/i.test(name) || name.includes('..')) throw new DeviceError('Invalid bitstream file name.');
    const report = await this.check();
    if (report.level === 'fail') throw new DeviceError(report.messages[0]);
    const n = pyStr(name);
    const exists = await this.s.execOnce('Checking file', `import os\nprint('@@'+str(os.stat(${n})[6])+'@@')`, { allowError: true });
    if (!exists.ok) throw new DeviceError(`${name} is not on the device. Upload it first.`);
    const doReset = opts.reset && report.info?.hasReset ? 'shrike.reset()\n' : '';
    const code = `import shrike\n${doReset}shrike.flash(${n})\n`;
    this.s.notice(`Programming FPGA with ${name}…`, 'info');
    const r = await this.s.execOnce('Programming FPGA', code, { idleTimeoutMs: 45000, stream: true, allowError: true });
    if (!r.ok) throw new DeviceError('shrike.flash() raised an error (see terminal).', r.stderr);
    this.s.notice(`FPGA programmed from ${name}. If your design needs a reset pulse, do it from your script.`, 'ok');
  }
}
