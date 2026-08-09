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
	private reportedFailure = false;
	/** Set once the log file is known to exist, to keep the tap path short. */
	private fileExists = false;

	constructor(
		private readonly app: App,
		private readonly path: string,
		/**
		 * Called at most once, on the first write failure. The log is the
		 * project's evidence channel, so a silent failure is worse than the
		 * failure: it produces a log that reads as complete.
		 */
		private readonly onWriteFailure?: (error: unknown) => void,
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
	 * Appends are chained so lines land in order. The returned promise
	 * resolves once the adapter's write call has returned, which is as close
	 * to "on disk" as the public API goes, or once a failure has been
	 * reported. It never rejects: a logging failure must not mask or block a
	 * handoff, so callers awaiting a flush before navigating cannot be
	 * derailed by one. Failures reach the console and onWriteFailure instead.
	 */
	private append(text: string): Promise<void> {
		this.queue = this.queue
			.then(() => this.write(text))
			.catch((error: unknown) => {
				console.error('[etch] debug log write failed', error);
				if (!this.reportedFailure) {
					this.reportedFailure = true;
					this.onWriteFailure?.(error);
				}
			});
		return this.queue;
	}

	private async write(text: string): Promise<void> {
		const { adapter } = this.app.vault;
		// The existence check is skipped once it has been answered, which
		// halves the adapter calls per line on the tap path.
		if (this.fileExists || (await adapter.exists(this.path))) {
			await adapter.append(this.path, text);
		} else {
			await adapter.write(this.path, `# Etch debug log\n\n${text}`);
		}
		this.fileExists = true;
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
