/**
 * All undocumented / host-object access is quarantined in this file, so the cost
 * of relying on internals is visible in one place rather than smeared across the
 * experiments. Everything here is best-effort and must be treated as optional.
 */
import { App, CapacitorAdapter, Menu, Platform, TFile } from 'obsidian';

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Public API, and the finding that unblocks most of this spike: CapacitorAdapter
 * is exported and `getFullPath` is @public since Obsidian 1.7.2. So a real
 * on-disk path on iOS does not require an internal API.
 */
export function getFullPath(app: App, file: TFile): string | null {
	const adapter = app.vault.adapter;
	if (adapter instanceof CapacitorAdapter) {
		return adapter.getFullPath(file.path);
	}
	// Desktop, or an adapter shape we don't recognise. Duck-type as a fallback so
	// the probe still reports something useful.
	const maybe = adapter as { getFullPath?: (path: string) => string };
	return typeof maybe.getFullPath === 'function' ? maybe.getFullPath(file.path) : null;
}

/** `getFullPath` may return a bare path or an URL; normalise to a file:// URL. */
export function toFileUrl(fullPath: string): string {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(fullPath)) return fullPath;
	const withSlash = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
	// Encode each segment but keep the separators intact.
	const encoded = withSlash.split('/').map(encodeURIComponent).join('/');
	return `file://${encoded}`;
}

/**
 * Files' own scheme for revealing a path. Undocumented and Apple-private, so a
 * failure here is inconclusive about the scheme itself - it may simply be
 * unreachable from a WKWebView.
 */
