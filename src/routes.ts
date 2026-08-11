import { App, Notice, TFile } from 'obsidian';
import { EtchLog } from './log';
import { resolveAbsolutePath } from './resolve';
import { armWitnessRecord, WitnessRecord } from './witness';

/**
 * The two handoff routes, both plain web navigation. Selection is a
 * setting, there is no automatic fallback between routes, and a handoff
 * fires exactly one navigation.
 */
export const ROUTE_IDS = ['shareddocuments', 'file'] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

/**
 * Dropdown labels, in display order with the default first. They live beside
 * the route ids so a third route cannot compile without its label.
 */
export const ROUTE_LABELS: Record<RouteId, string> = {
	shareddocuments: 'Files viewer (default)',
	file: 'Preview',
};

/**
 * At or above this size, a handoff uses the Files viewer even when the
 * setting says Preview.
 *
 * Preview wrote nothing on two several-hundred-page PDFs across nine handoffs
 * in the wave 3 session, 2026-08-11: an 18 MB file and a 243 MB file, one
 * window 34 minutes long. The Files viewer wrote both, every attempt, within
 * seconds. A 1 MB PDF and four images round-tripped through Preview in the
 * same session, so small files are unaffected.
 *
 * Bytes are a proxy. The failure tracks document weight, and page count
 * tracks that better, but page objects live in compressed object streams in
 * any modern PDF, so counting them needs a parser this plugin has no business
 * carrying. The threshold sits far below the smallest file known to fail
 * because the costs are lopsided: sending a small file through the Files
 * viewer costs two taps, and sending a heavy one to Preview costs the user's
 * handwriting. A small file with many pages is the known hole (ETCH.md, open
 * question 8).
 */
export const LARGE_FILE_BYTES = 4 * 1024 * 1024;

export interface RouteDecision {
	route: RouteId;
	/** True when the size override moved this handoff off the chosen route. */
	overridden: boolean;
}

/**
 * Picks the route before anything is attempted, from the size the witness
 * already needs. Not a fallback: nothing is retried, nothing is chained, and
 * one navigation fires per gesture (engineering rule 6).
 */
export function chooseRoute(selected: RouteId, sizeBytes: number): RouteDecision {
	if (selected === 'file' && sizeBytes >= LARGE_FILE_BYTES) {
		return { route: 'shareddocuments', overridden: true };
	}
	return { route: selected, overridden: false };
}

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

/**
 * Shown when the size override redirects a handoff. It has to explain a
 * viewer the user did not choose, and tell them how to save once they are
 * there, because the Files viewer needs a check-mark tap and Preview does not.
 */
export const LARGE_FILE_NOTICE =
	'Etch used the Files viewer for this large file, because Preview can lose markup on large PDFs. Tap Markup, then the check mark to save.';

export async function performHandoff(
	context: HandoffContext,
	file: TFile,
): Promise<void> {
	const { app, log } = context;

	const decision = chooseRoute(context.route, file.stat.size);
	const plan = await buildPlan(context, file, decision.route);
	if (!plan) return;

	if (decision.overridden) {
		new Notice(LARGE_FILE_NOTICE, 15000);
		await log.line(
			`size override: ${file.path} is ${file.stat.size} bytes, using ${decision.route} instead of ${context.route}`,
		);
	}

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
	await log.line(`route ${decision.route}: ${plan.description}`);

	plan.navigate();
}

async function buildPlan(
	context: HandoffContext,
	file: TFile,
	route: RouteId,
): Promise<HandoffPlan | null> {
	const { app, log } = context;

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
