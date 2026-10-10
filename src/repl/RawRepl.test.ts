import { describe, expect, it } from 'vitest';
import { RxBuffer } from '../serial/RxBuffer';
import { bytes } from '../util/bytes';
import { DisconnectedError, ReplError, TimeoutError } from '../util/errors';
import { RawRepl } from './RawRepl';

/** Minimal simulation of MicroPython's raw REPL (with or without raw-paste). */
class FakeDevice {
  mode: 'friendly' | 'raw' | 'paste' = 'friendly';
  buf: number[] = [];
  skip = 0;
  consumed = 0;
  lastCode = '';
  constructor(
    private rx: RxBuffer,
    private o: { rawPaste: boolean; silent?: boolean; run?: (c: string) => { out: string; err: string } },
  ) {}
  private reply(b: Uint8Array | number[] | string) { this.rx.push(typeof b === 'string' ? bytes(b) : Uint8Array.from(b)); }
  private result(): void {
    const { out, err } = (this.o.run ?? (() => ({ out: '', err: '' })))(this.lastCode);
    this.reply(out); this.reply([4]); this.reply(err); this.reply([4]); this.reply('>');
  }
  send = async (d: Uint8Array): Promise<void> => { if (!this.o.silent) for (const b of d) this.byte(b); };
  private byte(b: number) {
    if (this.skip > 0) { this.skip--; return; }
    if (this.mode === 'friendly') { if (b === 1) { this.mode = 'raw'; this.reply('raw REPL; CTRL-B to exit\r\n>'); } return; }
    if (this.mode === 'paste') {
      if (b === 4) { this.lastCode = String.fromCharCode(...this.buf); this.reply([4]); this.mode = 'raw'; this.result(); return; }
      this.buf.push(b);
      if (++this.consumed % 128 === 0) this.reply([1]);
      return;
    }
    if (b === 1) { this.buf = []; this.reply('raw REPL; CTRL-B to exit\r\n>'); }
    else if (b === 2) { this.mode = 'friendly'; this.reply('\r\nMicroPython (fake)\r\n>>> '); }
    else if (b === 3) this.buf = [];
    else if (b === 5 && this.o.rawPaste) { this.skip = 2; this.mode = 'paste'; this.buf = []; this.consumed = 0; this.reply([0x52, 1, 128, 0]); }
    else if (b === 4) { this.lastCode = String.fromCharCode(...this.buf); this.buf = []; this.reply('OK'); this.result(); }
    else this.buf.push(b);
  }
}

const setup = (o: ConstructorParameters<typeof FakeDevice>[1]) => {
  const rx = new RxBuffer();
  rx.setProtocol(true);
  const dev = new FakeDevice(rx, o);
  const repl = new RawRepl(dev.send, rx, { enterTimeoutMs: 100, settleMs: 5, attempts: 2 });
  return { rx, dev, repl };
};

describe('RawRepl', () => {
  it('executes via raw-paste with flow control (code larger than the window)', async () => {
    const code = `print("${'x'.repeat(500)}")`;
    const { dev, repl } = setup({ rawPaste: true, run: () => ({ out: 'hello\r\n', err: '' }) });
    const r = await repl.exec(code);
    expect(r).toEqual({ stdout: 'hello\r\n', stderr: '', ok: true });
    expect(dev.lastCode).toBe(code);
  });

  it('falls back to classic raw mode on old firmware', async () => {
    const { dev, repl } = setup({ rawPaste: false, run: () => ({ out: '42\r\n', err: '' }) });
    const r = await repl.exec('print(42)');
    expect(r.stdout).toBe('42\r\n');
    expect(dev.lastCode).toBe('print(42)');
  });

  it('reports Python errors on stderr', async () => {
    const { repl } = setup({ rawPaste: true, run: () => ({ out: '', err: 'Traceback...\r\nNameError: x\r\n' }) });
    const r = await repl.exec('x');
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('NameError');
  });

  it('streams stdout through onStdout', async () => {
    const { repl } = setup({ rawPaste: true, run: () => ({ out: 'a\r\nb\r\n', err: '' }) });
    let seen = '';
    await repl.exec('x', { onStdout: (c) => (seen += new TextDecoder().decode(c)) });
    expect(seen).toBe('a\r\nb\r\n');
  });

  it('fails with ReplError when the device is silent', async () => {
    const { repl } = setup({ rawPaste: true, silent: true });
    await expect(repl.enter()).rejects.toBeInstanceOf(ReplError);
  });

  it('times out on idle and rejects pending reads on disconnect', async () => {
    const { rx } = setup({ rawPaste: true });
    await expect(rx.readExact(1, { idleTimeoutMs: 20 })).rejects.toBeInstanceOf(TimeoutError);
    const p = rx.readExact(1);
    rx.failWaiter(new DisconnectedError());
    await expect(p).rejects.toBeInstanceOf(DisconnectedError);
  });
});

describe('RxBuffer', () => {
  it('finds markers split across chunks and streams the rest', async () => {
    const rx = new RxBuffer();
    rx.setProtocol(true);
    let streamed = '';
    const p = rx.readUntil(bytes('END'), { onData: (c) => (streamed += new TextDecoder().decode(c)) });
    rx.push(bytes('abcE')); rx.push(bytes('N')); rx.push(bytes('Dtail'));
    await p;
    expect(streamed).toBe('abc');
    expect(new TextDecoder().decode(rx.drain())).toBe('tail');
  });
});
