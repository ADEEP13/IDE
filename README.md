# Shrike Web IDE

A browser-based MicroPython and FPGA IDE for the Vicharak Shrike-Lite.

[![Version 0.1.0](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CI](https://github.com/ADEEP13/IDE/actions/workflows/ci.yml/badge.svg)](https://github.com/ADEEP13/IDE/actions/workflows/ci.yml)

## Live demo and status

Live demo: <https://ide.adeepag.com>

**Status: IDE v0.1.0, early release.**

## Features

- CodeMirror 6 Python editor with tabs, per-tab undo history, autosave, import, and Ctrl/Cmd+S save.
- Local IndexedDB projects with an in-memory fallback, project switching, and selected-project ZIP download.
- Web Serial connection to authorised boards, including multiple-device selection and switching.
- Device filesystem browsing and editing, upload, download, delete, file/folder creation, project sync, and text import.
- Run, stop, soft reset, streamed stdout/stderr, terminal REPL access, and configurable run timeout/fresh-state options in Settings.
- Help menu with Community and Discuss links.
- FPGA compatibility checks, `.bin` bitstream upload, and `shrike.flash()` support.
- Firmware updater with chip detection, download, and placement under `/firmware`.
- Dark mode by default with an optional light theme.

## Requirements

- Chrome or Edge on desktop. Web Serial is unsupported in Firefox and Safari.
- HTTPS or `http://localhost` when running the app.
- Node.js 18+ for local development.
- A USB data cable.
- Vicharak's custom MicroPython firmware for the board.

## Quick start

1. Open the IDE in Chrome or Edge and connect the board with a USB data cable.
2. Press **Connect** and choose the board. Shift-click **Connect** to list all authorised serial devices.
3. Open `main.py` from the starter project and press **Run** or Ctrl/Cmd+Enter.
4. View streamed output in the terminal. Press **Stop** or use Ctrl-C to interrupt the program.

When no program is running, the terminal is a normal MicroPython REPL. Ctrl-D performs a soft reset and Ctrl-E enables paste mode.

## Local development

```bash
npm install
npm run dev
npm run build
npm run preview
npm test
npm run typecheck
```

`npm run build` runs the TypeScript check and produces the Vite output in `dist/`.

## FPGA workflow

The RP2040 loads the FPGA bitstream as a file on the MicroPython filesystem. The FPGA panel:

1. Checks whether the board is MicroPython-compatible and whether the `shrike` module exposes `flash`.
2. Uploads a `.bin` bitstream to `/` on the board and verifies the write.
3. Runs `import shrike; shrike.flash("name.bin")` to program the FPGA.

The IDE does not synthesize Verilog; use Renesas Go Configure Software Hub to create a bitstream. The bitstream size warning is advisory, based on community-tested files rather than official documentation. RP2040 GPIO 0–3, 12, and 13 are wired to the FPGA link; avoid them in application code when appropriate.

## Firmware updater

The updater in **IDE v0.1.0** detects RP2040, RP2350, and ESP32-C3 boards and offers matching builds from the board firmware **v1.0.0** release. It can download the board firmware v1.0.0 UF2 or place it under `/firmware` on the board's MicroPython filesystem.

Web Serial cannot copy a UF2 directly into the bootloader drive. Installing board firmware v1.0.0 still requires disconnecting the IDE, entering BOOTSEL/mass-storage mode, and copying the file to the board drive. The updater does not claim that placing a file on `/firmware` has flashed the board.

## Architecture

```text
src/
  serial/SerialTransport.ts   Web Serial: open/close, serial writes, read loop, unplug detection
  serial/RxBuffer.ts          passthrough terminal data and protocol reads with timeouts
  repl/protocol.ts            REPL control bytes and prompts
  repl/RawRepl.ts             raw REPL and raw-paste client
  repl/RawRepl.test.ts        raw REPL tests with a simulated device
  device/DeviceSession.ts     connection state, run/stop, and serialized operations
  device/DeviceFs.ts          device file operations over the raw REPL
  device/pyutil.ts            device probe snippets and result parsing
  device/types.ts             device information types
  fpga/FpgaTools.ts           compatibility evaluation, upload, and flash helpers
  storage/ProjectStore.ts     IndexedDB storage and in-memory fallback
  editor/EditorManager.ts     CodeMirror editor and editor tabs
  ui/                         terminal, explorers, FPGA panel, firmware updater, dialogs, icons, and toasts
  util/                       byte, error, and event utilities
  main.ts                     application wiring
```

Modules communicate through small interfaces and events; UI code does not access the serial port directly.

## Deployment

The project can be deployed to Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`
- Node.js version: 18 or newer

Configure the custom domain in Cloudflare Pages after the project is deployed. A hosted deployment must use HTTPS because Web Serial is restricted to secure contexts, except for localhost during development.

## Troubleshooting

- **No port in the chooser:** use a USB data cable. A board in BOOTSEL mode appears as a drive rather than a serial port.
- **Could not open the serial port:** close Thonny, `mpremote`, another IDE tab, or any other program using the port.
- **Hosted copy does not connect:** use an HTTPS deployment. Firefox and Safari do not support Web Serial.
- **Linux permissions:** add the user to `dialout` or `uucp`, then log in again.
- **Cannot enter raw REPL:** press RESET, or remove/fix a `main.py` that catches `KeyboardInterrupt`.
- **Disconnects after `machine.reset()`:** the USB device re-enumerates; press Connect again.
- **Stop does nothing:** code with interrupts disabled or stuck in C may not respond; disconnect and press RESET.
- **Indented terminal paste:** use paste mode with Ctrl-E, or run the script from the editor.

## Known limitations and verification status

- The browser accesses the MicroPython filesystem over Web Serial; it cannot watch or read a Windows mass-storage drive such as `E:` while the serial connection is open.
- Only one board is active at a time, although multiple authorised boards can be selected and switched.
- A hosted copy requires HTTPS; Web Serial is unavailable in Firefox and Safari.
- C/C++ compilation, Verilog synthesis, cloud sync, and a backend are not included.
- The custom `shrike.py` implementation is not read by the IDE; it relies on the documented `shrike.flash(name)` API.

Automated verification consists of the repository's TypeScript check, unit tests, and production build. Hardware testing is limited to what I confirm.

**Hardware verification: <fill in>**

## Roadmap / out of scope

- C/C++ compilation
- Verilog synthesis
- Cloud sync
- Backend services

## Contributing

Keep changes focused, preserve the browser-only architecture, and run `npm run typecheck`, `npm test`, and `npm run build` before opening a pull request.

## License

MIT. See [LICENSE](LICENSE).

## Credits and acknowledgements

- [Vicharak Shrike](https://github.com/vicharak-in/shrike)
- [CodeMirror](https://codemirror.net/)
- [xterm.js](https://xtermjs.org/)
