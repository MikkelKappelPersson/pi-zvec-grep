/**
 * pi-zvec-grep — zvec-grep's local-first hybrid search as native pi tools.
 *
 * Entry point only. The tool/command surface lives in src/extension/tools.ts;
 * scoped settings live in src/extension/config.ts (+ settings-ui.ts menu);
 * workspace path and output helpers live in src/core/.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerAutoIndex, registerZvecCommands, registerZvecTools } from './src/extension/tools.ts';

export default function (pi: ExtensionAPI): void {
	registerZvecTools(pi);
	registerZvecCommands(pi);
	registerAutoIndex(pi);
}
