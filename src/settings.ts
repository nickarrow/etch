import {
	App,
	Platform,
	PluginSettingTab,
	SettingDefinitionItem,
} from 'obsidian';
import type EtchPlugin from './main';
import { ROUTE_LABELS, RouteId, isRouteId } from './routes';

export interface EtchSettings {
	route: RouteId;
	debugLogging: boolean;
}

export const DEFAULT_SETTINGS: EtchSettings = {
	route: 'shareddocuments',
	debugLogging: false,
};

export class EtchSettingTab extends PluginSettingTab {
	plugin: EtchPlugin;

	constructor(app: App, plugin: EtchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: '',
				searchable: false,
				visible: !(Platform.isIosApp && Platform.isTablet),
				render: (setting) => {
					setting.settingEl.addClass('etch-platform-note');
					setting.setDesc(
						'Etch requires an iPad. It opens vault PDFs and images for Apple Pencil markup.',
					);
				},
			},
			{
				name: 'Handoff route',
				desc: createFragment((fragment) => {
					fragment.createDiv({
						text: 'Files viewer (default): opens the file in the Files viewer. Tap Markup, then the check mark to save before returning.',
					});
					fragment.createDiv({
						text: 'Preview: opens the file directly in Preview, which is smoother on small files. Large PDFs still open in the Files viewer, because Preview can lose markup on them.',
					});
				}),
				control: {
					type: 'dropdown',
					key: 'route',
					defaultValue: DEFAULT_SETTINGS.route,
					options: ROUTE_LABELS,
				},
			},
			{
				name: 'Debug logging',
				desc: 'Write a verbose log to the plugin folder and enable the Verify last handoff command. When off, errors go to the console only.',
				control: {
					type: 'toggle',
					key: 'debugLogging',
					defaultValue: DEFAULT_SETTINGS.debugLogging,
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof EtchSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'route') {
			if (!isRouteId(value)) return;
			this.plugin.settings.route = value;
		} else if (key === 'debugLogging') {
			const enabled = value === true;
			this.plugin.settings.debugLogging = enabled;
			this.plugin.log.setEnabled(enabled);
		} else {
			// An unknown key means nothing changed; do not write data.json.
			return;
		}
		await this.plugin.saveSettings();
	}
}
