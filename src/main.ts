import {
	FileView,
	Notice,
	Platform,
	Plugin,
	TFile,
	normalizePath,
} from 'obsidian';
import { EtchLog, describeError } from './log';
import { isRouteId, performHandoff } from './routes';
import { DEFAULT_SETTINGS, EtchSettings, EtchSettingTab } from './settings';
import {
	WitnessRecord,
	WitnessReport,
	checkWitnessRecord,
	isWitnessRecord,
} from './witness';

interface EtchData {
	settings: EtchSettings;
	witness: WitnessRecord | null;
}

const MARK_UP_NAME = 'Mark up with Pencil';
const MARK_UP_ICON = 'pencil';
const PDF_VIEW_TYPE = 'pdf';
const VIEW_ACTION_CLASS = 'etch-view-action';
const RECHECK_DELAY_MS = 3000;

function isIpad(): boolean {
	return Platform.isIosApp && Platform.isTablet;
}

export default class EtchPlugin extends Plugin {
	settings!: EtchSettings;
	log!: EtchLog;
	private witnessRecord: WitnessRecord | null = null;
	private rejectedRoute: string | null = null;
	private rejectedWitness = false;
	/** Serializes plugin-data writes; saveData replaces the whole file. */
	private saveQueue: Promise<void> = Promise.resolve();

	async onload() {
		await this.loadPluginData();

		const pluginDir =
			this.manifest.dir ??
			[this.app.vault.configDir, 'plugins', this.manifest.id].join('/');
		this.log = new EtchLog(
			this.app,
			normalizePath(`${pluginDir}/etch-debug.md`),
			() => {
				new Notice(
					'Etch could not write its debug log, so the log is incomplete.',
					10000,
				);
			},
		);
		this.log.setEnabled(this.settings.debugLogging);

		this.addSettingTab(new EtchSettingTab(this.app, this));

		this.addCommand({
			id: 'mark-up',
			name: MARK_UP_NAME,
			icon: MARK_UP_ICON,
			checkCallback: (checking) => {
				if (!isIpad()) return false;
				const file = this.activePdf();
				if (!file) return false;
				if (!checking) void this.markUp(file);
				return true;
			},
		});

		this.addCommand({
			id: 'verify-last-handoff',
			name: 'Verify last handoff',
			checkCallback: (checking) => {
				if (!isIpad() || !this.settings.debugLogging) return false;
				if (!checking) void this.verifyLastHandoff('manual');
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (
					!isIpad() ||
					!(file instanceof TFile) ||
					file.extension.toLowerCase() !== 'pdf'
				) {
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle(MARK_UP_NAME)
						.setIcon(MARK_UP_ICON)
						.setSection('open')
						.onClick(() => {
							void this.markUp(file);
						}),
				);
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.ensurePdfViewActions();
			}),
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.ensurePdfViewActions();
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			this.ensurePdfViewActions();
		});

		// Deferred so onload does no I/O of its own (engineering rule 10).
		if (this.rejectedRoute !== null || this.rejectedWitness) {
			const rejectedRoute = this.rejectedRoute;
			const rejectedWitness = this.rejectedWitness;
			this.app.workspace.onLayoutReady(() => {
				if (rejectedRoute !== null) {
					void this.log.line(
						`stored route ${rejectedRoute} is not a known route; using ${this.settings.route}`,
					);
				}
				if (rejectedWitness) {
					void this.log.line(
						'stored witness record has an unexpected shape; discarded',
					);
				}
			});
		}

