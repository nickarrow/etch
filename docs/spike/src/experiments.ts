import { App, TFile } from 'obsidian';
import { SpikeLog, describeError, safeStringify } from './log';
import {
	PathCandidates,
	describeEnvironment,
	getCapacitorAppOpenUrl,
	getCapacitorShare,
	getCommands,
	getOpenWithDefaultApp,
	harvestFileMenu,
	listCapacitorPlugins,
	listCommandIds,
	toFileUrl,
	toSharedDocumentsUrl,
} from './native';

export interface ExperimentContext {
	app: App;
	log: SpikeLog;
	file: TFile;
	/** Best absolute on-disk path for the target (`paths.best`), or null. */
	fullPath: string | null;
	/** Every path candidate the adapter yielded, for the probe dump. */
	paths: PathCandidates;
	/**
	 * Fingerprint the target file and persist the snapshot, so the check that
	 * runs when we come back from another app has something to compare against.
	 * Must be awaited before any attempt that could background Obsidian.
	 */
	arm: (experimentId: string) => Promise<void>;
}

export interface Experiment {
	id: string;
	label: string;
	/** What a positive result would prove, in the tiering from the spike plan. */
	tier: string;
	run: (ctx: ExperimentContext) => Promise<void>;
}

/* -------------------------------------------------------------------------- */

const probe: Experiment = {
	id: 'probe',
	label: 'Probe: dump environment + API surface',
	tier: 'Research. Establishes what is even reachable before anything is attempted.',
	async run({ app, log, file, fullPath, paths }) {
		await log.block('environment', describeEnvironment(app));
		await log.block('target file', {
			vaultPath: file.path,
			name: file.name,
			extension: file.extension,
			pathCandidates: paths,
			fileUrl: fullPath ? toFileUrl(fullPath) : null,
			sharedDocumentsUrl: fullPath ? toSharedDocumentsUrl(fullPath, true) : null,
			resourcePath: app.vault.getResourcePath(file),
		});

		if (!fullPath) {
			await log.notice('No usable path at all - Experiments 3 and 5 cannot run.');
		} else if (!fullPath.startsWith('/')) {
			await log.notice(
				'WARNING: best path is not absolute - scheme URLs built from it point at a ' +
					'nonexistent root path. Do not run e3/e5 until this is resolved.',
			);
		}
	},
};

/**
 * Highest-value probe in the spike. Capacitor's iOS Share plugin takes `files`
 * as an array of file:// URL *strings* and hands them to UIActivityViewController
 * as URLs, not as bytes. That is the only shape that can produce an in-place
 * edit. If Obsidian's bundle includes this plugin, we get the target UX with no
 * interim step and no bundled native code of our own.
 */
const capacitorShare: Experiment = {
	id: 'e1a-capacitor-share',
	label: 'Experiment 1a: Capacitor Share with a file URL',
	tier: 'Tier 3 candidate. Passes a URL, so in-place is structurally possible.',
	async run({ log, file, fullPath, arm }) {
		const share = getCapacitorShare();
		if (!share) {
			await log.block('Capacitor plugins present', listCapacitorPlugins());
			await log.notice(
				'NEGATIVE: Capacitor Share plugin is not exposed to the webview. See log for the plugin list.',
			);
			return;
		}

		if (share.canShare) {
			try {
				await log.line(`Share.canShare() -> ${safeStringify(await share.canShare())}`);
			} catch (error) {
				await log.line(`Share.canShare() threw -> ${describeError(error)}`);
			}
		}

		if (!fullPath) {
			await log.notice('Cannot run: no full path available for the target file.');
			return;
		}
		const fileUrl = toFileUrl(fullPath);
		await log.line(`sharing files: ["${fileUrl}"]`);
		await arm(capacitorShare.id);

		// Attempt A: `files`, which is the URL-passing shape we actually want.
		try {
			const result = await share.share({
				title: file.name,
				files: [fileUrl],
				dialogTitle: 'Open PDF in…',
			});
			await log.notice(`Share.share({files}) resolved -> ${safeStringify(result)}`);
			return;
		} catch (error) {
			await log.line(`Share.share({files}) threw -> ${describeError(error)}`);
		}

		// Attempt B: `url`. Some versions route a file URL through this instead.
		try {
			const result = await share.share({ title: file.name, url: fileUrl });
			await log.notice(`Share.share({url}) resolved -> ${safeStringify(result)}`);
		} catch (error) {
			await log.notice(`Share.share({url}) also threw -> ${describeError(error)}`);
		}
	},
};

