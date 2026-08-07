import { App } from 'obsidian';

/**
 * Logger with two levels. Errors always go to the console. Verbose lines go
 * to a file in the plugin folder while the debug toggle is on, since console
 * history does not survive the webview teardown that can follow a handoff.
 * Callers await any write that must be on disk before a navigation.
 */
export class EtchLog {
	private enabled = false;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly app: App,
		private readonly path: string,
	) {}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	/** Verbose line, written to the debug file only while the toggle is on. */
	line(message: string): Promise<void> {
		if (!this.enabled) return Promise.resolve();
		console.debug(`[etch] ${message}`);
		return this.append(`- \`${new Date().toISOString()}\` ${message}\n`);
	}

	/** Errors reach the console always, and the debug file when enabled. */
	error(message: string, error?: unknown): Promise<void> {
		const detail = error === undefined ? '' : ` -> ${describeError(error)}`;
		console.error(`[etch] ${message}${detail}`);
		if (!this.enabled) return Promise.resolve();
		return this.append(
			`- \`${new Date().toISOString()}\` ERROR ${message}${detail}\n`,
		);
	}

	/**
	 * Appends are chained so lines land in order, and the returned promise
	 * resolves only once the line is on disk. Awaiting it before a navigation
	 * is what makes the log usable as handoff evidence.
	 */
	private append(text: string): Promise<void> {
		this.queue = this.queue
			.then(() => this.write(text))
			.catch((error: unknown) => {
				// A logging failure must never mask or block a handoff.
				console.error('[etch] debug log write failed', error);
			});
		return this.queue;
	}

	private async write(text: string): Promise<void> {
		const { adapter } = this.app.vault;
		if (await adapter.exists(this.path)) {
			await adapter.append(this.path, text);
		} else {
			await adapter.write(this.path, `# Etch debug log\n\n${text}`);
		}
	}
}

/** Render anything thrown into a single readable line. */
export function describeError(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	try {
		return JSON.stringify(error) ?? String(error);
	} catch {
		return String(error);
	}
}
