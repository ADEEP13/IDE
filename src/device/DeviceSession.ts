import { RawRepl, type ExecOptions, type ExecResult } from '../repl/RawRepl';
import { RxBuffer } from '../serial/RxBuffer';
import { SerialTransport } from '../serial/SerialTransport';
import { bytes, NewlineFixer, sleep } from '../util/bytes';
import { Emitter } from '../util/emitter';
import { BusyError, DisconnectedError, TimeoutError, errMsg } from '../util/errors';
import { PROBE_CODE, assertOk, parseDeviceInfo } from './pyutil';
import type { DeviceInfo } from './types';

export type SessionState = 'disconnected' | 'connecting' | 'idle' | 'running' | 'busy';
export interface Status { state: SessionState; stopping: boolean; label: string; background?: boolean }
export interface Notice { text: string; level: 'info' | 'ok' | 'warn' | 'error' }
export type RunOutcome = 'ok' | 'error' | 'stopped' | 'timeout';

export type SessionEvents = {
  status: Status;
  output: Uint8Array;
  notice: Notice;
  info: DeviceInfo | null;
  closed: { reason: 'user' | 'lost'; message: string };
};

const RED = (b: Uint8Array) => { const o = new Uint8Array(b.length + 9); o.set(bytes('\x1b[31m')); o.set(b, 5); o.set(bytes('\x1b[0m'), 5 + b.length); return o; };

/**
 * Owns the connection and the device state machine.
 *  idle    – friendly REPL is interactive (terminal input forwarded)
 *  running – a user script runs in raw REPL; its output streams to the terminal
 *  busy    – internal protocol operation (file/FPGA); terminal input is ignored
 * All raw-REPL operations are serialized through withRaw().
 */
export class DeviceSession extends Emitter<SessionEvents> {
  info: DeviceInfo | null = null;
  readonly rx = new RxBuffer();
  private _state: SessionState = 'disconnected';
  private label = '';
  private stopping = false;
  private stopRequested = false;
  private atPrompt = false;
  private transport: SerialTransport | null = null;
  private currentPort: SerialPort | null = null;
  private raw: RawRepl | null = null;
  private queue: Promise<void> = Promise.resolve();
  private stopTimers: ReturnType<typeof setTimeout>[] = [];

  get state(): SessionState { return this._state; }
  get connected(): boolean { return this._state !== 'disconnected' && this._state !== 'connecting'; }
  get port(): SerialPort | null { return this.currentPort; }

  // ---- connection -------------------------------------------------------

  async connect(showAllPorts = false): Promise<void> {
    if (this._state !== 'disconnected') return;
    if (!SerialTransport.supported)
      throw new Error('Web Serial is not available. Use Chrome or Edge on a desktop, served over HTTPS or http://localhost.');
    this.setState('connecting', 'Connecting…');
    try {
      const port = (!showAllPorts && (await SerialTransport.authorizedPort())) || (await SerialTransport.requestPort(showAllPorts));
      await this.connectPort(port);
    } catch (e) {
      if (this._state !== 'disconnected') this.cleanup();
      throw e;
    }
  }

  async connectPort(port: SerialPort): Promise<void> {
    if (this._state !== 'disconnected' && this._state !== 'connecting') return;
    if (!SerialTransport.supported)
      throw new Error('Web Serial is not available. Use Chrome or Edge on a desktop, served over HTTPS or http://localhost.');
    if (this._state === 'disconnected') this.setState('connecting', 'Connecting…');
    try {
      const t = new SerialTransport();
      t.on('data', (d) => this.rx.push(d));
      t.on('close', (e) => this.onClosed(e.reason, e.error));
      await t.open(port);
      this.transport = t;
      this.currentPort = port;
      this.rx.passthrough = (d) => this.out(d);
      this.raw = new RawRepl((d) => t.write(d), this.rx);
      this.setState('idle');
      this.notice('Connected. Interrupting any running program…', 'info');
      this.rx.setProtocol(true);
      await t.write(bytes('\x03\x03'));
      await sleep(150);
      this.rx.drain();
      this.rx.setProtocol(false);
      await t.write(bytes('\r'));
      try { await this.refreshInfo(); }
      catch (e) { if (!(e instanceof DisconnectedError)) this.notice(`Connected, but the raw-REPL probe failed: ${errMsg(e)}`, 'warn'); }
    } catch (e) {
      const t = this.transport;
      this.transport = null;
      this.currentPort = null;
      await t?.close().catch(() => undefined);
      this.cleanup();
      throw e;
    }
  }

  async disconnect(): Promise<void> { await this.transport?.close(); }

  private onClosed(reason: 'user' | 'lost', err?: Error): void {
    this.rx.failWaiter(new DisconnectedError());
    this.cleanup();
    const message = reason === 'user' ? 'Disconnected.' : `Device disconnected (${err?.message ?? 'USB connection lost'}). Plug it back in and press Connect.`;
    this.notice(message, reason === 'user' ? 'info' : 'error');
    this.emit('closed', { reason, message });
  }

  private cleanup(): void {
    this.stopTimers.forEach(clearTimeout); this.stopTimers = [];
    this.stopping = false; this.transport = null; this.currentPort = null; this.raw = null; this.info = null;
    this.rx.setProtocol(false); this.rx.drain(); this.rx.passthrough = null;
    this.emit('info', null);
    this.setState('disconnected');
  }

  // ---- terminal I/O -----------------------------------------------------

  /** Keystrokes from the terminal. */
  userInput(data: string): void {
    const t = this.transport;
    if (!t) return;
    if (this._state === 'running') {
      if (data === '\x03') { void this.stop(); return; }
      void t.write(bytes(data)).catch(() => undefined);
    } else if (this._state === 'idle') void t.write(bytes(data)).catch(() => undefined);
  }

