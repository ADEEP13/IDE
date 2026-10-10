import type { EditorManager } from '../editor/EditorManager';
import { createSeededProject, type Project, type ProjectFile, type ProjectStore } from '../storage/ProjectStore';
import { BusyError, errMsg } from '../util/errors';
import { confirmBox, promptText } from './dialogs';
import { downloadZip, h, pickFiles } from './dom';
import { toast } from './toast';

/** Sidebar project explorer. Device files live in the dedicated FPGA activity view. */
export class FileExplorer {
  private projects: Project[] = [];
  private files: ProjectFile[] = [];
  projectId = '';

  constructor(private root: HTMLElement, private store: ProjectStore, private editor: EditorManager) {
    editor.on('tabs', () => this.render());
  }

  async init(): Promise<void> {
    this.projects = await this.store.listProjects();
    if (!this.projects.length) this.projects = [await createSeededProject(this.store, 'My first project')];
    const last = await this.store.getMeta<string>('lastProject');
    this.projectId = this.projects.find((p) => p.id === last)?.id ?? this.projects[0].id;
    await this.loadFiles();
    const defaultFile = this.files.find((f) => f.path === 'main.py') ?? this.files[0];
    if (defaultFile) this.openLocal(defaultFile);
  }

  private async loadFiles(): Promise<void> {
    this.files = await this.store.listFiles(this.projectId);
    this.render();
  }

  private openFirstFile(): void {
    const file = this.files.find((f) => f.path === 'main.py') ?? this.files[0];
    if (file) this.openLocal(file);
    else this.editor.activate(null);
  }

  private async switchProject(projectId: string): Promise<void> {
    this.projectId = projectId;
    await this.store.setMeta('lastProject', projectId);
    await this.loadFiles();
    this.editor.closeWhere((tab) => tab.kind === 'local' && tab.projectId !== projectId);
    this.openFirstFile();
  }

  private guard<T extends unknown[]>(fn: (...args: T) => Promise<void>): (...args: T) => void {
    return (...args: T) => { fn(...args).catch((e) => toast(e instanceof BusyError ? e.message : errMsg(e), 'error')); };
  }

  openLocal(f: ProjectFile): void {
    this.editor.open({ kind: 'local', projectId: this.projectId, path: f.path, content: f.content });
  }

  private downloadProject(): void {
    const project = this.projects.find((p) => p.id === this.projectId);
    if (!project || !this.files.length) { toast('This project has no files to download.', 'info'); return; }
    const files = this.files.map((f) => {
      const tab = this.editor.find('local', f.path, this.projectId);
      return { name: f.path, data: tab ? this.editor.getText(tab) : f.content };
    });
    const archiveName = project.name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    downloadZip(`${archiveName}.zip`, files);
    toast(`Downloaded ${project.name}.`, 'info');
  }

  // ---- render -----------------------------------------------------------

  render(): void {
    const act = this.editor.active;
    const projectSel = h('select', { title: 'Project', onchange: this.guard(async (e: Event) => {
      await this.switchProject((e.target as HTMLSelectElement).value);
    }) },
      ...this.projects.map((p) => h('option', { value: p.id, text: p.name, selected: p.id === this.projectId })));

    const local = h('section', {},
      h('div', { class: 'sec-head' }, h('b', { text: 'PROJECT' }), h('span', { class: 'spacer' }),
        h('button', { class: 'icon', title: 'New project', icon: 'plus', onclick: this.guard(async () => {
          const name = await promptText('New project name'); if (!name) return;
          const p = await createSeededProject(this.store, name);
          this.projects = await this.store.listProjects(); this.projectId = p.id; await this.store.setMeta('lastProject', p.id); await this.loadFiles();
          const m = this.files[0]; if (m) this.openLocal(m);
        }) }),
        h('button', { class: 'icon', title: 'Rename project', icon: 'pencil', onclick: this.guard(async () => {
          const cur = this.projects.find((p) => p.id === this.projectId); const name = await promptText('Rename project', cur?.name); if (!name) return;
          await this.store.renameProject(this.projectId, name); this.projects = await this.store.listProjects(); this.render();
        }) }),
        h('button', { class: 'icon', title: 'Delete project', icon: 'trash', onclick: this.guard(async () => {
          if (this.projects.length < 2) { toast('Keep at least one project.', 'warn'); return; }
          if (!(await confirmBox('Delete this project and all its files? This cannot be undone.', 'Delete'))) return;
          this.editor.closeWhere((t) => t.projectId === this.projectId);
          await this.store.deleteProject(this.projectId); this.projects = await this.store.listProjects();
          this.projectId = this.projects[0].id; await this.loadFiles();
        }) }),
        h('button', { class: 'icon', title: 'Download project folder', icon: 'download', onclick: () => this.downloadProject() })),
      projectSel,
      h('ul', { class: 'files' }, ...this.files.map((f) => {
        const tab = this.editor.find('local', f.path, this.projectId);
        return h('li', { class: tab && tab === act ? 'sel' : '', onclick: () => this.openLocal(f) },
          h('span', { class: 'name', icon: 'file', text: f.path }),
          h('button', { class: 'icon', title: 'Rename', icon: 'pencil', onclick: this.guard(async () => {
            const to = await promptText('Rename file', f.path); if (!to || to === f.path) return;
            if (this.files.some((x) => x.path === to)) { toast('A file with that name already exists.', 'warn'); return; }
            await this.store.renameFile(this.projectId, f.path, to);
            const t = this.editor.find('local', f.path, this.projectId); if (t) this.editor.retarget(t, to);
            await this.loadFiles();
          }) }),
          h('button', { class: 'icon', title: 'Delete', icon: 'trash', onclick: this.guard(async () => {
            if (!(await confirmBox(`Delete ${f.path}?`, 'Delete'))) return;
            const t = this.editor.find('local', f.path, this.projectId); if (t) this.editor.close(t);
            await this.store.deleteFile(this.projectId, f.path); await this.loadFiles();
          }) }));
      })),
      h('div', { class: 'row' },
        h('button', { icon: 'plus', text: 'New file', onclick: this.guard(async () => {
          const name = await promptText('New file name', 'script.py'); if (!name) return;
          if (this.files.some((x) => x.path === name)) { toast('A file with that name already exists.', 'warn'); return; }
          await this.store.saveFile(this.projectId, name, ''); await this.loadFiles();
          this.openLocal(this.files.find((x) => x.path === name)!);
        }) }),
        h('button', { text: 'Import…', title: 'Import files from your computer into this project', onclick: this.guard(async () => {
          for (const f of await pickFiles('.py,.txt,.json,.md', true)) await this.store.saveFile(this.projectId, f.name, await f.text());
          await this.loadFiles();
        }) })),
      this.store.persistent ? null : h('p', { class: 'hint warn', text: 'IndexedDB is unavailable: projects will be lost on reload.' }));

    this.root.replaceChildren(local);
  }
}
