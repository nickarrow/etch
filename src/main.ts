import { Notice, Platform, Plugin, TFile, normalizePath } from 'obsidian';
import { EtchLog } from './log';
import { performHandoff } from './routes';
import { DEFAULT_SETTINGS, EtchSettings, EtchSettingTab } from './settings';
import { WitnessRecord, checkWitnessRecord } from './witness';

interface EtchData {
	settings: EtchSettings;
	witness: WitnessRecord | null;
}

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
			name: 'Mark up with Pencil',
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

		// Webview-teardown recovery: if a handoff is still armed from a
		// previous session, check it once the workspace is ready.
		if (this.witnessRecord) {
			this.app.workspace.onLayoutReady(() => {
				void this.verifyLastHandoff('automatic');
			});
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
	 * supersedes. The automatic startup check reports a handoff once and
	 * clears the armed record after a changed result.
	 */
	private async verifyLastHandoff(mode: 'manual' | 'automatic'): Promise<void> {
		const record = this.witnessRecord;
		if (!record) {
			if (mode === 'manual') new Notice('No armed handoff to verify.');
			return;
		}
		try {
			const report = await checkWitnessRecord(this.app, record);
			await this.log.line(
				`verify (${mode}) ${record.vaultPath}: armed size=${record.size} mtime=${record.mtime} sha256=${record.sha256}`,
			);
			if (report.after) {
				await this.log.line(
					`verify (${mode}) ${record.vaultPath}: current size=${report.after.size} mtime=${report.after.mtime} sha256=${report.after.sha256}`,
				);
			}
			await this.log.line(`verify (${mode}) outcome: ${report.outcome}`);
			new Notice(report.summary, 10000);
			if (mode === 'automatic' && report.outcome === 'changed') {
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

	async saveSettings(): Promise<void> {
		await this.savePluginData();
	}

	private async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<EtchData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings);
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