/**
 * Obsidian's mobile Share action lives in the file context menu, not the command
 * palette. Synthesising the `file-menu` event and reading back the registered
 * items lets us find and invoke the *exact* callback the known-working manual
 * baseline uses, rather than reinventing it.
 */
const fileMenuShare: Experiment = {
	id: 'e1b-file-menu-share',
	label: 'Experiment 1b: harvest and invoke the file-menu Share item',
	tier: 'Tier 3 candidate. Reuses Obsidian\'s own proven plumbing. Private API.',
	async run({ app, log, file, arm }) {
		// Obsidian varies which items it adds based on the menu source string.
		const sources = [
			'file-explorer-context-menu',
			'more-options',
			'pane-more-options',
			'file-explorer',
			'tab-header',
			'link-context-menu',
		];

		const found: Record<string, string[]> = {};
		let candidate: { source: string; title: string; invoke: () => void } | null = null;

		for (const source of sources) {
			try {
				const items = harvestFileMenu(app, file, source);
				found[source] = items.map((i) => i.title);
				if (candidate) continue;
				const match = items.find(
					(i) => i.invoke !== null && /share|open in|export|system/i.test(i.title),
				);
				if (match?.invoke) {
					candidate = { source, title: match.title, invoke: match.invoke };
				}
			} catch (error) {
				found[source] = [`threw: ${describeError(error)}`];
			}
		}

		await log.block('file-menu items by source', found);

		if (!candidate) {
			await log.notice(
				'NEGATIVE: no share-shaped file-menu item found. Obsidian likely adds Share natively, outside the JS menu.',
			);
			return;
		}

		await log.line(`invoking "${candidate.title}" from source "${candidate.source}"`);
		await arm(fileMenuShare.id);
		try {
			candidate.invoke();
			await log.notice(`Invoked "${candidate.title}" - watch for a share sheet.`);
		} catch (error) {
			await log.notice(`Invoke threw -> ${describeError(error)}`);
		}
	},
};

/**
 * Born from e1c's session-2 find: core command `open-with-default-app:open` is
 * titled "Share" on iOS. Invoking the command (rather than calling
 * openWithDefaultApp directly, as e4 does) lets Obsidian pick its own arguments
 * and presentation path - a distinct data point if the two behave differently.
 */
const shareCommand: Experiment = {
	id: 'e1d-share-command',
	label: 'Experiment 1d: invoke core command open-with-default-app:open (mobile "Share")',
	tier: 'Tier 3 candidate. Same plumbing as e4, through Obsidian\'s own command path. Private API.',
	async run({ app, log, file, arm }) {
		const commands = getCommands(app);
		if (!commands || typeof commands.executeCommandById !== 'function') {
			await log.notice('NEGATIVE: app.commands.executeCommandById is not reachable.');
			return;
		}
		const active = app.workspace.getActiveFile();
		await log.line(`active file: ${active?.path ?? 'none'} (the command acts on the active file)`);
		if (active?.path !== file.path) {
			await log.notice('Open the target PDF first - this command acts on the active file.');
			return;
		}
		await arm(shareCommand.id);
		try {
			const result = commands.executeCommandById('open-with-default-app:open');
			await log.line(`executeCommandById("open-with-default-app:open") -> ${String(result)}`);
		} catch (error) {
			await log.notice(`executeCommandById threw -> ${describeError(error)}`);
			return;
		}
		await log.notice('If a share sheet is up: pick Preview, annotate, return.');
	},
};

/** Read-only reconnaissance: no side effects, safe to run any time. */
const commandScan: Experiment = {
	id: 'e1c-command-scan',
	label: 'Experiment 1c: scan the command registry (read-only)',
	tier: 'Research. Looks for an internal command worth invoking by hand.',
	async run({ app, log }) {
		const commands = listCommandIds(app);
		if (commands.length === 0) {
			await log.notice('NEGATIVE: app.commands is not reachable.');
			return;
		}
		const interesting = commands
			.filter((c) => /share|open|external|system|default app|reveal|export/i.test(`${c.id} ${c.name}`))
			.map((c) => `${c.id}  ::  ${c.name}`)
			.sort();

		await log.block(`share/open-shaped commands (${interesting.length})`, interesting.join('\n'));
		await log.block(
			`all command ids (${commands.length})`,
			commands.map((c) => c.id).sort().join('\n'),
		);
		await log.notice(`Scanned ${commands.length} commands, ${interesting.length} look relevant.`);
	},
};