export function toSharedDocumentsUrl(fullPath: string, encode: boolean): string {
	const bare = fullPath.replace(/^file:\/\//, '');
	const withSlash = bare.startsWith('/') ? bare : `/${bare}`;
	const body = encode ? withSlash.split('/').map(encodeURIComponent).join('/') : withSlash;
	return `shareddocuments://${body}`;
}

/* -------------------------------------------------------------------------- */
/* Absolute path resolution (probe-driven)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Probe finding (2026-08-06, on-device): `getFullPath()` returns a path
 * relative to the app's Documents directory (`<vault-dir>/<vault-path>`),
 * which nothing outside the app can resolve. The absolute container path is
 * recoverable from undocumented adapter methods, or by parsing the Capacitor
 * resource URL that the public `getResourcePath()` returns. Every candidate is
 * surfaced by `probe` so the device can tell us which ones are real.
 */
export interface PathCandidates {
	/** Public API, but Documents-relative on iOS. */
	getFullPath: string | null;
	/** Undocumented adapter method. Private API. */
	getNativePath: string | null;
	/** Undocumented adapter method. Private API. */
	getFullRealPath: string | null;
	/** Undocumented adapter method. Private API. */
	getRealPath: string | null;
	/** Parsed out of public getResourcePath(); the URL shape is Capacitor-internal. */
	fromResourcePath: string | null;
	/** First candidate that is absolute and actually points at the file. */
	best: string | null;
}

/** Defensive call of an undocumented, unknown-arity adapter method. */
function tryPathMethod(adapter: unknown, method: string, path: string): string | null {
	const fn = (adapter as Record<string, unknown>)[method];
	if (typeof fn !== 'function') return null;
	try {
		const result = (fn as (p: string) => unknown).call(adapter, path);
		return typeof result === 'string' ? result : null;
	} catch {
		return null;
	}
}

/** Strip the `capacitor://localhost/_capacitor_file_` prefix and any query. */
export function absolutePathFromResourcePath(resourcePath: string): string | null {
	const marker = '/_capacitor_file_';
	const index = resourcePath.indexOf(marker);
	if (index === -1) return null;
	let path = resourcePath.slice(index + marker.length);
	const query = path.indexOf('?');
	if (query !== -1) path = path.slice(0, query);
	try {
		return path.split('/').map(decodeURIComponent).join('/');
	} catch {
		return path; // decode failure: raw beats nothing, and the log will show it
	}
}

export function resolvePathCandidates(app: App, file: TFile): PathCandidates {
	const adapter = app.vault.adapter;
	const candidates: PathCandidates = {
		getFullPath: getFullPath(app, file),
		getNativePath: tryPathMethod(adapter, 'getNativePath', file.path),
		getFullRealPath: tryPathMethod(adapter, 'getFullRealPath', file.path),
		getRealPath: tryPathMethod(adapter, 'getRealPath', file.path),
		fromResourcePath: absolutePathFromResourcePath(app.vault.getResourcePath(file)),
		best: null,
	};

	// A usable path must be absolute and must still point at the file — an
	// unknown-arity method that ignores its argument would return the base dir,
	// which "works" as a URL while silently targeting the wrong thing.
	const usable = (p: string | null): p is string =>
		p !== null && p.startsWith('/') && p.endsWith(file.name);

	candidates.best =
		[
			candidates.getNativePath,
			candidates.getFullRealPath,
			candidates.getRealPath,
			candidates.fromResourcePath,
		].find(usable) ??
		// Last resort: a relative path is visibly wrong in the log, none is silent.
		candidates.getFullPath;
	return candidates;
}

/* -------------------------------------------------------------------------- */
/* Capacitor                                                                   */
/* -------------------------------------------------------------------------- */

export interface CapacitorGlobal {
	getPlatform?: () => string;
	isNativePlatform?: () => boolean;
	convertFileSrc?: (url: string) => string;
	Plugins?: Record<string, unknown>;
	platform?: string;
}

export function getCapacitor(): CapacitorGlobal | null {
	const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
	return cap ?? null;
}

/** Names of every Capacitor plugin exposed to Obsidian's webview. */
export function listCapacitorPlugins(): string[] {
	const plugins = getCapacitor()?.Plugins;
	if (!plugins) return [];
	// Include the prototype chain: Capacitor proxies can be lazily defined.
	const names = new Set<string>();
	for (const key in plugins) names.add(key);
	Object.getOwnPropertyNames(plugins).forEach((k) => names.add(k));
	return Array.from(names).sort();
}

export interface CapacitorSharePlugin {
	share: (options: {
		title?: string;
		text?: string;
		url?: string;
		files?: string[];
		dialogTitle?: string;
	}) => Promise<unknown>;
	canShare?: () => Promise<{ value: boolean }>;
}

export function getCapacitorShare(): CapacitorSharePlugin | null {
	const plugin = getCapacitor()?.Plugins?.['Share'];
	if (plugin && typeof (plugin as CapacitorSharePlugin).share === 'function') {
		return plugin as CapacitorSharePlugin;
	}
	return null;
}

export type CapacitorAppOpenUrl = (options: { url: string }) => Promise<unknown>;

/**
 * Capacitor's `App` plugin IS registered in Obsidian's bundle (probe evidence,
 * 2026-08-06). `openUrl` crosses the native bridge to `UIApplication.open`, so
 * WKWebView's navigation policy never sees the URL — a genuinely different
 * mechanism from `window.location`. Two caveats: `openUrl` moved to the
 * separate AppLauncher plugin in Capacitor 3+, and plugin proxies materialise
 * any method name on access — so this can look callable and still reject with
 * "not implemented". That rejection is itself the finding.
 */
export function getCapacitorAppOpenUrl(): CapacitorAppOpenUrl | null {
	const plugin = getCapacitor()?.Plugins?.['App'] as
		| { openUrl?: (options: { url: string }) => Promise<unknown> }
		| undefined;
	return typeof plugin?.openUrl === 'function' ? plugin.openUrl.bind(plugin) : null;
}

/* -------------------------------------------------------------------------- */
/* Obsidian internals                                                          */
/* -------------------------------------------------------------------------- */

interface InternalCommand {
	id: string;
	name: string;
}

interface InternalCommands {
	commands?: Record<string, InternalCommand>;
	listCommands?: () => InternalCommand[];
	executeCommandById?: (id: string) => boolean;
}

/** `app.commands` is not in the public type definitions at all. */
export function getCommands(app: App): InternalCommands | null {
	const internal = (app as unknown as { commands?: InternalCommands }).commands;
	return internal ?? null;
}

export function listCommandIds(app: App): InternalCommand[] {
	const commands = getCommands(app);
	if (!commands) return [];
	if (typeof commands.listCommands === 'function') return commands.listCommands();
	return Object.values(commands.commands ?? {});
}

/**
 * Obsidian's mobile Share lives in the file context menu, not the command
 * palette. So rather than guessing a command id, we synthesise the same event
 * Obsidian fires when a file is long-pressed and read back what gets registered.
 * If a Share item appears, its callback is the exact code path the known-working
 * manual baseline uses.
 */
export interface HarvestedMenuItem {
	title: string;
	icon: string | null;
	invoke: (() => void) | null;
}

export function harvestFileMenu(app: App, file: TFile, source: string): HarvestedMenuItem[] {
	const menu = new Menu();
	app.workspace.trigger('file-menu', menu, file, source);

	const items = (menu as unknown as { items?: unknown[] }).items ?? [];
	return items.map((raw) => {
		const item = raw as {
			titleEl?: { textContent?: string | null };
			dom?: { textContent?: string | null };
			title?: string | { textContent?: string | null };
			iconEl?: unknown;
			icon?: string;
			callback?: () => void;
		};
		const title =
			readText(item.title) ??
			item.titleEl?.textContent ??
			item.dom?.textContent ??
			'(no title)';
		return {
			title: title.trim(),
			icon: typeof item.icon === 'string' ? item.icon : null,
			invoke: typeof item.callback === 'function' ? item.callback.bind(item) : null,
		};
	});
}

function readText(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		const text = (value as { textContent?: string | null }).textContent;
		if (typeof text === 'string') return text;
	}
	return null;
}

