import type { DeviceSession } from '../device/DeviceSession';
import { evaluateCompat, FpgaTools, inspectBitstream } from '../fpga/FpgaTools';
import { errMsg } from '../util/errors';
import { h, pickFiles } from './dom';
import { toast } from './toast';

/** FPGA tools: compatibility check, bitstream upload, and shrike.flash(). */
export class FpgaPanel {
  private file: { name: string; data: Uint8Array } | null = null;
  private onDevice: string[] = [];
  private chosen = '';
  private busy = false;
  private progress = 0;
  private reset = false;

  constructor(private root: HTMLElement, private tools: FpgaTools, private session: DeviceSession) {
    session.on('info', () => { void this.reloadList(); this.render(); });
    session.on('status', (status) => { if (!status.background) this.render(); });
    this.render();
  }

  private async reloadList(): Promise<void> {
    if (!this.session.connected || !this.session.info) { this.onDevice = []; return; }
    try { this.onDevice = await this.tools.listBitstreams(); if (!this.onDevice.includes(this.chosen)) this.chosen = this.onDevice[0] ?? ''; this.render(); }
    catch { /* busy or disconnected: ignore */ }
  }

  private async task(fn: () => Promise<void>): Promise<void> {
    this.busy = true; this.progress = 0; this.render();
    try { await fn(); } catch (e) { toast(errMsg(e), 'error'); this.session.notice(errMsg(e), 'error'); }
    finally { this.busy = false; this.render(); void this.reloadList(); }
  }

  render(): void {
    const info = this.session.info;
    const connected = this.session.connected;
    const report = evaluateCompat(info);
    const canFlash = connected && !this.busy && report.level !== 'fail' && this.session.state === 'idle';
    const canUse = connected && !this.busy && this.session.state === 'idle';
    const insp = this.file ? inspectBitstream(this.file.name, this.file.data) : null;

    const compat = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('b', { text: 'Firmware compatibility' }),
        h('span', { class: `badge ${connected ? report.level : 'idle'}`, text: !connected ? 'not connected' : !info ? 'unchecked' : report.level.toUpperCase() })),
      connected && info ? h('ul', { class: 'msgs' }, ...report.messages.map((m) => h('li', { text: m }))) : h('p', { class: 'hint', title: 'Checks for the custom Shrike MicroPython firmware and shrike module.', text: 'Connect a board to check Shrike MicroPython support.' }),
      h('button', { text: 'Re-check', disabled: !canUse, onclick: () => void this.task(async () => { await this.tools.check(); }) }));

    const upload = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('b', { text: 'Upload bitstream' })),
      h('p', { class: 'hint', title: 'Use a .bin from fpga/build/bitstream or a prebuilt bitstream.', text: 'Choose a .bin bitstream to upload.' }),
      h('button', { text: this.file ? 'Choose another .bin…' : 'Choose .bin file…', disabled: this.busy, onclick: async () => {
        const [f] = await pickFiles('.bin'); if (!f) return;
        this.file = { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }; this.render();
      } }),
      this.file ? h('div', { class: 'fileinfo' }, h('div', { text: `${this.file.name} · ${this.file.data.length} bytes` }),
        ...insp!.errors.map((m) => h('div', { class: 'msg error', text: m })), ...insp!.warnings.map((m) => h('div', { class: 'msg warn', text: m }))) : null,
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.reset, disabled: !info?.hasReset, onchange: (e: Event) => { this.reset = (e.target as HTMLInputElement).checked; } }),
        `call shrike.reset() before flashing${info && !info.hasReset ? ' (not available)' : ''}`),
      h('div', { class: 'row' },
        h('button', { text: 'Upload', disabled: !canUse || !this.file || !!insp?.errors.length, onclick: () => void this.task(async () => {
          const r = await this.tools.upload(this.file!.name, this.file!.data, (d, t) => { this.progress = d / t; this.render(); });
          toast(`Uploaded ${this.file!.name} (${r.crcVerified ? 'CRC' : 'size'} verified)`, 'ok');
        }) }),
        h('button', { class: 'primary', text: 'Upload & flash FPGA', disabled: !canFlash || !this.file || !!insp?.errors.length, onclick: () => void this.task(async () => {
          await this.tools.upload(this.file!.name, this.file!.data, (d, t) => { this.progress = d / t; this.render(); });
          await this.tools.flash(this.file!.name, { reset: this.reset });
          toast('FPGA programmed', 'ok');
        }) })),
      this.busy ? h('div', { class: 'bar' }, h('div', { style: `width:${Math.round(this.progress * 100)}%` })) : null);

    const flash = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('b', { text: 'Flash from device' })),
      h('p', { class: 'hint', title: 'Runs import shrike; shrike.flash("<file>").', text: 'Flash a .bin already on the device.' }),
      h('select', { disabled: !connected || !this.onDevice.length, onchange: (e: Event) => { this.chosen = (e.target as HTMLSelectElement).value; } },
        ...(this.onDevice.length ? this.onDevice.map((n) => h('option', { value: n, text: n, selected: n === this.chosen })) : [h('option', { text: connected ? 'No .bin files in /' : '—' })])),
      h('div', { class: 'row' },
        h('button', { text: 'Refresh list', disabled: !canUse, onclick: () => void this.task(() => this.reloadList()) }),
        h('button', { class: 'primary', text: 'Flash FPGA', disabled: !canFlash || !this.chosen, onclick: () => void this.task(async () => {
          await this.tools.flash(this.chosen, { reset: this.reset }); toast('FPGA programmed', 'ok');
        }) })));

    this.root.replaceChildren(compat, upload, flash);
  }
}