/**
 * Demoted deliberately. `navigator.share` only accepts `File` objects, and a
 * `File` is bytes read into webview memory. There is no way to construct one
 * from a path. So this cannot produce an in-place edit no matter what happens -
 * it is useful only to confirm Preview appears as a share target at all.
 */
const webShare: Experiment = {
	id: 'e2-web-share',
	label: 'Experiment 2: Web Share API (target availability only)',
	tier: 'Tier 2 ceiling by construction. Shares bytes, so Preview gets a copy.',
	async run({ app, log, file, arm }) {
		if (typeof navigator.share !== 'function') {
			await log.notice('NEGATIVE: navigator.share is not available.');
			return;
		}

		const bytes = await app.vault.readBinary(file);
		const payload = new File([bytes], file.name, { type: 'application/pdf' });
		await log.line(`built in-memory File: ${payload.size} bytes`);

		if (typeof navigator.canShare === 'function') {
			await log.line(`navigator.canShare({files}) -> ${navigator.canShare({ files: [payload] })}`);
		}

		await arm(webShare.id);
		try {
			await navigator.share({ files: [payload], title: file.name });
			await log.notice('navigator.share resolved. Note: Preview received a COPY, by construction.');
		} catch (error) {
			await log.notice(`navigator.share threw -> ${describeError(error)}`);
		}
	},
};

/**
 * Scheme probes. Each variant is its own experiment because a *successful* probe
 * backgrounds Obsidian, which would prevent any later attempt in the same run
 * from being observed.
 */
function schemeProbe(
	id: string,
	label: string,
	tier: string,
	buildUrl: (fullPath: string) => string,
	navigate: (url: string) => void,
): Experiment {
	return {
		id,
		label,
		tier,
		async run({ log, fullPath, arm }) {
			if (!fullPath) {
				await log.notice('Cannot run: no full path available.');
				return;
			}
			const url = buildUrl(fullPath);
			await log.line(`navigating to: ${url}`);
			// Flush before navigating: if this works, we lose the console.
			await arm(id);
			try {
				navigate(url);
				await log.line('navigation call returned without throwing (inconclusive on its own)');
			} catch (error) {
				await log.notice(`navigation threw -> ${describeError(error)}`);
			}
		},
	};
}

const sharedDocsRaw = schemeProbe(
	'e3a-shareddocuments-raw',
	'Experiment 3a: shareddocuments:// (raw path)',
	'Tier 1 candidate. Opening Files at the right folder is shippable on its own.',
	(p) => toSharedDocumentsUrl(p, false),
	(url) => {
		window.location.href = url;
	},
);

const sharedDocsEncoded = schemeProbe(
	'e3b-shareddocuments-encoded',
	'Experiment 3b: shareddocuments:// (percent-encoded path)',
	'Tier 1 candidate. Same as 3a; encoding matters when the path has spaces.',
	(p) => toSharedDocumentsUrl(p, true),
	(url) => {
		window.location.href = url;
	},
);

const sharedDocsAnchor = schemeProbe(
	'e3c-shareddocuments-anchor',
	'Experiment 3c: shareddocuments:// via synthetic anchor click',
	'Tier 1 candidate. Different mechanism: some schemes need a user-gesture path.',
	(p) => toSharedDocumentsUrl(p, true),
	(url) => {
		const anchor = document.body.createEl('a', { href: url, attr: { rel: 'noopener' } });
		anchor.click();
		anchor.remove();
	},
);

const fileUrlProbe = schemeProbe(
	'e3d-file-url',
	'Experiment 3d: window.open on a raw file:// URL',
	'Expected negative. Recorded because a negative is a real finding.',
	(p) => toFileUrl(p),
	(url) => {
		window.open(url, '_blank');
	},
);

