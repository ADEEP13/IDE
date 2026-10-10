import { DeviceError } from '../util/errors';
import type { ExecResult } from '../repl/RawRepl';
import type { DeviceInfo } from './types';

/** Python string literal (JSON strings are valid Python literals). */
export const pyStr = (s: string): string => JSON.stringify(s);

/** Snippets print their result as @@<json>@@ so stray output can't confuse parsing. */
export function extractResult(stdout: string): unknown {
  const m = /@@([\s\S]*?)@@/.exec(stdout);
  if (!m) throw new DeviceError('Unexpected reply from device: ' + stdout.slice(0, 120));
  return JSON.parse(m[1]);
}

export function assertOk(r: ExecResult): ExecResult {
  if (r.ok) return r;
  const lines = r.stderr.trim().split(/\r?\n/);
  throw new DeviceError(lines[lines.length - 1] || 'Device error', r.stderr);
}

/** Read-only probe: firmware identity and presence of Vicharak's `shrike` module. Nothing is flashed or modified. */
export const PROBE_CODE = `import sys,json
__r={'impl':sys.implementation.name,'version':'.'.join(str(x) for x in sys.implementation.version[:3]),'platform':sys.platform,'machine':getattr(sys.implementation,'_machine',''),'hasShrike':False,'hasFlash':False,'hasReset':False,'shrikeAttrs':[],'importError':''}
try:
    import shrike
    __r['hasShrike']=True
    __r['hasFlash']=hasattr(shrike,'flash')
    __r['hasReset']=hasattr(shrike,'reset')
    __r['shrikeAttrs']=[a for a in dir(shrike) if not a.startswith('_')]
except Exception as __e:
    __r['importError']=repr(__e)
print('@@'+json.dumps(__r)+'@@')
del __r
`;

export const parseDeviceInfo = (stdout: string): DeviceInfo => extractResult(stdout) as DeviceInfo;
