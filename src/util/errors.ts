export class TimeoutError extends Error {
  constructor(m = 'Timed out waiting for the device') { super(m); this.name = 'TimeoutError'; }
}
export class DisconnectedError extends Error {
  constructor(m = 'Device disconnected') { super(m); this.name = 'DisconnectedError'; }
}
export class CancelledError extends Error {
  constructor(m = 'Cancelled') { super(m); this.name = 'CancelledError'; }
}
export class BusyError extends Error {
  constructor(m = 'Device is busy') { super(m); this.name = 'BusyError'; }
}
/** Protocol-level problem (could not enter raw REPL, unexpected bytes...). */
export class ReplError extends Error {
  constructor(m: string) { super(m); this.name = 'ReplError'; }
}
/** Python-level error reported by the device (stderr of an executed snippet). */
export class DeviceError extends Error {
  constructor(m: string, readonly traceback = '') { super(m); this.name = 'DeviceError'; }
}
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
