import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { Emitter } from '../util/emitter';
import { h } from '../ui/dom';

export interface Tab {
  id: string;
  kind: 'local' | 'device';
  path: string;
  projectId?: string;
  state: EditorState;
  dirty: boolean;
}
export type EditorEvents = { edit: Tab; save: Tab; run: void; tabs: void; cursor: { line: number; col: number } };
export type EditorTheme = 'dark' | 'light';

const sameTab = (t: Tab, kind: string, path: string, projectId?: string) =>
  t.kind === kind && t.path === path && t.projectId === projectId;

/** CodeMirror 6 editor with a tab strip; each tab keeps its own EditorState (undo history, cursor). */
export class EditorManager extends Emitter<EditorEvents> {
  readonly tabs: Tab[] = [];
  active: Tab | null = null;
  private view: EditorView;
  private n = 0;
  private readonly theme = new Compartment();
  private currentTheme: EditorTheme;

  constructor(host: HTMLElement, private strip: HTMLElement, initialTheme: EditorTheme = 'dark') {
    super();
    this.currentTheme = initialTheme;
    this.view = new EditorView({ parent: host, state: this.makeState('', initialTheme) });
    this.renderStrip();
  }

  private makeState(doc: string, theme: EditorTheme = this.currentTheme): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        Prec.highest(keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { if (this.active) this.emit('save', this.active); return true; } },
          { key: 'Mod-Enter', preventDefault: true, run: () => { this.emit('run', undefined); return true; } },
        ])),
        basicSetup,
        keymap.of([indentWithTab, ...defaultKeymap]),
        indentUnit.of('    '),
        python(),
        syntaxHighlighting(defaultHighlightStyle),
        this.theme.of(this.editorTheme(theme)),
        EditorView.updateListener.of((u) => {
          if ((u.selectionSet || u.docChanged) && this.active) this.emitCursor(u.state);
          if (u.docChanged && this.active) {
            this.active.dirty = true;
            this.renderStrip();
            this.emit('edit', this.active);
          }
        }),
      ],
    });
  }

  setTheme(theme: EditorTheme): void {
    this.currentTheme = theme;
    this.view.dispatch({ effects: this.theme.reconfigure(this.editorTheme(theme)) });
    for (const tab of this.tabs) {
      if (tab !== this.active) tab.state = tab.state.update({ effects: this.theme.reconfigure(this.editorTheme(theme)) }).state;
    }
  }

  private editorTheme(theme: EditorTheme) {
    const dark = theme === 'dark';
    return EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
      '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '13.5px', lineHeight: '1.65' },
      '.cm-gutters': { backgroundColor: 'var(--bg)', color: dark ? '#6e7681' : '#8a8a8a', border: 'none' },
      '.cm-activeLine': { backgroundColor: dark ? '#ffffff0a' : '#00000008' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
      '.cm-content': { caretColor: 'var(--fg)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
      '.cm-selectionBackground, ::selection': { backgroundColor: dark ? '#264f78' : '#add6ff' },
    }, { dark });
  }

  private emitCursor(state: EditorState): void {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    this.emit('cursor', { line: line.number, col: head - line.from + 1 });
  }

  find(kind: Tab['kind'], path: string, projectId?: string): Tab | undefined {
    return this.tabs.find((t) => sameTab(t, kind, path, projectId));
  }

  open(spec: { kind: Tab['kind']; path: string; projectId?: string; content: string }): Tab {
    const existing = this.find(spec.kind, spec.path, spec.projectId);
    if (existing) { this.activate(existing); return existing; }
    const tab: Tab = { id: `t${++this.n}`, kind: spec.kind, path: spec.path, projectId: spec.projectId, state: this.makeState(spec.content), dirty: false };
    this.tabs.push(tab);
    this.activate(tab);
    return tab;
  }

  activate(tab: Tab | null): void {
    if (this.active) this.active.state = this.view.state;
    this.active = tab;
    this.view.setState(tab ? tab.state : this.makeState(''));
    this.view.contentDOM.setAttribute('contenteditable', tab ? 'true' : 'false');
    if (tab) { this.view.focus(); this.emitCursor(this.view.state); }
    this.renderStrip();
    this.emit('tabs', undefined);
  }

  close(tab: Tab): void {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.active === tab) { this.active = null; this.activate(this.tabs[Math.min(i, this.tabs.length - 1)] ?? null); }
    else { this.renderStrip(); this.emit('tabs', undefined); }
  }

  closeWhere(pred: (t: Tab) => boolean): void { this.tabs.filter(pred).forEach((t) => this.close(t)); }

  getText(tab: Tab | null = this.active): string {
    if (!tab) return '';
    return tab === this.active ? this.view.state.doc.toString() : tab.state.doc.toString();
  }

  markClean(tab: Tab): void { tab.dirty = false; this.renderStrip(); }

  retarget(tab: Tab, path: string): void { tab.path = path; this.renderStrip(); }

  hasDirty(kind?: Tab['kind']): boolean { return this.tabs.some((t) => t.dirty && (!kind || t.kind === kind)); }

  private renderStrip(): void {
    this.strip.replaceChildren(
      ...this.tabs.map((t) =>
        h('div', { class: 'tab' + (t === this.active ? ' active' : ''), title: `${t.kind === 'device' ? 'Device' : 'Project'}: ${t.path}`, onclick: () => this.activate(t) },
          h('span', { class: 'tab-kind', icon: t.kind === 'device' ? 'cpu' : 'file' }),
          h('span', { text: t.path.split('/').pop() ?? t.path }),
          h('span', { class: 'tab-dirty' + (t.dirty ? ' on' : ''), title: t.dirty ? 'Unsaved changes' : '' }),
          h('button', { class: 'tab-close', title: 'Close', icon: 'x', onclick: (e: Event) => { e.stopPropagation(); this.close(t); } }))),
    );
  }
}
