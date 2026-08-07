import { App, Notice, TFile } from 'obsidian';
import { EtchLog } from './log';
import { getNativePath, getOpenWithDefaultApp } from './native';
import { resolveAbsolutePath } from './resolve';
import { armWitnessRecord, WitnessRecord } from './witness';

/**
 * The three handoff routes. Selection is a setting, there is no automatic
 * fallback between routes, and a handoff fires exactly one navigation.
 */
export type RouteId = 'file' | 'shareddocuments' | 'share-sheet';

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

	// Arm the witness and persist it before navigating: a successful handoff
	// backgrounds Obsidian and may tear down the webview.
	let record: WitnessRecord;
	try {
		record = await armWitnessRecord(app, file.path);
	} catch (error) {
		new Notice('Could not read the file to arm verification. No handoff was made.');
		await log.error(`witness arm failed for ${file.path}`, error);
		return;
	}
	await context.arm(record);
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

	if (route === 'share-sheet') {
		// Takes the vault-relative path; a resolver failure never blocks it.
		const openWithDefaultApp = getOpenWithDefaultApp(app);
		if (!openWithDefaultApp) {
			new Notice(
				'The share sheet is not reachable in this version of Obsidian. No handoff was made.',
			);
			await log.error('openWithDefaultApp is not reachable');
			return null;
		}
		return {
			description: `openWithDefaultApp("${file.path}")`,
			navigate: () => {
				openWithDefaultApp(file.path);
			},
		};
	}

	const resolved = resolveAbsolutePath(app, file);
	if (!resolved.ok) {
		new Notice(resolved.message);
		await log.error(
			`path resolution failed (${resolved.failure}) for ${file.path}`,
		);
		return null;
	}
	if (log.isEnabled()) {
		await log.line(`resolved ${file.path} -> ${resolved.absolutePath}`);
		await log.line(
			`getNativePath cross-check: ${getNativePath(app, file.path) ?? 'unavailable'}`,
		);
	}

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
