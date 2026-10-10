import type { RxBuffer } from '../serial/RxBuffer';
import { bytes, sleep, text } from '../util/bytes';
import { DisconnectedError, ReplError } from '../util/errors';
import { CTRL_A, CTRL_B, CTRL_D, CTRL_E, EOT, FRIENDLY_PROMPT, RAW_PROMPT, RAW_PROMPT_TAIL, SOFT_REBOOT } from './protocol';

export interface ExecOptions {
  onStdout?: (chunk: Uint8Array) => void;
  onStderr?: (chunk: Uint8Array) => void;
  /** Abort if the device is silent this long (omit for long-running programs). */
  idleTimeoutMs?: number;
}
export interface ExecResult {
  /** Collected stdout (empty when onStdout streaming is used). */
  stdout: string;
  stderr: string;
  ok: boolean;
}
export interface ReplTiming { enterTimeoutMs: number; settleMs: number; attempts: number }

/**
 * MicroPython raw REPL client (raw-paste with flow control when supported,
 * classic raw mode otherwise). Mirrors the behaviour of mpremote's transport.
 */
export class RawRepl {
  inRaw = false;
  private paste: 'unknown' | 'yes' | 'no' = 'unknown';
  private timing: ReplTiming;

  constructor(
    private send: (d: Uint8Array) => Promise<void>,
    private rx: RxBuffer,
    timing: Partial<ReplTiming> = {},
  ) {
    this.timing = { enterTimeoutMs: 3000, settleMs: 80, attempts: 3, ...timing };
  }

  forget(): void { this.inRaw = false; }

  /** Interrupt whatever is running and switch to raw REPL (optionally soft-resetting first). */
  async enter(softReset = false): Promise<void> {
    if (this.inRaw && !softReset) return;
    const { enterTimeoutMs, settleMs, attempts } = this.timing;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.send(bytes('\r\x03\x03'));
        await sleep(i ? settleMs * 4 : settleMs);
        this.rx.drain();
        await this.send(bytes('\r\x01'));
        await this.rx.readUntil(RAW_PROMPT, { totalTimeoutMs: enterTimeoutMs });
        if (softReset) {
          await this.send(Uint8Array.of(CTRL_D));
          await this.rx.readUntil(SOFT_REBOOT, { totalTimeoutMs: enterTimeoutMs * 2 });
          await this.rx.readUntil(RAW_PROMPT, { totalTimeoutMs: enterTimeoutMs * 3 }); // boot.py may print first
        }
        this.inRaw = true;
        return;
      } catch (e) {
        if (e instanceof DisconnectedError) throw e;
      }
    }
    throw new ReplError('Could not enter the raw REPL. Is a MicroPython firmware running? Try Disconnect, then Connect, or press the board RESET button.');
  }

  /** Leave raw REPL back to the friendly ">>>" REPL. */
  async exit(): Promise<void> {
    if (!this.inRaw) return;
    await this.send(Uint8Array.of(CTRL_B));
    try {
      await this.rx.readUntil(FRIENDLY_PROMPT, { totalTimeoutMs: 1500 });
    } finally { this.inRaw = false; }
  }

  async exec(code: string, opts: ExecOptions = {}): Promise<ExecResult> {
    try {
      await this.enter();
      const idle = opts.idleTimeoutMs;
      await this.writeCommand(bytes(code), idle);
      const out: Uint8Array[] = [];
      const err: Uint8Array[] = [];
      await this.rx.readUntil(EOT, { idleTimeoutMs: idle, onData: (c) => (opts.onStdout ? opts.onStdout(c) : out.push(c)) });
      await this.rx.readUntil(EOT, { idleTimeoutMs: idle ?? 5000, onData: (c) => { err.push(c); opts.onStderr?.(c); } });
      const gt = await this.rx.readExact(1, { idleTimeoutMs: 3000 });
      if (gt[0] !== 0x3e) this.inRaw = false; // lost sync: re-enter next time
      const stderr = text(join(err));
      return { stdout: text(join(out)), stderr, ok: stderr.length === 0 };
    } catch (e) {
      this.inRaw = false;
      throw e;
    }
  }

  private async writeCommand(code: Uint8Array, idle?: number): Promise<void> {
    const t = idle ?? 5000;
    if (this.paste !== 'no') {
      await this.send(Uint8Array.of(CTRL_E, 0x41, 0x01));
      const head = await this.rx.readExact(2, { idleTimeoutMs: t });
      if (head[0] === 0x52 && head[1] === 0x01) {
        this.paste = 'yes';
        return this.rawPasteWrite(code, t);
      }
      this.paste = 'no';
      if (head[0] === 0x52 && head[1] === 0x00) { /* understood but unsupported */ }
      else await this.rx.readUntil(RAW_PROMPT_TAIL, { idleTimeoutMs: t }); // old firmware re-printed the banner
    }
    for (let i = 0; i < code.length; i += 256) {
      await this.send(code.subarray(i, i + 256));
      await sleep(10);
    }
    await this.send(EOT);
    const ok = await this.rx.readExact(2, { idleTimeoutMs: t });
    if (ok[0] !== 0x4f || ok[1] !== 0x4b) throw new ReplError('Device did not accept the command');
  }

  private async rawPasteWrite(code: Uint8Array, t: number): Promise<void> {
    const w = await this.rx.readExact(2, { idleTimeoutMs: t });
    const window = w[0] | (w[1] << 8);
    let remain = window;
    let i = 0;
    while (i < code.length) {
      while (remain === 0 || this.rx.available > 0) {
        const b = (await this.rx.readExact(1, { idleTimeoutMs: t }))[0];
        if (b === CTRL_A) remain += window;
        else if (b === CTRL_D) { await this.send(EOT); return; } // device aborted; result follows
        else throw new ReplError(`Unexpected byte 0x${b.toString(16)} during raw-paste`);
      }
      const n = Math.min(remain, code.length - i);
      await this.send(code.subarray(i, i + n));
      i += n; remain -= n;
    }
    await this.send(EOT);
    await this.rx.readUntil(EOT, { idleTimeoutMs: t }); // device acknowledges end of data
  }
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