		// Webview-teardown recovery: if a handoff is still armed from a
		// previous session, check it once the workspace is ready.
		if (this.witnessRecord) {
			this.app.workspace.onLayoutReady(() => {
				void this.verifyLastHandoff('automatic');
			});
		}
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(PDF_VIEW_TYPE)) {
			for (const el of Array.from(
				leaf.view.containerEl.querySelectorAll(`.${VIEW_ACTION_CLASS}`),
			)) {
				el.remove();
			}
		}
	}

	/**
	 * One pencil action per open PDF view, each bound to its own view's
	 * file. Presence is checked in the DOM, so a rebuilt header heals itself
	 * on the next workspace event. The click closure holds its view and
	 * reads `view.file` at click time, so a file swap inside the same view
	 * is handled; the element dies with the view, so the lifetimes match.
	 */
	private ensurePdfViewActions(): void {
		if (!isIpad()) return;
		for (const leaf of this.app.workspace.getLeavesOfType(PDF_VIEW_TYPE)) {
			const view = leaf.view;
			if (!(view instanceof FileView)) continue;
			if (view.containerEl.querySelector(`.${VIEW_ACTION_CLASS}`)) continue;
			const actionEl = view.addAction(MARK_UP_ICON, MARK_UP_NAME, () => {
				if (view.file) void this.markUp(view.file);
			});
			actionEl.addClass(VIEW_ACTION_CLASS);
			// Obsidian labels its own header actions; setting it here makes
			// the accessible name this plugin's responsibility, not an
			// assumption about Obsidian's internals (engineering rule 10).
			actionEl.setAttribute('aria-label', MARK_UP_NAME);
		}
	}

	private activePdf(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension.toLowerCase() !== 'pdf') return null;
		return file;
	}

	private async markUp(file: TFile): Promise<void> {
		await performHandoff(
			{
				app: this.app,
				log: this.log,
				route: this.settings.route,
				arm: async (record) => {
					this.witnessRecord = record;
					await this.savePluginData();
				},
			},
			file,
		);
	}

	/**
	 * The manual command may be rerun freely and the latest result
	 * supersedes; it never clears the record. The automatic startup check
	 * reports at most once, absorbs Preview's save timing with one delayed
	 * re-read, and then clears the record, including when the check failed:
	 * a record that never cleared would repeat on every launch, and neither
	 * a missing file nor a check that throws can resolve itself. The one
	 * exception is an unload mid-recheck, which leaves the record armed so
	 * the next launch can try again.
	 */
	private async verifyLastHandoff(mode: 'manual' | 'automatic'): Promise<void> {
		const record = this.witnessRecord;
		if (!record) {
			if (mode === 'manual') new Notice('No armed handoff to verify.');
			return;
		}
		await this.logArmed(mode, record);
		try {
			let report = await checkWitnessRecord(this.app, record);
			let label = 'first read';
			if (mode === 'automatic' && report.outcome === 'unchanged') {
				// On the teardown-relaunch path the first read can precede
				// Preview's write by under a second.
				await this.logResult(mode, label, record, report);
				const recheck = await this.recheckAfterDelay(record);
				if (!recheck) {
					// Unloaded while waiting. Leave the record armed.
					await this.log.line(`verify (${mode}) recheck abandoned on unload`);
					return;
				}
				report = recheck;
				label = 'recheck';
			}
			await this.logResult(mode, label, record, report);
			if (mode === 'manual') {
				new Notice(report.summary, 10000);
				return;
			}
			if (report.outcome === 'changed') {
				new Notice(report.summary, 10000);
			}
			await this.clearWitness(record);
		} catch (error) {
			await this.log.error(`verify failed for ${record.vaultPath}`, error);
			if (mode === 'manual') {
				new Notice('Verify failed; see the console or debug log.');
			} else {
				// Nothing about this check can succeed on a later launch.
				await this.clearWitness(record);
			}
		}
	}

	/**
	 * Identity guard: a handoff armed while a check was in flight must not be
	 * wiped by that check.
	 */
	private async clearWitness(record: WitnessRecord): Promise<void> {
		if (this.witnessRecord !== record) return;
		this.witnessRecord = null;
		await this.savePluginData();
	}

	private logArmed(
		mode: 'manual' | 'automatic',
		record: WitnessRecord,
	): Promise<void> {
		return this.log.line(
			`verify (${mode}) ${record.vaultPath}: armed size=${record.size} mtime=${record.mtime} sha256=${record.sha256} armedAt=${new Date(record.armedAt).toISOString()}`,
		);
	}

	private async logResult(
		mode: 'manual' | 'automatic',
		label: string,
		record: WitnessRecord,
		report: WitnessReport,
	): Promise<void> {
		if (report.after) {
			await this.log.line(
				`verify (${mode}, ${label}) ${record.vaultPath}: current size=${report.after.size} mtime=${report.after.mtime} sha256=${report.after.sha256}`,
			);
		}
		await this.log.line(
			`verify (${mode}, ${label}) outcome: ${report.outcome}`,
		);
	}

	/**
	 * Resolves null if the plugin unloads before the delay elapses. Owning
	 * the timer here, rather than handing a timeout id to registerInterval,
	 * is what guarantees the promise always settles: a cancelled timer would
	 * otherwise leave the caller suspended for the life of the webview,
	 * holding this plugin instance with it.
	 */
	private recheckAfterDelay(
		record: WitnessRecord,
	): Promise<WitnessReport | null> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timer = window.setTimeout(() => {
				settled = true;
				checkWitnessRecord(this.app, record).then(resolve, reject);
			}, RECHECK_DELAY_MS);
			this.register(() => {
				if (settled) return;
				window.clearTimeout(timer);
				resolve(null);
			});
		});
	}

	async saveSettings(): Promise<void> {
		await this.savePluginData();
	}

	/**
	 * data.json is hand-editable, syncs between devices, and can come from a
	 * newer or older build, so every field is rebuilt from it rather than
	 * spread over the defaults. A route this build does not know falls back
	 * to the default; a malformed witness record is dropped rather than
	 * carried into a check that would fail on every launch.
	 */
	private async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<EtchData> | null;
		const stored: unknown = raw?.settings;
		const storedSettings = (stored ?? {}) as Record<string, unknown>;

		const storedRoute = storedSettings.route;
		const knownRoute = isRouteId(storedRoute);
		if (storedRoute !== undefined && !knownRoute) {
			this.rejectedRoute = describeError(storedRoute);
		}
		this.settings = {
			route: knownRoute ? storedRoute : DEFAULT_SETTINGS.route,
			debugLogging: storedSettings.debugLogging === true,
		};

		this.witnessRecord = isWitnessRecord(raw?.witness) ? raw.witness : null;
		if (raw?.witness != null && !this.witnessRecord) {
			this.rejectedWitness = true;
		}
	}

	/**
	 * saveData replaces the whole file, so concurrent callers could otherwise
	 * land out of order and persist a stale snapshot over a fresh one.
	 */
	private savePluginData(): Promise<void> {
		// The snapshot is taken when the write runs, not when it is queued,
		// so the file always ends up matching the latest in-memory state.
		const done = this.saveQueue.then(() => {
			const data: EtchData = {
				settings: this.settings,
				witness: this.witnessRecord,
			};
			return this.saveData(data);
		});
		// The chain survives a failed write; the caller still sees it, which
		// is what lets a failed arm fall back to a handoff without a witness.
		this.saveQueue = done.catch(() => {});
		return done;
	}
}
