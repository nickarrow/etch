import { Menu, Notice, Platform, Plugin, TFile } from 'obsidian';
import { EXPERIMENTS, Experiment, ExperimentContext } from './experiments';
import { SpikeLog, describeError } from './log';
import { resolvePathCandidates } from './native';
import { FileSnapshot, diffSnapshots, takeSnapshot, verdict } from './witness';

interface ArmedSnapshot {
	experimentId: string;
	snapshot: FileSnapshot;
}

interface SpikeData {
	armed: ArmedSnapshot | null;
}

const DEFAULT_DATA: SpikeData = { armed: null };

export default class HandwritingSpikePlugin extends Plugin {
	private log!: SpikeLog;
	private data: SpikeData = { ...DEFAULT_DATA };
	private erudaLoaded = false;
	private checkInFlight = false;

	async onload(): Promise<void> {
		this.log = new SpikeLog(this.app);
		const stored = (await this.loadData()) as Partial<SpikeData> | null;
		this.data = Object.assign({}, DEFAULT_DATA, stored ?? {});

		this.addRibbonIcon('flask-conical', 'PDF handoff spike', (evt) => {
			this.showMenu(evt);
		});

		for (const experiment of EXPERIMENTS) {
			this.addCommand({
				id: experiment.id,
				name: experiment.label,
				callback: () => {
					void this.runExperiment(experiment);
				},
			});
		}

		this.addCommand({
			id: 'e6-check-target-file',
			name: 'Experiment 6: check the target file for an in-place change',
			callback: () => {
				void this.checkArmedSnapshot('manual');
			},
		});

		this.addCommand({
			id: 'e6b-force-refresh-pdf-views',
			name: 'Experiment 6b: force-refresh open PDF views',
			callback: () => {
				void this.forceRefreshPdfViews();
			},
		});

		this.addCommand({
			id: 'e6c-force-refresh-image-embeds',
			name: 'Experiment 6c: force-refresh image embeds (cache-bust)',
			callback: () => {
				void this.forceRefreshImageEmbeds();
			},
		});

		this.addCommand({
			id: 'toggle-console',
			name: 'Toggle on-device console (eruda)',
			callback: () => {
				void this.toggleConsole();
			},
		});

		// The return leg. iOS may or may not tear down the webview when we come
		// back from another app, so listen for both a soft resume and a reload.
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				void this.checkArmedSnapshot('visibilitychange');
			}
		});
		this.registerDomEvent(window, 'focus', () => {
			void this.checkArmedSnapshot('window-focus');
		});

		// If the webview was reloaded while we were away, the armed snapshot is
		// still on disk, so an onload-time check catches that case.
		if (this.data.armed) {
			this.app.workspace.onLayoutReady(() => {
				void this.checkArmedSnapshot('plugin-load');
			});
		}
	}

	/* ---------------------------------------------------------------------- */

	private showMenu(evt: MouseEvent): void {
		const menu = new Menu();
		const target = this.resolveTarget();

		menu.addItem((item) =>
			item
				.setTitle(
					target
						? `Target: ${target.file.path} (${target.via})`
						: 'No PDF or image found in vault',
				)
				.setIcon('file-text')
				.setDisabled(true),
		);
		menu.addSeparator();

		for (const experiment of EXPERIMENTS) {
			menu.addItem((item) =>
				item
					.setTitle(experiment.label)
					.setIcon('play')
					.onClick(() => {
						void this.runExperiment(experiment);
					}),
			);
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle('Check target file for in-place change')
				.setIcon('search-check')
				.onClick(() => {
					void this.checkArmedSnapshot('manual');
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Force-refresh image embeds (e6c)')
				.setIcon('image')
				.onClick(() => {
					void this.forceRefreshImageEmbeds();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle('Toggle on-device console')
				.setIcon('terminal')
				.onClick(() => {
					void this.toggleConsole();
				}),
		);

		menu.showAtMouseEvent(evt);
	}

	/**
	 * Session-5 upgrade, production-relevant: when a note is active, the target
	 * comes from the note's own embeds (public metadataCache API) — the
	 * real-world flow is "looking at a note with an embedded sheet, tap". Order:
	 * active file if supported → first supported embed of the active note →
	 * first supported file in the vault. Extensions beyond PDF are deliberate:
	 * whether the handoff is type-agnostic (images) is itself under test.
	 */
	private static readonly SUPPORTED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg']);

	private resolveTarget(): { file: TFile; via: string } | null {
		const supported = HandwritingSpikePlugin.SUPPORTED_EXTENSIONS;
		const active = this.app.workspace.getActiveFile();
		if (active && supported.has(active.extension.toLowerCase())) {
			return { file: active, via: 'active file' };
		}
		if (active && active.extension.toLowerCase() === 'md') {
			const embeds = this.app.metadataCache.getFileCache(active)?.embeds ?? [];
			for (const embed of embeds) {
				const linkpath = embed.link.split('#')[0] ?? embed.link;
				const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, active.path);
				if (dest && supported.has(dest.extension.toLowerCase())) {
					return { file: dest, via: `first supported embed of ${active.path}` };
				}
			}
		}
		const first = this.app.vault
			.getFiles()
			.find((f) => supported.has(f.extension.toLowerCase()));
		return first ? { file: first, via: 'first supported file in vault' } : null;
	}

	private async runExperiment(experiment: Experiment): Promise<void> {
		const target = this.resolveTarget();
		if (!target) {
			new Notice('No PDF or image in this vault. Add one and try again.');
			return;
		}
		const { file, via } = target;

		await this.log.section(`${experiment.label} — target: ${file.path}`);
		await this.log.line(`target resolved via: ${via}`);
		await this.log.line(`tier: ${experiment.tier}`);
		await this.log.line(
			`platform: iosApp=${Platform.isIosApp} mobileApp=${Platform.isMobileApp} desktop=${Platform.isDesktopApp}`,
		);

		const paths = resolvePathCandidates(this.app, file);
		await this.log.line(`best path: ${paths.best ?? 'none'}`);

		const context: ExperimentContext = {
			app: this.app,
			log: this.log,
			file,
			fullPath: paths.best,
			paths,
			arm: (experimentId) => this.arm(experimentId, file),
		};

		try {
			await experiment.run(context);
		} catch (error) {
			await this.log.notice(`${experiment.id} failed -> ${describeError(error)}`, 12000);
			console.error(`[spike] ${experiment.id}`, error);
		}
	}

	/** Fingerprint the target and persist it before a possible app switch. */
	private async arm(experimentId: string, file: TFile): Promise<void> {
		try {
			const snapshot = await takeSnapshot(this.app, file.path);
			this.data.armed = { experimentId, snapshot };
			await this.saveData(this.data);
			await this.log.line(
				`armed: sha256=${snapshot.sha256.slice(0, 12)} size=${snapshot.size} mtime=${snapshot.mtime}`,
			);
		} catch (error) {
			await this.log.line(`arm failed -> ${describeError(error)} (result will be unverifiable)`);
		}
	}

	/**
	 * The whole spike reduces to this comparison: same path, different bytes.
	 */
	private async checkArmedSnapshot(trigger: string): Promise<void> {
		const armed = this.data.armed;
		if (!armed) {
			if (trigger === 'manual') new Notice('Nothing armed. Run an experiment first.');
			return;
		}
		if (this.checkInFlight) return;
		this.checkInFlight = true;

		try {
			const after = await takeSnapshot(this.app, armed.snapshot.path);
			const diff = diffSnapshots(armed.snapshot, after);
			const conclusion = verdict(diff);

			await this.log.section(`Return leg check (${trigger}) for ${armed.experimentId}`);
			await this.log.line(diff.summary);
			await this.log.notice(conclusion, 15000);

			if (diff.contentChanged) {
				// Secondary finding, worth capturing regardless of which experiment won:
				// does Obsidian notice on its own, or does the embed serve stale bytes?
				await this.log.line(
					'Now check the open PDF view WITHOUT reopening it. If it is stale, run Experiment 6b.',
				);
				this.data.armed = null;
				await this.saveData(this.data);
			} else if (trigger === 'manual') {
				await this.log.line('Snapshot left armed so you can re-check after annotating.');
			}
		} catch (error) {
			await this.log.notice(`return-leg check failed -> ${describeError(error)}`);
		} finally {
			this.checkInFlight = false;
		}
	}

	/**
	 * Even a perfect handoff feels broken if the embed shows stale content, so the
	 * refresh path is a finding in its own right. `rebuildView` is internal.
	 */
	private async forceRefreshPdfViews(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType('pdf');
		await this.log.line(`found ${leaves.length} leaf/leaves of type "pdf"`);

		let rebuilt = 0;
		for (const leaf of leaves) {
			const internal = leaf as unknown as { rebuildView?: () => void };
			if (typeof internal.rebuildView === 'function') {
				internal.rebuildView();
				rebuilt++;
			}
		}
		await this.log.notice(
			rebuilt > 0
				? `Rebuilt ${rebuilt} PDF view(s) via internal rebuildView().`
				: 'No PDF leaves exposed rebuildView(). Refresh path needs another approach.',
		);
	}

	/**
	 * e6c: the image counterpart to e6b. Session-5 finding: image embeds render
	 * by URL through the webview, and on mobile `getResourcePath()` carries no
	 * cache-busting query — so Obsidian serves a stale cached bitmap until the
	 * webview dies (full app restart). This bumps every currently rendered vault
	 * image src with a throwaway query param. Fresh pixels without a restart
	 * proves the production fix direction. Note the deliberate limitation: only
	 * *rendered* imgs are bumped; an embed rendered later reuses the unqueried
	 * URL and will still be stale — whether that happens is itself a finding.
	 */
	private async forceRefreshImageEmbeds(): Promise<void> {
		const images = Array.from(document.querySelectorAll('img'));
		const vaultImages = images.filter((img) => img.src.includes('_capacitor_file_'));
		const distinct = new Set(vaultImages.map((img) => img.src.split('?')[0] ?? img.src));

		await this.log.section('Experiment 6c: force-refresh image embeds (cache-bust)');
		await this.log.line(
			`img elements: ${images.length} total, ${vaultImages.length} vault-backed, ` +
				`${distinct.size} distinct file(s)`,
		);

		const stamp = Date.now();
		for (const img of vaultImages) {
			const base = img.src.split('?')[0] ?? img.src;
			img.src = `${base}?spike=${stamp}`;
		}

		await this.log.line(`bumped ${vaultImages.length} img src(s) with ?spike=${stamp}`);
		await this.log.notice(
			vaultImages.length > 0
				? `Cache-busted ${vaultImages.length} image(s). Are the pixels fresh now?`
				: 'No vault-backed images are currently rendered. Open the note or image first.',
		);
	}

	/**
	 * A real console on the iPad. Web Inspector is better when a Mac is attached,
	 * but exception details are the actual findings here and we cannot afford to
	 * lose them when testing untethered.
	 */
	private async toggleConsole(): Promise<void> {
		try {
			if (!this.erudaLoaded) {
				const eruda = (await import('eruda')).default;
				eruda.init();
				this.erudaLoaded = true;
				new Notice('On-device console loaded.');
				return;
			}
			const eruda = (await import('eruda')).default;
			eruda.destroy();
			this.erudaLoaded = false;
			new Notice('On-device console removed.');
		} catch (error) {
			new Notice(`Console failed to load: ${describeError(error)}`);
		}
	}
}
