import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Create an isolated filesystem root for tests that need temporary state. */
export function createTempDirectory(prefix = 'pi-zvec-grep-test-') {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Run a test with an isolated temporary root and always remove it afterward. */
export async function withTempDirectory(prefix, callback) {
	const directory = createTempDirectory(prefix);
	try {
		return await callback(directory);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

/** Minimal PASS/FAIL reporter matching the pi-shepherd harness style. */
export function createReporter() {
	let failures = 0;
	return {
		assert(condition, label, extra = '') {
			if (condition) {
				console.log(`PASS  ${label}${extra ? ` — ${extra}` : ''}`);
			} else {
				failures += 1;
				console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
			}
		},
		done() {
			if (failures > 0) {
				console.error(`\n${failures} assertion(s) failed`);
				process.exit(1);
			}
			console.log('\nall assertions passed');
		},
	};
}
