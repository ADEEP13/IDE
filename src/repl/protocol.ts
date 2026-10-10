import { bytes } from '../util/bytes';

/** MicroPython REPL control characters (docs.micropython.org/en/latest/reference/repl.html). */
export const CTRL_A = 0x01; // enter raw REPL
export const CTRL_B = 0x02; // leave raw REPL
export const CTRL_C = 0x03; // interrupt
export const CTRL_D = 0x04; // end of input / soft reset
export const CTRL_E = 0x05; // raw-paste prefix

export const EOT = Uint8Array.of(CTRL_D);
export const RAW_PROMPT = bytes('raw REPL; CTRL-B to exit\r\n>');
export const RAW_PROMPT_TAIL = bytes('w REPL; CTRL-B to exit\r\n>');
export const FRIENDLY_PROMPT = bytes('>>> ');
export const SOFT_REBOOT = bytes('soft reboot\r\n');
