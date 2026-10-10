import { indexOfSeq } from '../util/bytes';
import { TimeoutError } from '../util/errors';

export interface ReadOptions {
  /** Reject if no byte arrives for this long. */
  idleTimeoutMs?: number;
  /** Reject if the read is not complete after this long. */
  totalTimeoutMs?: number;
  /** readUntil only: stream data incrementally instead of returning it. */
  onData?: (chunk: Uint8Array) => void;
}

interface Waiter {
  marker?: Uint8Array;
  count?: number;
  opts: ReadOptions;
  resolve(d: Uint8Array): void;
  reject(e: Error): void;
  idle?: ReturnType<typeof setTimeout>;
  total?: ReturnType<typeof setTimeout>;
}

/**
 * Receive buffer with two modes:
 *  - passthrough: bytes go straight to `passthrough` (interactive terminal)
 *  - protocol: bytes are buffered for readUntil/readExact (raw REPL traffic)
 */
export class RxBuffer {
  passthrough: ((d: Uint8Array) => void) | null = null;
  private data = new Uint8Array(8192);
  private len = 0;
  private scanned = 0;
  private protocol = false;
  private waiter: Waiter | null = null;

  get available(): number { return this.len; }
  setProtocol(on: boolean): void { this.protocol = on; }

  drain(): Uint8Array {
    const out = this.data.slice(0, this.len);
    this.len = 0; this.scanned = 0;
    return out;
  }

  push(chunk: Uint8Array): void {
    if (!this.protocol && !this.waiter) { this.passthrough?.(chunk); return; }
    if (this.len + chunk.length > this.data.length) {
      const bigger = new Uint8Array(Math.max(this.data.length * 2, this.len + chunk.length));
      bigger.set(this.data.subarray(0, this.len));
      this.data = bigger;
    }
    this.data.set(chunk, this.len);
    this.len += chunk.length;
    if (this.waiter) { this.armIdle(this.waiter); this.pump(); }
  }

  readUntil(marker: Uint8Array, opts: ReadOptions = {}): Promise<Uint8Array> {
    return this.wait({ marker, opts });
  }
  readExact(count: number, opts: ReadOptions = {}): Promise<Uint8Array> {
    return this.wait({ count, opts });
  }

  /** Reject the pending read (disconnect, unresponsive device...). */
  failWaiter(err: Error): void { if (this.waiter) this.settle(this.waiter, err); }

  private wait(spec: { marker?: Uint8Array; count?: number; opts: ReadOptions }): Promise<Uint8Array> {
    if (this.waiter) return Promise.reject(new Error('RxBuffer: concurrent read'));
    return new Promise<Uint8Array>((resolve, reject) => {
      const w: Waiter = { ...spec, resolve, reject };
      this.waiter = w;
      if (spec.opts.totalTimeoutMs) {
        w.total = setTimeout(() => this.settle(w, new TimeoutError()), spec.opts.totalTimeoutMs);
      }
      this.armIdle(w);
      this.pump();
    });
  }

  private armIdle(w: Waiter): void {
    if (!w.opts.idleTimeoutMs) return;
    clearTimeout(w.idle);
    w.idle = setTimeout(() => this.settle(w, new TimeoutError()), w.opts.idleTimeoutMs);
  }

  private settle(w: Waiter, r: Uint8Array | Error): void {
    clearTimeout(w.idle); clearTimeout(w.total);
    if (this.waiter === w) this.waiter = null;
    if (r instanceof Error) w.reject(r); else w.resolve(r);
  }

  private consume(n: number): Uint8Array {
    const out = this.data.slice(0, n);
    this.data.copyWithin(0, n, this.len);
    this.len -= n;
    this.scanned = Math.max(0, this.scanned - n);
    return out;
  }

  private pump(): void {
    const w = this.waiter;
    if (!w) return;
    if (w.count !== undefined) {
      if (this.len >= w.count) this.settle(w, this.consume(w.count));
      return;
    }
    const m = w.marker!;
    const idx = indexOfSeq(this.data.subarray(0, this.len), m, this.scanned);
    if (idx >= 0) {
      const before = this.consume(idx);
      this.consume(m.length);
      if (w.opts.onData) {
        if (before.length) w.opts.onData(before);
        this.settle(w, new Uint8Array(0));
      } else this.settle(w, before);
      return;
    }
    this.scanned = Math.max(0, this.len - (m.length - 1));
    if (w.opts.onData && this.scanned > 0) w.opts.onData(this.consume(this.scanned));
  }
}
