# Shrike Web IDE

**Program your Shrike-Lite from a browser tab. Write MicroPython, run it on the board, and load FPGA designs, with nothing to install.**

[![Version 0.1.0](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CI](https://github.com/ADEEP13/IDE/actions/workflows/ci.yml/badge.svg)](https://github.com/ADEEP13/IDE/actions/workflows/ci.yml)

**[Open the IDE → ide.adeepag.com](https://ide.adeepag.com)**

> **Status: v0.1.0, early release.** The core workflow (write, run, stop, manage files, flash the FPGA) is in place and under active testing on real hardware. Expect rough edges, and please report them.

<!-- Add a screenshot or short GIF of the IDE here, for example: ![Shrike Web IDE](docs/screenshot.png) -->

---

## What is it?

The [Vicharak Shrike-Lite](https://github.com/vicharak-in/shrike) pairs an RP2040 microcontroller with a small FPGA on one board. That is a great learning platform, but getting started usually means installing several tools, picking the right board packages, and learning how each part talks to the others.

**Shrike Web IDE puts the whole beginner workflow in one browser tab.** Plug in the board over USB, press **Connect**, and you can edit code, run it, watch the output, browse the board's files, and load an FPGA design, all in the same window.

There is no account, no installer, and no server. Your projects stay in your browser.

---

## Why you might like it

### Start in under a minute
Open the page, plug in the board, press Connect. There is no setup, no board manager, no drivers to hunt down, and no toolchain to keep up to date. If you can open a website, you can start.

### See results immediately
MicroPython runs the moment you press **Run**. There is no compile step and no upload wait. Output streams into the built-in terminal as it happens, and **Stop** interrupts a running program straight away. Change a line, press Run again, and see the difference in seconds.

### One place for the MCU and the FPGA
The FPGA panel checks that your board has the right firmware, uploads a bitstream, and programs the FPGA with one click. You don't need a separate flashing tool.

### Your files, on the board
A built-in file manager lets you browse the board's storage, open and edit files, upload, download, create folders, and sync a whole project to the device. Saves are verified, so you know the file that landed on the board is the file you sent.

### Safe by design
- **Run timeout:** stop runaway programs automatically after 10 s, 30 s, 1 min or 5 min.
- **Fresh state:** optionally soft-reset the board before every run so each run starts clean.
- **Honest about firmware:** the firmware updater downloads the right build for your board and says clearly when a manual BOOTSEL step is still needed. It never claims something was flashed when it wasn't.

### Private and offline-friendly
Projects are saved locally in your browser and autosaved as you type. Nothing is uploaded anywhere. The only network requests the app makes are the ones you ask for, such as downloading a firmware build.

---

## Shrike Web IDE vs Arduino IDE

Both are good tools. They are built for different starting points.

| | **Shrike Web IDE** | **Arduino IDE** |
|---|---|---|
| **Installation** | None. Open a web page. | Install the application, then add board packages and libraries. |
| **Language** | MicroPython | C/C++ |
| **Edit → see result** | Press Run and the code runs instantly. | Compile, upload, then reset. Slower for small experiments. |
| **Interactive console** | Built-in MicroPython REPL: try one line at a time. | Serial Monitor for output only. |
| **Board files** | Browse, edit, upload and download files on the board. | Not part of the workflow. |
| **FPGA support** | Check, upload and program the FPGA bitstream from the same window. | Needs a separate flashing step. |
| **Platform** | Any desktop with Chrome or Edge. | Windows, macOS and Linux apps. |
| **Updates** | Always the latest version when you open the page. | Download and install new releases yourself. |
| **Best for** | Learning, quick experiments, classrooms, workshops. | Performance-critical C/C++ firmware and the large Arduino library ecosystem. |

### When Arduino IDE is the better choice
Shrike Web IDE is intentionally focused. Pick the Arduino IDE if you need to:
- write C/C++ firmware, or
- use Arduino libraries that have no MicroPython equivalent, or
- work in a browser other than Chrome or Edge.

---

## Who is it for?

- **Beginners** who want to blink an LED and understand an FPGA without a day of setup.
- **Students and classrooms**, where any laptop with Chrome can be ready in seconds.
- **Workshops and demos**, where there is no time to install anything on 30 machines.
- **Makers** who want to try an idea quickly, then move to heavier tools if they need them.

---

## What it can do today

- Python editor with syntax highlighting, tabs and autosave
- Multiple local projects, with import from your computer
- One-click connect over USB, with support for several authorised boards
- Run, stop, soft reset and a live terminal with a full MicroPython REPL
- Run timeout and fresh-state options
- Device file manager: browse, edit, upload, download, delete, create folders, sync and import
- FPGA compatibility check, bitstream upload and flashing
- Firmware updater with chip detection and downloads
- Dark and light themes

---

## What it doesn't do (yet)

Being clear about the limits so there are no surprises:

- **No C/C++ compilation.** MicroPython only.
- **No Verilog synthesis.** Create your FPGA bitstream with Renesas Go Configure, then load it here.
- **Chrome and Edge on desktop only.** Other browsers don't support the Web Serial technology the IDE relies on, and phones can't connect to USB boards this way.
- **Firmware installation still needs BOOTSEL mode.** A browser cannot write straight into the board's bootloader drive.
- **Early release.** Version 0.1.0 has been tried on limited hardware.

---

## What you'll need

- A Shrike-Lite (or a compatible Shrike board) running Vicharak's custom MicroPython firmware
- A USB-C **data** cable (charge-only cables won't work)
- Chrome or Edge on a desktop or laptop

---

## Troubleshooting

- **No board shows up:** try a different USB cable, since many cables only charge. A board in BOOTSEL mode appears as a drive, not a serial device.
- **"Could not open the serial port":** close Thonny, mpremote or any other tab using the board.
- **The page can't connect:** use Chrome or Edge on a desktop, and make sure the page is loaded over HTTPS.
- **The board disconnects after `machine.reset()`:** that's normal. The board restarts its USB connection, so press Connect again.

---

## Feedback and contributions

Found a bug or want a feature? [Open an issue](https://github.com/ADEEP13/IDE/issues). Contributions are welcome. Keep changes focused and make sure the project's checks pass before you open a pull request.

---

## Credits

Built for the [Vicharak Shrike](https://github.com/vicharak-in/shrike) boards, with [CodeMirror](https://codemirror.net/) and [xterm.js](https://xtermjs.org/).

Shrike and Shrike-Lite are products of Vicharak.

## License

[MIT](LICENSE)
