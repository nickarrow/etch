import {
	FileView,
	Notice,
	Platform,
	Plugin,
	TFile,
	normalizePath,
} from 'obsidian';
import { EtchLog } from './log';
import { isRouteId, performHandoff } from './routes';
import { DEFAULT_SETTINGS, EtchSettings, EtchSettingTab } from './settings';
import {
	WitnessRecord,
	WitnessReport,
	checkWitnessRecord,
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

	async onload() {
		await this.loadPluginData();

		const pluginDir =
			this.manifest.dir ??
			[this.app.vault.configDir, 'plugins', this.manifest.id].join('/');
		this.log = new EtchLog(
			this.app,
			normalizePath(`${pluginDir}/etch-debug.md`),
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
	 * file. Presence is checked in the DOM rather than tracked, so a
	 * rebuilt header heals itself on the next workspace event and no view
	 * references are retained.
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
	 * re-read, and clears the record whatever the outcome. A record that
	 * never cleared would repeat its notice on every launch, and a missing
	 * or unchanged file cannot resolve itself.
	 */
	private async verifyLastHandoff(mode: 'manual' | 'automatic'): Promise<void> {
		const record = this.witnessRecord;
		if (!record) {
			if (mode === 'manual') new Notice('No armed handoff to verify.');
			return;
		}
		try {
			let report = await checkWitnessRecord(this.app, record);
			if (mode === 'automatic' && report.outcome === 'unchanged') {
				// On the teardown-relaunch path the first read can precede
				// Preview's write by under a second.
				await this.logVerify(mode, record, report);
				report = await this.recheckAfterDelay(record);
			}
			await this.logVerify(mode, record, report);
			if (mode === 'manual') {
				new Notice(report.summary, 10000);
				return;
			}
			if (report.outcome === 'changed') {
				new Notice(report.summary, 10000);
			}
			// Identity guard: a handoff armed while this check was in
			// flight must not be wiped by it.
			if (this.witnessRecord === record) {
				this.witnessRecord = null;
				await this.savePluginData();
			}
		} catch (error) {
			await this.log.error(`verify failed for ${record.vaultPath}`, error);
			if (mode === 'manual') {
				new Notice('Verify failed; see the console or debug log.');
			}
		}
	}

	private async logVerify(
		mode: 'manual' | 'automatic',
		record: WitnessRecord,
		report: WitnessReport,
	): Promise<void> {
		await this.log.line(
			`verify (${mode}) ${record.vaultPath}: armed size=${record.size} mtime=${record.mtime} sha256=${record.sha256} armedAt=${new Date(record.armedAt).toISOString()}`,
		);
		if (report.after) {
			await this.log.line(
				`verify (${mode}) ${record.vaultPath}: current size=${report.after.size} mtime=${report.after.mtime} sha256=${report.after.sha256}`,
			);
		}
		await this.log.line(`verify (${mode}) outcome: ${report.outcome}`);
	}

	private recheckAfterDelay(record: WitnessRecord): Promise<WitnessReport> {
		return new Promise((resolve, reject) => {
			this.registerInterval(
				window.setTimeout(() => {
					checkWitnessRecord(this.app, record).then(resolve, reject);
				}, RECHECK_DELAY_MS),
			);
		});
	}

	async saveSettings(): Promise<void> {
		await this.savePluginData();
	}

	private async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<EtchData> | null;
		const settings: EtchSettings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			raw?.settings,
		);
		// data.json is hand-editable and syncs; never navigate on a route
		// value this build does not know.
		if (!isRouteId(settings.route)) settings.route = DEFAULT_SETTINGS.route;
		this.settings = settings;
		this.witnessRecord = raw?.witness ?? null;
	}

	private async savePluginData(): Promise<void> {
		const data: EtchData = {
			settings: this.settings,
			witness: this.witnessRecord,
		};
		await this.saveData(data);
	}
}
