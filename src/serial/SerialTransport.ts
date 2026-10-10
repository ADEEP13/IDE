import { Emitter } from '../util/emitter';
import { CancelledError, DisconnectedError } from '../util/errors';

/** USB vendor ID used by RP2040 MicroPython (Raspberry Pi). Shrike-Lite enumerates as 2E8A:0005. */
export const RP_VENDOR_ID = 0x2e8a;

export type TransportEvents = {
  data: Uint8Array;
  close: { reason: 'user' | 'lost'; error?: Error };
};

function openError(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NetworkError')
    return new Error('Could not open the serial port. Close other programs using it (Thonny, mpremote, Arduino Serial Monitor, another tab) and try again.');
  if (name === 'InvalidStateError') return new Error('The serial port is already open (another tab?).');
  return e instanceof Error ? e : new Error(String(e));
}

/** Thin wrapper around a Web Serial port: serialized writes, read loop, disconnect detection. */
export class SerialTransport extends Emitter<TransportEvents> {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private loop: Promise<void> = Promise.resolve();
  private writeChain: Promise<void> = Promise.resolve();
  private closing = false;

  private onDisconnect = (ev: Event) => {
    if (ev.target === this.port) void this.shutdown('lost', new Error('USB device was disconnected'));
  };

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  static async requestPort(showAll = false): Promise<SerialPort> {
    try {
      return await navigator.serial.requestPort(showAll ? {} : { filters: [{ usbVendorId: RP_VENDOR_ID }] });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') throw new CancelledError();
      throw e;
    }
  }

  /** Previously authorised Shrike-compatible ports. */
  static async authorizedPorts(): Promise<SerialPort[]> {
    return (await navigator.serial.getPorts()).filter((p) => p.getInfo().usbVendorId === RP_VENDOR_ID);
  }

  /** A previously authorised board, if exactly one is plugged in (skips the chooser). */
  static async authorizedPort(): Promise<SerialPort | null> {
    const ports = await this.authorizedPorts();
    return ports.length === 1 ? ports[0] : null;
  }

  static portLabel(port: SerialPort, index: number): string {
    const info = port.getInfo();
    const product = info.usbProductId === undefined ? 'Shrike device' : `Shrike USB ${info.usbProductId.toString(16).toUpperCase().padStart(4, '0')}`;
    return `${product} · device ${index + 1}`;
  }

  async open(port: SerialPort, baudRate = 115200): Promise<void> {
    try {
      await port.open({ baudRate, bufferSize: 1 << 16 });
    } catch (e) { throw openError(e); }
    this.port = port;
    this.closing = false;
    // MicroPython's USB CDC only talks when DTR is asserted.
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch { /* optional */ }
    this.writer = port.writable!.getWriter();
    navigator.serial.addEventListener('disconnect', this.onDisconnect);
    this.loop = this.readLoop(port);
  }

  write(data: Uint8Array): Promise<void> {
    const w = this.writer;
    if (!w || this.closing) return Promise.reject(new DisconnectedError());
    const p = this.writeChain.then(() => w.write(data));
    this.writeChain = p.catch(() => undefined);
    return p.catch((e) => {
      void this.shutdown('lost', e instanceof Error ? e : new Error(String(e)));
      throw new DisconnectedError('Write failed: device disconnected');
    });
  }

  close(): Promise<void> { return this.shutdown('user'); }

  private async readLoop(port: SerialPort): Promise<void> {
    let fatal: Error | undefined;
    try {
      while (port.readable && !this.closing) {
        this.reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value && value.length) this.emit('data', value);
          }
        } catch (e) {
          if (this.closing) break;
          if (e instanceof DOMException && e.name === 'NetworkError') { fatal = e; break; }
          console.warn('Non-fatal serial read error', e); // framing/overrun: keep reading
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } finally {
      if (!this.closing) void this.shutdown('lost', fatal ?? new Error('Serial connection lost'));
    }
  }

  private async shutdown(reason: 'user' | 'lost', error?: Error): Promise<void> {
    if (this.closing || !this.port) return;
    this.closing = true;
    const port = this.port;
    navigator.serial.removeEventListener('disconnect', this.onDisconnect);
    try { await this.reader?.cancel(); } catch { /* ignore */ }
    await this.loop.catch(() => undefined);
    try { this.writer?.releaseLock(); } catch { /* pending write */ }
    this.writer = null;
    try { await port.close(); } catch { /* already gone */ }
    this.port = null;
    this.emit('close', { reason, error });
  }
}
