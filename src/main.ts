import { Notice, Platform, Plugin, TFile, normalizePath } from 'obsidian';
import { ViewActions } from './actions';
import { isMarkupFile } from './formats';
import { EtchLog, describeError } from './log';
import { ImageRefresh } from './refresh';
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
const RECHECK_DELAY_MS = 3000;

function isIpad(): boolean {
	return Platform.isIosApp && Platform.isTablet;
}

export default class EtchPlugin extends Plugin {
	settings!: EtchSettings;
	log!: EtchLog;
	private viewActions!: ViewActions;
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
				const file = this.activeMarkupFile();
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
				if (!isIpad() || !(file instanceof TFile) || !isMarkupFile(file)) {
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

		this.viewActions = new ViewActions(
			this.app,
			MARK_UP_ICON,
			MARK_UP_NAME,
			(file) => {
				void this.markUp(file);
			},
		);
		this.register(() => {
			this.viewActions.dispose();
		});
		const syncViewActions = () => {
			if (isIpad()) this.viewActions.sync();
		};
		this.registerEvent(this.app.workspace.on('layout-change', syncViewActions));
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', syncViewActions),
		);
		// An image view is reused for the next image opened in it, so the
		// action has to be reconsidered when the file changes, not only when
		// the layout does.
		this.registerEvent(this.app.workspace.on('file-open', syncViewActions));
		this.app.workspace.onLayoutReady(syncViewActions);

		this.registerImageRefresh();

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

	/**
	 * PDF views refresh themselves after an external write; images do not, and
	 * the fix has to sit in the render paths rather than run once per handoff
	 * (spike session 6). Registration only, with the observer started from
	 * onLayoutReady so onload still does no DOM work of its own.
	 */
	private registerImageRefresh(): void {
		if (!isIpad()) return;
		const refresh = new ImageRefresh(this.app, this.log);
		this.register(() => {
			refresh.dispose();
		});
		this.registerMarkdownPostProcessor((el) => {
			refresh.applyTo(el);
		});
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) refresh.fileModified(file);
			}),
		);
		this.app.workspace.onLayoutReady(() => {
			refresh.startObserving(this.app.workspace.containerEl);
		});
	}

	private activeMarkupFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file || !isMarkupFile(file)) return null;
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
