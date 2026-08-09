import { App } from 'obsidian';

/**
 * Hash-based verification of a handoff. The record is taken at navigation
 * time and persisted by the caller before the navigation fires, because iOS
 * may tear down the webview while the user is in Preview; an in-memory
 * snapshot would vanish exactly when it matters.
 *
 * Only the hash decides the outcome. Preview has been observed rewriting a
 * file with size and mtime both unchanged, so metadata is recorded as
 * context and trusted for nothing.
 */

export interface Fingerprint {
	size: number;
	mtime: number;
	sha256: string;
}

export interface WitnessRecord extends Fingerprint {
	/** Vault-relative path. Absolute paths are never persisted. */
	vaultPath: string;
	armedAt: number;
}

export type WitnessOutcome = 'changed' | 'unchanged' | 'missing';

/**
 * The record crosses the same data boundary the route value does: data.json
 * is hand-editable and syncs between devices. An unchecked record reaches
 * the adapter as an undefined path, and a check that throws on every launch
 * cannot resolve itself, so the shape is verified before it is trusted.
 */
export function isWitnessRecord(value: unknown): value is WitnessRecord {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.vaultPath === 'string' &&
		record.vaultPath.length > 0 &&
		typeof record.sha256 === 'string' &&
		record.sha256.length === 64 &&
		typeof record.size === 'number' &&
		typeof record.mtime === 'number' &&
		typeof record.armedAt === 'number'
	);
}

export interface WitnessReport {
	outcome: WitnessOutcome;
	after: Fingerprint | null;
	/** One-line result, suitable for a notice. */
	summary: string;
}

export async function armWitnessRecord(
	app: App,
	vaultPath: string,
): Promise<WitnessRecord> {
	const fingerprint = await takeFingerprint(app, vaultPath);
	if (!fingerprint) throw new Error(`cannot read ${vaultPath}`);
	return { vaultPath, ...fingerprint, armedAt: Date.now() };
}

export async function checkWitnessRecord(
	app: App,
	record: WitnessRecord,
): Promise<WitnessReport> {
	const after = await takeFingerprint(app, record.vaultPath);
	if (!after) {
		return {
			outcome: 'missing',
			after: null,
			summary: `Cannot verify: ${record.vaultPath} was not found.`,
		};
	}
	if (after.sha256 !== record.sha256) {
		return {
			outcome: 'changed',
			after,
			summary: `Handoff verified: content changed (sha256 ${shortHash(record.sha256)} to ${shortHash(after.sha256)}).`,
		};
	}
	return {
		outcome: 'unchanged',
		after,
		summary: `No change since arming (sha256 ${shortHash(record.sha256)}). Preview writes shortly after you leave it; verify again after a pause.`,
	};
}

/**
 * Null means "cannot fingerprint", which covers a missing file and an
 * unreadable one alike: for verification the two are the same answer, and a
 * throw here would otherwise surface as a check that repeats every launch.
 */
async function takeFingerprint(
	app: App,
	vaultPath: string,
): Promise<Fingerprint | null> {
	const { adapter } = app.vault;
	try {
		const stat = await adapter.stat(vaultPath);
		if (!stat) return null;
		const bytes = await adapter.readBinary(vaultPath);
		return {
			size: stat.size,
			mtime: stat.mtime,
			sha256: await sha256Hex(bytes),
		};
	} catch {
		return null;
	}
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function shortHash(hash: string): string {
	return hash.slice(0, 12);
}
