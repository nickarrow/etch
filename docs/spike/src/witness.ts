import { App } from 'obsidian';

/**
 * The evidence instrument for the spike.
 *
 * The central question is "in place, or a copy?" Eyeballing the PDF in Obsidian
 * cannot answer that: the embed may be cached, and a copy may have been written
 * somewhere we never look. So we fingerprint the *exact vault path* before the
 * handoff and re-fingerprint it after returning. A changed hash at the same path
 * is positive proof of an in-place write. An unchanged hash proves the edit went
 * somewhere else, without us having to find where.
 */
export interface FileSnapshot {
	path: string;
	size: number;
	mtime: number;
	ctime: number;
	sha256: string;
	takenAt: number;
}

export async function takeSnapshot(app: App, path: string): Promise<FileSnapshot> {
	const { adapter } = app.vault;
	const stat = await adapter.stat(path);
	if (!stat) throw new Error(`cannot stat ${path}`);
	const bytes = await adapter.readBinary(path);
	return {
		path,
		size: stat.size,
		mtime: stat.mtime,
		ctime: stat.ctime,
		sha256: await sha256(bytes),
		takenAt: Date.now(),
	};
}

export interface SnapshotDiff {
	changed: boolean;
	/** True when content changed. This is the finding that matters. */
	contentChanged: boolean;
	summary: string;
}

export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): SnapshotDiff {
	const contentChanged = before.sha256 !== after.sha256;
	const sizeDelta = after.size - before.size;
	const parts: string[] = [];

	if (contentChanged) {
		parts.push(`sha256 CHANGED (${short(before.sha256)} -> ${short(after.sha256)})`);
	} else {
		parts.push(`sha256 identical (${short(before.sha256)})`);
	}
	parts.push(`size ${before.size} -> ${after.size} (${sizeDelta >= 0 ? '+' : ''}${sizeDelta})`);
	parts.push(`mtime ${before.mtime} -> ${after.mtime}`);

	// mtime moving without content changing is worth seeing: it usually means
	// something touched the file (a coordinated open) but wrote nothing back.
	const changed = contentChanged || before.mtime !== after.mtime || before.size !== after.size;

	return { changed, contentChanged, summary: parts.join('; ') };
}

export function verdict(diff: SnapshotDiff): string {
	if (diff.contentChanged) {
		return 'IN-PLACE WRITE CONFIRMED - the vault file itself changed.';
	}
	if (diff.changed) {
		return 'TOUCHED BUT NOT WRITTEN - metadata moved, bytes did not. Likely opened read-only, or edited as a copy.';
	}
	return (
		'NO CHANGE - the vault file was not modified. If you made no edit, this is ' +
		'the expected result; if you did make one, it went to a copy.'
	);
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function short(hash: string): string {
	return hash.slice(0, 12);
}
