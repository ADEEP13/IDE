import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { DeviceSession } from '../device/DeviceSession';

const COLORS = { info: '36', ok: '32', warn: '33', error: '31' } as const;

/** xterm.js terminal wired to the device session (output, notices, keyboard). */
export class TerminalPanel {
  private term = new Terminal({
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'SF Mono', Consolas, Menlo, monospace",
    fontSize: 13, cursorBlink: true, scrollback: 5000,
    theme: { background: '#181818', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78' },
  });
  private fit = new FitAddon();

  constructor(host: HTMLElement, session: DeviceSession) {
    this.term.loadAddon(this.fit);
    this.term.open(host);
    this.term.attachCustomKeyEventHandler((e) => {
      // Ctrl/Cmd+C copies when text is selected; otherwise it is an interrupt (^C) sent to the board.
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && this.term.hasSelection()) {
        void navigator.clipboard.writeText(this.term.getSelection());
        return false;
      }
      return true;
    });
    this.term.onData((d) => session.userInput(d));
    session.on('output', (b) => this.term.write(b));
    session.on('notice', (n) => this.term.write(`\r\n\x1b[${COLORS[n.level]}m${n.text}\x1b[0m\r\n`));
    new ResizeObserver(() => this.refit()).observe(host);
    this.term.writeln('\x1b[1mShrike Web IDE\x1b[0m — press Connect to attach a Shrike-Lite over USB.');
  }

  refit(): void { try { this.fit.fit(); } catch { /* hidden */ } }
  clear(): void { this.term.clear(); }
  focus(): void { this.term.focus(); }
}
