export interface DeviceInfo {
  impl: string;
  version: string;
  platform: string;
  /** sys.implementation._machine, e.g. "Vicharak Shrike FPGA with RP2040" on the custom firmware. */
  machine: string;
  hasShrike: boolean;
  hasFlash: boolean;
  hasReset: boolean;
  shrikeAttrs: string[];
  importError: string;
}