  /** Soft reset (Ctrl-D at the friendly REPL): re-runs boot.py/main.py like a power-up. */
  softReset(): void {
    if (this._state === 'idle') void this.transport?.write(Uint8Array.of(0x04)).catch(() => undefined);
  }

  writeOutput(b: Uint8Array): void { this.out(b); }

  /** Handlers that stream a snippet's output into the terminal. */
  streamHandlers(): Pick<ExecOptions, 'onStdout' | 'onStderr'> {
    const nl = new NewlineFixer();
    return { onStdout: (b) => this.out(nl.fix(b)), onStderr: (b) => this.out(RED(nl.fix(b))) };
  }

  notice(text: string, level: Notice['level'] = 'info'): void {
    this.atPrompt = false;
    this.emit('notice', { text, level });
  }

  private out(d: Uint8Array): void {
    const n = d.length;
    this.atPrompt = n >= 4 && d[n - 4] === 0x3e && d[n - 3] === 0x3e && d[n - 2] === 0x3e && d[n - 1] === 0x20;
    this.emit('output', d);
  }

  // ---- protocol operations ----------------------------------------------

  /** Run `fn` with exclusive raw-REPL access; restores the friendly REPL afterwards. */
  async withRaw<T>(label: string, fn: (raw: RawRepl) => Promise<T>, opts: { background?: boolean } = {}): Promise<T> {
    const background = opts.background === true;
    const prev = this.queue;
    let done!: () => void;
    this.queue = new Promise<void>((r) => (done = r));
    await prev;
    try {
      if (this._state !== 'idle' || !this.raw) throw new BusyError(this._state === 'disconnected' ? 'Not connected' : 'The device is busy (a program is running or another operation is in progress)');
      const raw = this.raw;
      this.setState('busy', label, background);
      this.rx.setProtocol(true);
      try { return await fn(raw); }
      finally { await this.leaveRaw(raw, background); }
    } finally { done(); }
  }

  private async leaveRaw(raw: RawRepl, background = false): Promise<void> {
    if (this.transport) {
      try {
        await raw.exit();
        this.rx.drain();
        if (!this.atPrompt) this.out(bytes('\r\n>>> '));
      } catch { raw.forget(); }
    }
    this.rx.setProtocol(false);
    this.stopTimers.forEach(clearTimeout); this.stopTimers = [];
    this.stopping = false;
    if (this._state === 'busy' || this._state === 'running') this.setState('idle', '', background);
  }

  /** Execute one snippet and return its result (Python errors are thrown as DeviceError). */
  async execOnce(label: string, code: string, o: ExecOptions & { stream?: boolean; allowError?: boolean } = {}): Promise<ExecResult> {
    return this.withRaw(label, async (raw) => {
      const h = o.stream ? this.streamHandlers() : {};
      const r = await raw.exec(code, { idleTimeoutMs: o.idleTimeoutMs ?? 10000, ...h });
      return o.allowError ? r : assertOk(r);
    });
  }

  async refreshInfo(): Promise<DeviceInfo> {
    const r = await this.execOnce('Reading device info', PROBE_CODE, { idleTimeoutMs: 8000 });
    this.info = parseDeviceInfo(r.stdout);
    this.emit('info', this.info);
    const i = this.info;
    this.notice(`Device: MicroPython ${i.version} · ${i.machine || i.platform}${i.hasShrike ? ' · shrike module found' : ''}`, 'ok');
    return i;
  }

  /** Run a script on the device, streaming output. Resolves with how it ended. */
  async run(code: string, opts: { timeoutMs?: number; softReset?: boolean } = {}): Promise<RunOutcome> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.stopRequested = false;
    const t0 = performance.now();
    return this.withRaw('Running', async (raw) => {
      this.setState('running', 'Running');
      await raw.enter(!!opts.softReset);
      this.notice('Running…', 'info');
      if (opts.timeoutMs) timer = setTimeout(() => { timedOut = true; void this.stop(); }, opts.timeoutMs);
      try {
        const r = await raw.exec(code, this.streamHandlers());
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        if (timedOut) { this.notice(`Stopped after the ${(opts.timeoutMs! / 1000)} s timeout.`, 'warn'); return 'timeout' as const; }
        if (this.stopRequested) { this.notice('Stopped.', 'warn'); return 'stopped' as const; }
        if (!r.ok) { this.notice(`Finished with an error (${secs} s).`, 'error'); return 'error' as const; }
        this.notice(`Finished in ${secs} s.`, 'ok');
        return 'ok' as const;
      } catch (e) {
        if (e instanceof TimeoutError) this.notice('The device stopped responding. Try Disconnect, then Connect, or press the board RESET button.', 'error');
        throw e;
      } finally { clearTimeout(timer); }
    });
  }

  /** Interrupt the running program (Ctrl-C), escalating if the board does not react. */
  async stop(): Promise<void> {
    const t = this.transport;
    if (this._state !== 'running' || this.stopping || !t) return;
    this.stopping = true; this.stopRequested = true;
    this.setState('running', 'Stopping');
    try { await t.write(Uint8Array.of(0x03)); } catch { return; }
    this.stopTimers.push(setTimeout(() => { void t.write(bytes('\x03\x03')).catch(() => undefined); }, 1200));
    this.stopTimers.push(setTimeout(() => {
      if (this.stopping) this.rx.failWaiter(new TimeoutError('The device did not respond to the interrupt'));
    }, 4000));
  }

  private setState(state: SessionState, label = '', background = false): void {
    this._state = state; this.label = label;
    this.emit('status', { state, stopping: this.stopping, label: this.label, background });
  }
}
