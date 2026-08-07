import { App, TFile } from 'obsidian';

/**
 * Absolute-path resolution for the handoff URL.
 *
 * The public `vault.getResourcePath(file)` returns a Capacitor resource URL
 * that carries the absolute container path of the file:
 *
 *     capacitor://localhost/_capacitor_file_/var/mobile/Containers/Data/
 *     Application/<UUID>/Documents/<vault folder>/<vault path>
 *
 * The path is the substring after `/_capacitor_file_`, stripped of any query
 * string and percent-decoded per segment. The container UUID changes on app
 * reinstall, so resolution runs on every tap and the result is never stored.
 */

const CAPACITOR_FILE_MARKER = '/_capacitor_file_';

export type ResolveFailure =
	| 'unrecognized-resource-url'
	| 'decode-failed'
	| 'validation-failed'
	| 'non-local-vault';

export type ResolveResult =
	| { ok: true; absolutePath: string }
	| { ok: false; failure: ResolveFailure; message: string };

export function resolveAbsolutePath(app: App, file: TFile): ResolveResult {
	const resourcePath = app.vault.getResourcePath(file);

	const markerIndex = resourcePath.indexOf(CAPACITOR_FILE_MARKER);
	if (markerIndex === -1) {
		return {
			ok: false,
			failure: 'unrecognized-resource-url',
			message:
				'Could not find the file on disk; its resource URL has an unexpected shape. No handoff was made.',
		};
	}

	let encodedPath = resourcePath.slice(
		markerIndex + CAPACITOR_FILE_MARKER.length,
	);
	const queryIndex = encodedPath.indexOf('?');
	if (queryIndex !== -1) encodedPath = encodedPath.slice(0, queryIndex);

	let absolutePath: string;
	try {
		absolutePath = encodedPath
			.split('/')
			.map((segment) => decodeURIComponent(segment))
			.join('/');
	} catch {
		return {
			ok: false,
			failure: 'decode-failed',
			message: 'Could not decode the file path. No handoff was made.',
		};
	}

	// The path must be absolute and its last segment must equal the target
	// filename. Segment equality rejects relative paths, file:// URLs, and a
	// method that ignored its argument and returned a base directory.
	const lastSegment = absolutePath.split('/').pop();
	if (!absolutePath.startsWith('/') || lastSegment !== file.name) {
		return {
			ok: false,
			failure: 'validation-failed',
			message: `The resolved location does not point at ${file.name}. No handoff was made.`,
		};
	}

	// Only the proven local-vault container shape may navigate. Anything
	// else, including iCloud containers, declines here.
	const inLocalContainer =
		(absolutePath.startsWith('/var/') ||
			absolutePath.startsWith('/private/var/')) &&
		absolutePath.includes('/Containers/Data/Application/');
	if (!inLocalContainer) {
		return {
			ok: false,
			failure: 'non-local-vault',
			message:
				'This vault is not stored locally on the iPad. Etch supports local vaults only.',
		};
	}

	return { ok: true, absolutePath };
}
