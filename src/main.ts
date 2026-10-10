/* main.ts */
import './styles.css';
import { DeviceFs } from './device/DeviceFs';
import { DeviceSession } from './device/DeviceSession';
import { EditorManager, type Tab } from './editor/EditorManager';
import { FpgaTools } from './fpga/FpgaTools';
import { SerialTransport } from './serial/SerialTransport';
import { openProjectStore } from './storage/ProjectStore';
import { bytes } from './util/bytes';
import { CancelledError, errMsg } from './util/errors';
import { DeviceExplorer } from './ui/DeviceExplorer';
import { FileExplorer } from './ui/FileExplorer';
import { FpgaPanel } from './ui/FpgaPanel';
import { FirmwareUpdater } from './ui/FirmwareUpdater';
import { hydrateIcons } from './ui/icons';
import { TerminalPanel } from './ui/Terminal';
import { toast } from './ui/toast';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  hydrateIcons();

  // Load theme
  const savedTheme = localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = savedTheme;

  const store = await openProjectStore();
  const session = new DeviceSession();
  const fs = new DeviceFs(session);
  const editor = new EditorManager($('editor'), $('editor-tabs'), savedTheme);
  const terminal = new TerminalPanel($('terminal'), session);
  const firmwareUpdater = new FirmwareUpdater(session, fs);
  const explorer = new FileExplorer($('pane-files'), store, editor);
  new DeviceExplorer($('pane-device-files'), store, session, fs, editor);
  new FpgaPanel($('pane-fpga'), new FpgaTools(session, fs), session);

  // ---- unsupported browser banner
  if (!SerialTransport.supported) {
    const b = $('banner'); b.hidden = false;
    b.textContent = 'Web Serial is not available in this browser. Use Chrome or Edge (desktop) on https:// or http://localhost. Editing and local projects still work.';
  }

  // ---- toolbar
  const connectBtn = $<HTMLButtonElement>('btn-connect');
  const runStopBtn = $<HTMLButtonElement>('btn-runstop');
  const runStopLabel = $('runstop-label');
  const connectLabel = $('connect-label');
  const deviceSelect = $<HTMLSelectElement>('device-select');
  const statusbar = $('statusbar');
  const statusEl = $('status');
  const statusText = $('status-text');
  const terminalWrap = $('terminal-wrap');
  const splitter = $('splitter');
  const terminalMenuBtn = $('btn-terminal-menu');

  const renderStatus = () => {
    const s = session.state;
    const stopping = session.state === 'running' && runStopBtn.dataset.stopping === '1';
    const isConnected = s !== 'disconnected' && s !== 'connecting';
    connectBtn.dataset.connected = isConnected ? 'true' : 'false';
    connectLabel.textContent = isConnected ? 'Disconnect' : s === 'connecting' ? 'Connecting…' : 'Connect';
    connectBtn.disabled = s === 'connecting' || (!isConnected && !SerialTransport.supported);
    deviceSelect.disabled = s === 'connecting' || !SerialTransport.supported;
    const running = s === 'running';
    runStopBtn.disabled = (s !== 'idle' && !running) || stopping;
    runStopBtn.classList.toggle('run', !running);
    runStopBtn.classList.toggle('stop', running);
    runStopBtn.dataset.running = String(running);
    runStopLabel.textContent = running ? (stopping ? 'Stopping…' : 'Stop') : 'Run';
    runStopBtn.title = running ? 'Stop the running program' : 'Run (Ctrl/Cmd+Enter)';
    const info = session.info;
    const text: Record<string, string> = {
      disconnected: 'Disconnected', connecting: 'Connecting…',
      idle: info ? `Connected · ${info.machine || 'MicroPython ' + info.version}` : 'Connected',
      running: stopping ? 'Stopping…' : 'Running', busy: 'Working…',
    };
    statusText.textContent = text[s];
    statusEl.dataset.state = s;
    statusbar.dataset.state = s;
  };
  session.on('status', (st) => {
    if (st.background) return;
    runStopBtn.dataset.stopping = st.stopping ? '1' : '';
    renderStatus();
  });
  session.on('info', renderStatus);
  session.on('closed', (c) => { if (c.reason === 'lost') toast(c.message, 'error'); });

  let knownPorts: SerialPort[] = [];
  const refreshDeviceChoices = async () => {
    if (!SerialTransport.supported) { deviceSelect.hidden = true; return; }
    knownPorts = await SerialTransport.authorizedPorts();
    deviceSelect.hidden = false;
    deviceSelect.replaceChildren(new Option(knownPorts.length ? 'Choose device…' : 'Connect a device…', ''));
    knownPorts.forEach((port, i) => deviceSelect.append(new Option(SerialTransport.portLabel(port, i), String(i))));
    const current = knownPorts.findIndex((port) => port === session.port);
    deviceSelect.value = current >= 0 ? String(current) : '';
  };

  deviceSelect.addEventListener('change', async () => {
    const index = Number(deviceSelect.value);
    if (!Number.isInteger(index) || index < 0 || index >= knownPorts.length) return;
    if (session.port === knownPorts[index]) return;
    if (session.state !== 'disconnected' && session.state !== 'idle') {
      toast('Stop the current operation before switching devices.', 'warn');
      await refreshDeviceChoices();
      return;
    }
    try {
      if (session.connected) await session.disconnect();
      await session.connectPort(knownPorts[index]);
    } catch (err) {
      if (!(err instanceof CancelledError)) toast(errMsg(err), 'error');
    } finally { await refreshDeviceChoices(); }
  });

  renderStatus();
  void refreshDeviceChoices();

  connectBtn.addEventListener('click', async (e) => {
    if (session.connected) { await session.disconnect(); await refreshDeviceChoices(); return; }
    try {
      const shift = (e as MouseEvent).shiftKey;
      const selected = Number(deviceSelect.value);
      if (!shift && Number.isInteger(selected) && selected >= 0 && selected < knownPorts.length) await session.connectPort(knownPorts[selected]);
      else await session.connect(shift);
    }
    catch (err) { if (!(err instanceof CancelledError)) toast(errMsg(err), 'error'); }
    finally { await refreshDeviceChoices(); }
  });
  runStopBtn.addEventListener('click', () => {
    if (session.state === 'running') void session.stop();
    else void runCurrent();
  });
  $('btn-term-clear').addEventListener('click', () => terminal.clear());
  $('btn-reset').addEventListener('click', () => session.softReset());

  // ---- status bar: active file and cursor position
  editor.on('cursor', (c) => { $('sb-pos').textContent = `Ln ${c.line}, Col ${c.col}`; });
  editor.on('tabs', () => {
    const t = editor.active;
    $('sb-file').textContent = t ? (t.kind === 'device' ? `Device: ${t.path}` : t.path) : '';
    $('sb-lang').hidden = !t;
    if (!t) $('sb-pos').textContent = '';
  });

  // ---- status bar toggle
  const toggleStatusBar = () => {
    const isHidden = statusbar.hidden;
    statusbar.hidden = !isHidden;
    localStorage.setItem('statusbar-hidden', String(!isHidden));
    $('btn-status').setAttribute('aria-pressed', String(isHidden));
  };
  const savedStatusHidden = localStorage.getItem('statusbar-hidden') === 'true';
  if (savedStatusHidden) {
    statusbar.hidden = true;
    $('btn-status').setAttribute('aria-pressed', 'false');
  }
  $('btn-status').addEventListener('click', toggleStatusBar);
  $('btn-sb-close').addEventListener('click', toggleStatusBar);

  // ---- settings menu
  const settingsMenu = $('settings-menu');
  const settingsBtn = $('btn-settings');
  const helpMenu = $('help-menu');
  const helpBtn = $('btn-help-menu');
  const themeSelect = $('theme-select') as HTMLSelectElement;
  const timeoutSelect = $<HTMLSelectElement>('sel-timeout');
  const freshStateBox = $<HTMLInputElement>('chk-fresh');
  const autoUpdateBox = $<HTMLInputElement>('chk-auto-update');
  const firmwareUpdateBtn = $<HTMLButtonElement>('btn-firmware-update');

  const hideSettingsMenu = () => {
    settingsMenu.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
    settingsBtn.blur();
  };
  const hideHelpMenu = () => {
    helpMenu.hidden = true;
    helpBtn.setAttribute('aria-expanded', 'false');
    helpBtn.blur();
  };

  const syncThemeSelection = () => {
    const theme = document.documentElement.dataset.theme || 'dark';
    themeSelect.value = theme;
  };

  settingsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    hideHelpMenu();
    const nextState = settingsMenu.hidden;
    settingsMenu.hidden = !nextState;
    settingsBtn.setAttribute('aria-expanded', String(nextState));
  });

  helpBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    hideSettingsMenu();
    const nextState = helpMenu.hidden;
    helpMenu.hidden = !nextState;
    helpBtn.setAttribute('aria-expanded', String(nextState));
  });

  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (!settingsMenu.contains(target) && !settingsBtn.contains(target)) {
      hideSettingsMenu();
    }
    if (!helpMenu.contains(target) && !helpBtn.contains(target)) hideHelpMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    hideSettingsMenu();
    hideHelpMenu();
  });

  themeSelect.addEventListener('change', (e) => {
    const theme = (e.target as HTMLSelectElement).value;
    document.documentElement.dataset.theme = theme;
    editor.setTheme(theme === 'light' ? 'light' : 'dark');
    localStorage.setItem('theme', theme);
  });
  syncThemeSelection();
  autoUpdateBox.checked = localStorage.getItem('auto-firmware-update') === 'true';
  autoUpdateBox.addEventListener('change', () => localStorage.setItem('auto-firmware-update', String(autoUpdateBox.checked)));
  firmwareUpdateBtn.addEventListener('click', () => {
    hideSettingsMenu();
    firmwareUpdater.open(session.info);
  });
  session.on('info', (info) => {
    if (info && autoUpdateBox.checked) void firmwareUpdater.check(info);
  });
  const setTerminalVisible = (visible: boolean) => {
    terminalWrap.hidden = !visible;
    splitter.hidden = !visible;
    localStorage.setItem('terminal-hidden', String(!visible));
    if (visible) {
      terminal.refit();
      terminal.focus();
    }
  };
  terminalMenuBtn.addEventListener('click', () => setTerminalVisible(true));
  $('btn-term-close').addEventListener('click', () => setTerminalVisible(false));
  if (localStorage.getItem('terminal-hidden') === 'true') setTerminalVisible(false);

  // ---- run
  const runCurrent = async () => {
    setTerminalVisible(true);
    const tab = editor.active;
    if (!tab) { toast('Open a file to run.', 'warn'); return; }
    if (session.state !== 'idle') { toast(session.connected ? 'The device is busy.' : 'Connect a board first.', 'warn'); return; }
    if (tab.kind === 'local') await saveTab(tab, false);
    try {
      await session.run(editor.getText(tab), {
        timeoutMs: Number(timeoutSelect.value) * 1000 || undefined,
        softReset: freshStateBox.checked,
      });
    } catch (e) { toast(errMsg(e), 'error'); }
    terminal.focus();
  };
  editor.on('run', () => void runCurrent());

  // ---- saving: local files autosave to IndexedDB; device files save on Ctrl+S
  const saveTab = async (tab: Tab, notify = true) => {
    const text = editor.getText(tab);
    try {
      if (tab.kind === 'local') await store.saveFile(tab.projectId!, tab.path, text);
      else {
        const r = await fs.writeFile(tab.path, bytes(text));
        if (notify) toast(`Saved ${tab.path} to device (${r.crcVerified ? 'CRC' : 'size'} verified)`, 'ok');
      }
      editor.markClean(tab);
    } catch (e) { toast(`Save failed: ${errMsg(e)}`, 'error'); }
  };
  editor.on('save', (t) => void saveTab(t));
  const timers = new Map<string, number>();
  editor.on('edit', (t) => {
    if (t.kind !== 'local') return;
    clearTimeout(timers.get(t.id));
    timers.set(t.id, window.setTimeout(() => void saveTab(t, false), 700));
  });
  window.addEventListener('beforeunload', (e) => { if (editor.hasDirty()) e.preventDefault(); });

  // ---- sidebar tabs, mobile drawer, splitter
  document.querySelectorAll<HTMLButtonElement>('nav.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('pane-files').hidden = b.dataset.tab !== 'files';
    $('pane-device').hidden = b.dataset.tab !== 'device';
    $('pane-fpga').hidden = b.dataset.tab !== 'fpga';
    $('side-title').textContent = b.dataset.tab === 'device' ? 'Device' : b.dataset.tab === 'fpga' ? 'FPGA' : 'Explorer';
  }));
  $('btn-menu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('editor').addEventListener('click', () => $('sidebar').classList.remove('open'));

  const split = splitter; const wrap = terminalWrap;
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = $('center').getBoundingClientRect();
      wrap.style.height = Math.min(Math.max(r.bottom - ev.clientY, 80), r.height - 120) + 'px';
      terminal.refit();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', () => split.removeEventListener('pointermove', move), { once: true });
  });

  await explorer.init();
  if (SerialTransport.supported) {
    navigator.serial.addEventListener('connect', () => {
      if (session.state === 'disconnected') toast('A serial device was plugged in. Press Connect.', 'info');
    });
  }
}

void main();