/** Documented as desktop-only, and absent from the public types entirely. */
export function getOpenWithDefaultApp(
	app: App,
): ((path: string) => unknown) | null {
	const fn = (app as unknown as { openWithDefaultApp?: (path: string) => unknown })
		.openWithDefaultApp;
	return typeof fn === 'function' ? fn.bind(app) : null;
}

/* -------------------------------------------------------------------------- */
/* Environment summary                                                         */
/* -------------------------------------------------------------------------- */

export function describeEnvironment(app: App): Record<string, unknown> {
	const cap = getCapacitor();
	const adapter = app.vault.adapter;
	return {
		obsidianVersion: (app as unknown as { appId?: string }).appId
			? window.require === undefined
				? 'mobile-like (no require)'
				: 'desktop-like (require present)'
			: 'unknown',
		platform: {
			isMobile: Platform.isMobile,
			isMobileApp: Platform.isMobileApp,
			isIosApp: Platform.isIosApp,
			isAndroidApp: Platform.isAndroidApp,
			isDesktopApp: Platform.isDesktopApp,
			isTablet: Platform.isTablet,
			isPhone: Platform.isPhone,
		},
		adapter: {
			constructorName: adapter.constructor?.name ?? 'unknown',
			isCapacitorAdapter: adapter instanceof CapacitorAdapter,
			hasGetFullPath: typeof (adapter as { getFullPath?: unknown }).getFullPath === 'function',
			methods: Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort(),
		},
		capacitor: cap
			? {
					present: true,
					platform: cap.getPlatform?.() ?? cap.platform ?? 'unknown',
					isNativePlatform: cap.isNativePlatform?.() ?? 'unknown',
					hasConvertFileSrc: typeof cap.convertFileSrc === 'function',
					plugins: listCapacitorPlugins(),
					hasSharePlugin: getCapacitorShare() !== null,
				}
			: { present: false },
		webShare: {
			hasNavigatorShare: typeof navigator.share === 'function',
			hasNavigatorCanShare: typeof navigator.canShare === 'function',
		},
		internals: {
			hasAppCommands: getCommands(app) !== null,
			commandCount: listCommandIds(app).length,
			hasOpenWithDefaultApp: getOpenWithDefaultApp(app) !== null,
		},
		// Recorded as evidence for the write-up, not branched on. Findings need to
		// be attributable to a specific iPadOS build, and Platform cannot give us that.
		userAgent: navigator.userAgent,
	};
}
