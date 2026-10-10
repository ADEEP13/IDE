import { DeviceFs, joinPath, type DevEntry } from '../device/DeviceFs';
import type { DeviceSession } from '../device/DeviceSession';
import type { EditorManager } from '../editor/EditorManager';
import type { ProjectFile, ProjectStore } from '../storage/ProjectStore';
import { bytes } from '../util/bytes';
import { BusyError, errMsg } from '../util/errors';
import { confirmBox, promptText } from './dialogs';
import { download, h, pickFiles } from './dom';
import { toast } from './toast';

const TEXT_EXT = /\.(py|txt|json|md|cfg|ini|csv|v|sv|pcf|toml|yaml|yml|log)$/i;

/** Device filesystem explorer shown in the FPGA activity view. */
export class DeviceExplorer {
  private devDir = '/';
  private dev: DevEntry[] | null = null;
  private devBusy = false;
  private backgroundRefreshInProgress = false;
  private devError = '';
  private devSignature = '';

  constructor(private root: HTMLElement, private store: ProjectStore, private session: DeviceSession, private fs: DeviceFs, private editor: EditorManager) {
    session.on('info', (i) => { if (i) void this.refresh(); else { this.dev = null; this.devError = ''; this.render(); } });
    session.on('status', (status) => { if (!status.background) this.render(); });
    editor.on('tabs', () => this.render());
    setInterval(() => {
      if (this.canBackgroundRefresh()) void this.refresh(true);
    }, 20000);
    document.addEventListener('visibilitychange', () => {
      if (this.canBackgroundRefresh()) void this.refresh(true);
    });
    window.addEventListener('focus', () => {
      if (this.canBackgroundRefresh()) void this.refresh(true);
    });
  }

  private canBackgroundRefresh(): boolean {
    const pane = document.getElementById('pane-device');
    return !!pane && !pane.hidden && document.visibilityState === 'visible' &&
      this.session.connected && this.session.state === 'idle' &&
      !this.devBusy && !this.backgroundRefreshInProgress;
  }

  private guard(fn: () => Promise<void>): () => void {
    return () => { fn().catch((e) => toast(e instanceof BusyError ? e.message : errMsg(e), 'error')); };
  }

  async refresh(silent = false): Promise<void> {
    if (!this.session.connected) {
      if (this.dev !== null || this.devError) { this.dev = null; this.devError = ''; this.render(); }
      return;
    }
    if (this.devBusy || (silent && this.backgroundRefreshInProgress)) return;
    if (silent) this.backgroundRefreshInProgress = true;
    else this.devBusy = true;
    if (!silent) this.render();
    let changed = false;
    const previousError = this.devError;
    try {
      const next = (await this.fs.list(this.devDir, { background: silent })).filter((e) => e.name !== 'System Volume Information');
      const signature = next.map((e) => `${e.name}:${e.size}:${e.isDir}`).join('|');
      changed = signature !== this.devSignature || previousError !== '';
      this.devSignature = signature;
      this.dev = next;
      this.devError = '';
    } catch (e) {
      this.devError = errMsg(e);
      changed = this.devError !== previousError;
      if (!silent) toast(`Could not list device files: ${this.devError}`, 'error');
    } finally {
      if (silent) this.backgroundRefreshInProgress = false;
      else this.devBusy = false;
      if (!silent || changed) this.render();
    }
  }

  private async openDevice(e: DevEntry): Promise<void> {
    const data = await this.fs.readFile(e.path);
    if (TEXT_EXT.test(e.name)) {
      try {
        const content = new TextDecoder('utf-8', { fatal: true }).decode(data);
        this.editor.open({ kind: 'device', path: e.path, content });
        return;
      } catch { /* binary: fall through to download */ }
    }
    download(e.name, data);
    toast(`${e.name} is not a text file; downloaded instead.`, 'info');
  }

  private async uploadToDevice(files: { name: string; data: Uint8Array }[]): Promise<void> {
    for (const f of files) {
      const r = await this.fs.writeFile(joinPath(this.devDir, f.name), f.data);
      toast(`Uploaded ${f.name} (${r.size} bytes${r.crcVerified ? ', CRC verified' : ', size verified'})`, 'ok');
    }
    await this.refresh();
  }

  private deviceProjectPath(path: string): string {
    const relative = path.split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
    return joinPath(this.devDir, relative);
  }

  private async syncProjectToDevice(): Promise<void> {
    const projectId = this.editor.active?.projectId ?? await this.store.getMeta<string>('lastProject');
    if (!projectId) { toast('Select a project before syncing device files.', 'warn'); return; }
    const files: ProjectFile[] = await this.store.listFiles(projectId);
    if (!files.length) { toast('This project has no files to sync.', 'info'); return; }
    for (const f of files) {
      const tab = this.editor.find('local', f.path, f.projectId);
      const content = tab ? this.editor.getText(tab) : f.content;
      const r = await this.fs.writeFile(this.deviceProjectPath(f.path), bytes(content));
      toast(`Synced ${f.path} (${r.size} bytes${r.crcVerified ? ', CRC verified' : ', size verified'})`, 'ok');
    }
    await this.refresh();
  }

