import { describe, expect, it } from 'vitest';
import {
	WitnessRecord,
	checkWitnessRecord,
	isWitnessRecord,
} from './witness';

type AppArg = Parameters<typeof checkWitnessRecord>[0];

const HASH_OF_A = 'a'.repeat(64);

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/** readBinary returns an ArrayBuffer, so the stub's contents are one too. */
function makeBytes(values: number[]): ArrayBuffer {
	const buffer = new ArrayBuffer(values.length);
	new Uint8Array(buffer).set(values);
	return buffer;
}

/**
 * Minimal stand-in for the vault adapter. 'unreadable' stats fine and then
 * throws on read, which is the case a deleted-mid-check file produces.
 */
interface StubFile {
	size: number;
	mtime: number;
	bytes: ArrayBuffer;
}

function stubApp(files: Record<string, StubFile | 'unreadable'>): AppArg {
	return {
		vault: {
			adapter: {
				stat: (path: string) => {
					const file = files[path];
					if (file === undefined) return Promise.resolve(null);
					if (file === 'unreadable') {
						return Promise.resolve({ size: 1, mtime: 1 });
					}
					return Promise.resolve({ size: file.size, mtime: file.mtime });
				},
				readBinary: (path: string) => {
					const file = files[path];
					if (file === undefined || file === 'unreadable') {
						return Promise.reject(new Error('cannot read'));
					}
					return Promise.resolve(file.bytes);
				},
			},
		},
	} as unknown as AppArg;
}

function record(overrides: Partial<WitnessRecord> = {}): WitnessRecord {
	return {
		vaultPath: 'Sheet.pdf',
		size: 10,
		mtime: 1000,
		sha256: HASH_OF_A,
		armedAt: 1,
		...overrides,
	};
}

describe('isWitnessRecord', () => {
	it('accepts a well-formed record', () => {
		expect(isWitnessRecord(record())).toBe(true);
	});

	it('rejects non-objects', () => {
		for (const value of [null, undefined, 'x', 3, true, []]) {
			expect(isWitnessRecord(value)).toBe(false);
		}
	});

	it('rejects a record missing any field', () => {
		for (const key of [
			'vaultPath',
			'size',
			'mtime',
			'sha256',
			'armedAt',
		] as const) {
			const partial: Record<string, unknown> = { ...record() };
			delete partial[key];
			expect(isWitnessRecord(partial)).toBe(false);
		}
	});

	it('rejects an empty path and a wrong-length hash', () => {
		expect(isWitnessRecord(record({ vaultPath: '' }))).toBe(false);
		expect(isWitnessRecord(record({ sha256: 'abc' }))).toBe(false);
	});

	it('rejects fields of the wrong type', () => {
		expect(isWitnessRecord({ ...record(), size: '10' })).toBe(false);
		expect(isWitnessRecord({ ...record(), sha256: null })).toBe(false);
	});
});

describe('checkWitnessRecord', () => {
	const bytes = makeBytes([1, 2, 3]);

	it('reports unchanged when the hash matches', async () => {
		const sha256 = await sha256Hex(bytes);
		const app = stubApp({ 'Sheet.pdf': { size: 3, mtime: 5, bytes } });
		const report = await checkWitnessRecord(app, record({ sha256 }));
		expect(report.outcome).toBe('unchanged');
		expect(report.after).toEqual({ size: 3, mtime: 5, sha256 });
	});

	it('reports changed when the hash differs', async () => {
		const app = stubApp({ 'Sheet.pdf': { size: 3, mtime: 5, bytes } });
		const report = await checkWitnessRecord(app, record());
		expect(report.outcome).toBe('changed');
		expect(report.summary).toContain('content changed');
	});

	it('ignores size and mtime; only the hash decides', async () => {
		const sha256 = await sha256Hex(bytes);
		// Metadata far from the armed values, same bytes: still unchanged.
		const app = stubApp({ 'Sheet.pdf': { size: 999, mtime: 999, bytes } });
		const unchanged = await checkWitnessRecord(app, record({ sha256 }));
		expect(unchanged.outcome).toBe('unchanged');
		// Metadata identical to the armed values, different bytes: changed.
		const frozen = stubApp({
			'Sheet.pdf': { size: 10, mtime: 1000, bytes },
		});
		const changed = await checkWitnessRecord(frozen, record());
		expect(changed.outcome).toBe('changed');
	});

	it('reports missing when the file is gone', async () => {
		const report = await checkWitnessRecord(stubApp({}), record());
		expect(report.outcome).toBe('missing');
		expect(report.after).toBeNull();
	});

	it('reports missing when the file cannot be read', async () => {
		const app = stubApp({ 'Sheet.pdf': 'unreadable' });
		const report = await checkWitnessRecord(app, record());
		expect(report.outcome).toBe('missing');
	});
});