/**
 * Same target URL as 3b, different mechanism: the URL crosses the Capacitor
 * bridge and is opened by native code (`UIApplication.open`), so WKWebView's
 * navigation policy never sees it. Probe evidence says the App plugin is
 * registered; whether the native side implements `openUrl` is what this
 * measures. A clean rejection is a real finding, not a failure.
 */
const appOpenUrl: Experiment = {
	id: 'e3e-app-openurl',
	label: 'Experiment 3e: shareddocuments:// via Capacitor App.openUrl (native bridge)',
	tier: 'Tier 1 candidate. Bypasses webview navigation policy - if the bridge method exists.',
	async run({ log, fullPath, arm }) {
		const openUrl = getCapacitorAppOpenUrl();
		if (!openUrl) {
			await log.notice('NEGATIVE: App.openUrl is not exposed on the Capacitor App plugin proxy.');
			return;
		}
		if (!fullPath) {
			await log.notice('Cannot run: no full path available.');
			return;
		}
		const url = toSharedDocumentsUrl(fullPath, true);
		await log.line(`App.openUrl: ${url}`);
		await arm(appOpenUrl.id);
		try {
			const result = await openUrl({ url });
			await log.notice(`App.openUrl resolved -> ${safeStringify(result)}`);
		} catch (error) {
			await log.notice(`App.openUrl rejected -> ${describeError(error)}`);
		}
	},
};

/**
 * Session-2 upgrade: not a desktop-only sanity check after all. It exists at
 * runtime on iOS, and e1c shows core command `open-with-default-app:open` is
 * titled "Share" there - this IS Obsidian mobile's Share plumbing. Session 2
 * also showed why one call per run matters: looping two calls queued two share
 * sheets and made the result uninterpretable. Single call, vault path (what the
 * core command itself operates on).
 */
const defaultApp: Experiment = {
	id: 'e4-open-with-default-app',
	label: 'Experiment 4: openWithDefaultApp (share sheet, single call)',
	tier: 'Tier 3 candidate via the native share sheet - if its Preview target works.',
	async run({ app, log, file, arm }) {
		const fn = getOpenWithDefaultApp(app);
		if (!fn) {
			await log.notice('NEGATIVE: app.openWithDefaultApp does not exist here.');
			return;
		}
		await arm(defaultApp.id);
		try {
			const result = fn(file.path);
			await log.line(`openWithDefaultApp("${file.path}") -> ${safeStringify(result)}`);
		} catch (error) {
			await log.line(`openWithDefaultApp("${file.path}") threw -> ${describeError(error)}`);
		}
		await log.notice('Share sheet should be up. Pick Preview, annotate, return.');
	},
};

/**
 * Fallback only. Shortcuts has first-class Files actions that operate on real
 * file references, so it can plausibly reach Tier 3 - but it costs a one-time
 * user setup and a visible bounce through the Shortcuts app. Precedent that the
 * trigger works from plugin code: MacStories' Obsidian Shortcut Launcher.
 */
export const SHORTCUT_NAME = 'Obsidian Markup PDF';

const shortcuts: Experiment = {
	id: 'e5-shortcuts',
	label: 'Experiment 5: hand off via the Shortcuts URL scheme',
	tier: 'Tier 3 candidate, with a one-time setup cost and a visible app bounce.',
	async run({ log, file, fullPath, arm }) {
		// Pass both the vault-relative path and the absolute path: which one the
		// shortcut can act on is part of what we are trying to learn.
		const input = fullPath ?? file.path;
		const url =
			`shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}` +
			`&input=text&text=${encodeURIComponent(input)}`;

		await log.line(`shortcut input: ${input}`);
		await log.line(`navigating to: ${url}`);
		await arm(shortcuts.id);
		try {
			window.location.href = url;
			await log.line('navigation call returned without throwing');
		} catch (error) {
			await log.notice(`Shortcuts navigation threw -> ${describeError(error)}`);
		}
	},
};

export const EXPERIMENTS: Experiment[] = [
	probe,
	capacitorShare,
	fileMenuShare,
	commandScan,
	shareCommand,
	webShare,
	sharedDocsRaw,
	sharedDocsEncoded,
	sharedDocsAnchor,
	fileUrlProbe,
	appOpenUrl,
	defaultApp,
	shortcuts,
];
