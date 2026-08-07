import { App } from 'obsidian';

/**
 * The quarantine for undocumented API. Everything here is typed `unknown` at
 * the boundary, narrowed before use, and treated as optional by its callers:
 * the daily path must keep working if any of it disappears.
 */

/**
 * Undocumented `adapter.getNativePath` returned a file:// URL of the same
 * absolute path on the tested version. Used as a consistency check in debug
 * logging only; no handoff decision rests on it.
 */
export function getNativePath(app: App, vaultPath: string): string | null {
	const adapter: unknown = app.vault.adapter;
	const method = (adapter as Record<string, unknown>)['getNativePath'];
	if (typeof method !== 'function') return null;
	try {
		const result: unknown = (method as (path: string) => unknown).call(
			adapter,
			vaultPath,
		);
		return typeof result === 'string' ? result : null;
	} catch {
		return null;
	}
}

/**
 * Undocumented `app.openWithDefaultApp(vaultPath)` raises the share sheet on
 * iOS; it is the plumbing behind the core command titled "Share" there. It
 * takes the vault-relative path, so it needs no absolute-path resolution.
 */
export function getOpenWithDefaultApp(
	app: App,
): ((vaultPath: string) => void) | null {
	const candidate = (app as unknown as Record<string, unknown>)[
		'openWithDefaultApp'
	];
	if (typeof candidate !== 'function') return null;
	const method = candidate as (path: string) => unknown;
	return (vaultPath: string) => {
		method.call(app, vaultPath);
	};
}
