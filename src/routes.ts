import { App, Notice, TFile } from 'obsidian';
import { EtchLog } from './log';
import { resolveAbsolutePath } from './resolve';
import { armWitnessRecord, WitnessRecord } from './witness';

/**
 * The two handoff routes, both plain web navigation. Selection is a
 * setting, there is no automatic fallback between routes, and a handoff
 * fires exactly one navigation.
 */
export const ROUTE_IDS = ['file', 'shareddocuments'] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

/**
 * Dropdown labels, in display order with the default first. They live beside
 * the route ids so a third route cannot compile without its label.
 */
export const ROUTE_LABELS: Record<RouteId, string> = {
	file: 'Preview (default)',
	shareddocuments: 'Files viewer',
};

/**
 * The route value crosses a data boundary: data.json is hand-editable and
 * syncs between devices. Both readers of that file guard with this. A
 * `share-sheet` value from a pre-0.1.0 install falls back to the default
 * here, so no migration code is needed.
 */
export function isRouteId(value: unknown): value is RouteId {
	return (
		typeof value === 'string' &&
		(ROUTE_IDS as readonly string[]).includes(value)
	);
}

export interface HandoffContext {
	app: App;
	log: EtchLog;
	route: RouteId;
	/** Persist the armed witness record; resolves once the write completes. */
	arm: (record: WitnessRecord) => Promise<void>;
}

/** Percent-encode every path segment, keeping the separators. */
export function encodePathSegments(absolutePath: string): string {
	return absolutePath.split('/').map(encodeURIComponent).join('/');
}

interface HandoffPlan {
	/** What fires, recorded in the debug log before navigating. */
	description: string;
	navigate: () => void;
}

/** How the URL is handed to the OS. Route 1 opens, route 2 assigns. */
export type NavigationKind = 'open' | 'assign';

export interface HandoffTarget {
	url: string;
	kind: NavigationKind;
	/** Logged verbatim before navigating, so the log names what fired. */
	description: string;
}

/**
 * The two URLs are the product, so they are built by a pure function the
 * tests can pin. The description strings are the ones the device logs carry;
 * changing them breaks continuity with the archived session logs.
 */
export function buildHandoffTarget(
	route: RouteId,
	encodedPath: string,
): HandoffTarget {
	if (route === 'file') {
		const url = `file://${encodedPath}`;
		return { url, kind: 'open', description: `window.open("${url}")` };
	}
	const url = `shareddocuments://${encodedPath}`;
	return {
		url,
		kind: 'assign',
		description: `window.location.href = "${url}"`,
	};
}

export async function performHandoff(
	context: HandoffContext,
	file: TFile,
): Promise<void> {
	const { app, log, route } = context;

	const plan = await buildPlan(context, file);
	if (!plan) return;

	// Arm and persist the witness before the navigation fires; the webview
	// may not survive the trip. Verification is a debug aid, so failing to
	// arm it costs the check and not the handoff: the path is already
	// resolved and validated here, and hashing a very large file is the
	// likeliest way to fail. The user is told the check is unavailable.
	try {
		const record = await armWitnessRecord(app, file.path);
		await context.arm(record);
		await log.line(
			`witness armed: ${record.vaultPath} size=${record.size} mtime=${record.mtime} sha256=${record.sha256}`,
		);
	} catch (error) {
		new Notice('Handing off without verification.');
		await log.error(`witness arm failed for ${file.path}`, error);
	}
	await log.line(`route ${route}: ${plan.description}`);

	plan.navigate();
}

async function buildPlan(
	context: HandoffContext,
	file: TFile,
): Promise<HandoffPlan | null> {
	const { app, log, route } = context;

	const resolved = resolveAbsolutePath(app, file);
	if (!resolved.ok) {
		new Notice(resolved.message);
		await log.error(
			`path resolution failed (${resolved.failure}) for ${file.path}`,
		);
		return null;
	}
	await log.line(`resolved ${file.path} -> ${resolved.absolutePath}`);

	const target = buildHandoffTarget(route, encodePathSegments(resolved.absolutePath));
	return {
		description: target.description,
		navigate: () => {
			if (target.kind === 'open') {
				window.open(target.url);
			} else {
				window.location.href = target.url;
			}
		},
	};
}