  private async importDeviceTextFiles(): Promise<void> {
    if (!this.dev?.length) { toast('There are no device files to import from this folder.', 'info'); return; }
    const projectId = this.editor.active?.projectId ?? await this.store.getMeta<string>('lastProject');
    if (!projectId) { toast('Open a project file before importing device files.', 'warn'); return; }
    let imported = 0;
    for (const entry of this.dev) {
      if (entry.isDir || !TEXT_EXT.test(entry.name)) continue;
      const data = await this.fs.readFile(entry.path);
      try {
        const content = new TextDecoder('utf-8', { fatal: true }).decode(data);
        await this.store.saveFile(projectId, entry.name, content);
        imported++;
      } catch {
        toast(`${entry.name} is not valid UTF-8 text and was skipped.`, 'warn');
      }
    }
    toast(imported ? `Imported ${imported} text file${imported === 1 ? '' : 's'} into the project.` : 'No text files were found in this device folder.', 'info');
  }

  render(): void {
    const connected = this.session.connected;
    const up = this.devDir !== '/';
    const device = h('section', { class: 'device-explorer' },
      h('div', { class: 'sec-head' }, h('span', { class: 'path', text: this.devDir }), h('span', { class: 'spacer' }),
        h('button', { class: 'icon', title: 'Refresh', icon: 'refresh', disabled: !connected || this.devBusy, onclick: this.guard(() => this.refresh()) }),
        h('button', { class: 'icon', title: 'Upload files here', icon: 'upload', disabled: !connected, onclick: this.guard(async () => {
          const picked = await pickFiles('', true);
          await this.uploadToDevice(await Promise.all(picked.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
        }) }),
        h('button', { class: 'icon', title: 'New file on device', icon: 'plus', disabled: !connected, onclick: this.guard(async () => {
          const name = await promptText('New device file name', 'script.py'); if (!name) return;
          await this.fs.writeFile(joinPath(this.devDir, name), bytes(''));
          await this.refresh();
        }) }),
        h('button', { class: 'icon', title: 'New folder', icon: 'folder-plus', disabled: !connected, onclick: this.guard(async () => {
          const name = await promptText('New folder name'); if (!name) return;
          await this.fs.mkdir(joinPath(this.devDir, name)); await this.refresh();
        }) })),
      h('div', { class: 'row device-actions' },
        h('button', { text: 'Sync project', title: 'Upload all project files to this device folder', disabled: !connected || this.devBusy, onclick: this.guard(() => this.syncProjectToDevice()) }),
        h('button', { text: 'Import text', title: 'Copy text files from this device folder into the project', disabled: !connected || this.devBusy || !this.dev?.length, onclick: this.guard(() => this.importDeviceTextFiles()) })),
      !connected ? h('p', { class: 'hint', text: 'Connect a board to browse its files.' })
        : h('div', {},
          h('p', { class: 'hint device-note', text: 'MicroPython filesystem (/). Windows E: is visible only after safely disconnecting the board.' }),
          this.dev === null ? h('p', { class: 'hint warn', text: this.devBusy ? 'Loading device files…' : `Could not load device files${this.devError ? `: ${this.devError}` : '. Press Refresh to try again.'}` })
            : h('ul', { class: 'files' },
              up ? h('li', { onclick: this.guard(async () => { this.devDir = this.devDir.replace(/\/[^/]+$/, '') || '/'; await this.refresh(); }) }, h('span', { class: 'name', icon: 'corner-up', text: '..' })) : null,
              ...this.dev.map((e) => h('li', {
                class: this.editor.active?.kind === 'device' && this.editor.active.path === e.path ? 'sel' : '',
                onclick: this.guard(async () => {
                  if (e.isDir) { this.devDir = e.path; await this.refresh(); } else await this.openDevice(e);
                }),
              },
              h('span', { class: 'name', icon: e.isDir ? 'folder' : 'file', text: e.name }),
              e.isDir ? null : h('span', { class: 'size', text: e.size >= 1024 ? (e.size / 1024).toFixed(1) + ' K' : e.size + ' B' }),
              e.isDir ? null : h('button', {
                class: 'icon',
                title: 'Download to computer',
                icon: 'download',
                onclick: (ev: Event) => {
                  ev.stopPropagation();
                  this.guard(async () => download(e.name, await this.fs.readFile(e.path)))();
                },
              }),
              h('button', {
                class: 'icon',
                title: 'Delete from device',
                icon: 'trash',
                onclick: (ev: Event) => {
                  ev.stopPropagation();
                  this.guard(async () => {
                    if (!(await confirmBox(`Delete ${e.path} from the device?`, 'Delete'))) return;
                    await this.fs.remove(e.path);
                    const tab = this.editor.find('device', e.path); if (tab) this.editor.close(tab);
                    await this.refresh();
                  })();
                },
              }))),
              this.dev.length === 0 ? h('li', { class: 'hint empty-state', text: 'No files in this device folder. Create a file, upload one, or sync the project.' }) : null)));
    this.root.replaceChildren(device);
  }
}
