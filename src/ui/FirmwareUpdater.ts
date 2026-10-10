import type { DeviceFs } from '../device/DeviceFs';
import type { DeviceInfo } from '../device/types';
import type { DeviceSession } from '../device/DeviceSession';
import { errMsg } from '../util/errors';
import { download, h } from './dom';
import { toast } from './toast';

const RELEASE = 'v1.0.0';
const RELEASE_PAGE = `https://github.com/vicharak-in/shrike/releases/tag/${RELEASE}`;
const RAW_ROOT = `https://raw.githubusercontent.com/vicharak-in/shrike/${RELEASE}/`;

interface FirmwareBuild {
  name: string;
  chip: string;
  file: string;
  note: string;
}

const BUILDS: FirmwareBuild[] = [
  { name: 'Shrike-Lite', chip: 'RP2040', file: 'shrike-lite_v_1.uf2', note: 'Standard Shrike-Lite RP2040 build' },
  { name: 'Shrike', chip: 'RP2350', file: 'shrike_rp2350.uf2', note: 'Shrike RP2350 build' },
  { name: 'Shrike-Fi', chip: 'ESP32-C3', file: 'shrike_fi_micropy.bin', note: 'Shrike-Fi MicroPython image' },
];

function chipFor(info: DeviceInfo | null): string {
  const value = `${info?.machine ?? ''} ${info?.platform ?? ''}`.toLowerCase();
  if (value.includes('rp2350')) return 'RP2350';
  if (value.includes('esp32') || value.includes('shrike-fi')) return 'ESP32-C3';
  if (value.includes('rp2040') || value.includes('shrike-lite')) return 'RP2040';
  return 'unknown';
}

function matchingBuilds(info: DeviceInfo | null): FirmwareBuild[] {
  const chip = chipFor(info);
  return chip === 'unknown' ? BUILDS : BUILDS.filter((build) => build.chip === chip);
}

/** In-app firmware build discovery and safe download/upload workflow. */
export class FirmwareUpdater {
  constructor(private session: DeviceSession, private fs: DeviceFs) {}

  async check(info: DeviceInfo | null): Promise<void> {
    const build = matchingBuilds(info)[0];
    if (!build) return;
    try {
      const response = await fetch(RAW_ROOT + build.file, { method: 'HEAD', cache: 'no-store' });
      if (response.ok) toast(`Firmware build available for ${build.chip}: ${build.file}`, 'info');
    } catch (e) {
      console.warn('Firmware update check failed', e);
    }
  }

  open(info: DeviceInfo | null): void {
    const dialog = h('dialog', { class: 'modal firmware-modal' });
    const chip = chipFor(info);
    const status = h('p', { class: 'hint', text: 'Choose a matching build to download or place on the board.' });
    const cards = matchingBuilds(info).map((build) => {
      const recommended = chip !== 'unknown' && build.chip === chip;
      const place = h('button', { class: 'primary', text: 'Download & place on board', disabled: !this.session.connected, onclick: () => void this.downloadAndPlace(build, place, status) });
      return h('div', { class: 'firmware-build' },
        h('div', { class: 'firmware-build-head' }, h('b', { text: `${build.name} · ${build.chip}` }), recommended ? h('span', { class: 'badge ok', text: 'Detected' }) : null),
        h('p', { class: 'hint', text: `${build.file} · ${build.note}` }),
        h('div', { class: 'row' },
          h('button', { text: 'Download', onclick: () => void this.download(build, status) }),
          place));
    });
    dialog.append(
      h('h3', { text: `Firmware updates · ${RELEASE}` }),
      h('p', { class: 'hint', text: `Detected chip: ${chip === 'unknown' ? 'Unknown — showing all builds' : chip}` }),
      status,
      ...cards,
      h('p', { class: 'firmware-warning', text: 'The Web Serial connection cannot flash a UF2 into bootloader mode. “Place on board” stores the matching file at /firmware on the MicroPython filesystem. To install it, disconnect the IDE, enter BOOTSEL, and copy the file to the board drive.' }),
      h('a', { class: 'firmware-source', href: RELEASE_PAGE, target: '_blank', rel: 'noopener noreferrer', text: 'View v1.0.0 release details' }),
      h('div', { class: 'row end' }, h('button', { text: 'Close', onclick: () => { dialog.close(); dialog.remove(); } })),
    );
    dialog.addEventListener('cancel', () => { dialog.close(); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
  }

  private async fetchBuild(build: FirmwareBuild): Promise<Uint8Array> {
    const response = await fetch(RAW_ROOT + build.file, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not download ${build.file} (HTTP ${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async download(build: FirmwareBuild, status: HTMLElement): Promise<void> {
    try {
      status.textContent = `Downloading ${build.file}…`;
      download(build.file, await this.fetchBuild(build));
      status.textContent = `${build.file} downloaded.`;
    } catch (e) {
      status.textContent = errMsg(e);
      toast(errMsg(e), 'error');
    }
  }

  private async downloadAndPlace(build: FirmwareBuild, button: HTMLButtonElement, status: HTMLElement): Promise<void> {
    try {
      button.disabled = true;
      status.textContent = `Downloading and writing ${build.file}…`;
      const data = await this.fetchBuild(build);
      const result = await this.fs.writeFile(`/firmware/${build.file}`, data);
      status.textContent = `Placed /firmware/${build.file} (${result.size} bytes verified).`;
      toast(`Placed ${build.file} on the board. Bootloader installation is still required.`, 'ok');
    } catch (e) {
      status.textContent = errMsg(e);
      toast(errMsg(e), 'error');
    } finally {
      button.disabled = !this.session.connected;
    }
  }
}
