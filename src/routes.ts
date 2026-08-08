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

export async function performHandoff(
	context: HandoffContext,
	file: TFile,
): Promise<void> {
	const { app, log, route } = context;

	const plan = await buildPlan(context, file);
	if (!plan) return;

	// Arm and persist the witness before the navigation fires; the webview
	// may not survive the trip.
	let record: WitnessRecord;
	try {
		record = await armWitnessRecord(app, file.path);
		await context.arm(record);
	} catch (error) {
		new Notice(
			'Could not record the handoff for verification. No handoff was made.',
		);
		await log.error(`witness arm failed for ${file.path}`, error);
		return;
	}
	await log.line(
		`witness armed: ${record.vaultPath} size=${record.size} mtime=${record.mtime} sha256=${record.sha256}`,
	);
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

	const encodedPath = encodePathSegments(resolved.absolutePath);
	if (route === 'file') {
		const url = `file://${encodedPath}`;
		return {
			description: `window.open("${url}")`,
			navigate: () => {
				window.open(url);
			},
		};
	}
	const url = `shareddocuments://${encodedPath}`;
	return {
		description: `window.location.href = "${url}"`,
		navigate: () => {
			window.location.href = url;
		},
	};
}
