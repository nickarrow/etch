import { App, Notice, normalizePath } from 'obsidian';

/**
 * Durable logger for the spike.
 *
 * Why this exists: several experiments deliberately try to leave Obsidian. When
 * iOS backgrounds the app the webview can be torn down and reloaded, taking the
 * console history with it. Anything we want to read *after* a handoff has to be
 * on disk before the handoff happens. Hence: every line is flushed to a note in
 * the vault, and callers `await` the flush before navigating away.
 */
export class SpikeLog {
	private readonly path: string;

	constructor(
		private readonly app: App,
		fileName = 'SPIKE-LOG.md',
	) {
		this.path = normalizePath(fileName);
	}

	/** Write a line to the on-disk log and the console. */
	async line(message: string): Promise<void> {
		const stamp = new Date().toISOString().slice(11, 23);
		const entry = `- \`${stamp}\` ${message}\n`;
		// Console output is the deliverable here, not incidental chatter: this is a
		// diagnostic spike and the exact error shape is the finding.
		console.log(`[spike ${stamp}] ${message}`);
		await this.appendRaw(entry);
	}

	/** Write a fenced code block, for dumps that would be unreadable inline. */
	async block(label: string, body: unknown): Promise<void> {
		const text = typeof body === 'string' ? body : safeStringify(body);
		console.log(`[spike] ${label}`, body);
		await this.appendRaw(`\n**${label}**\n\n\`\`\`\n${text}\n\`\`\`\n\n`);
	}

	/** Start a clearly delimited section so results are attributable per run. */
	async section(title: string): Promise<void> {
		const stamp = new Date().toISOString();
		await this.appendRaw(`\n---\n\n## ${title}\n\n_${stamp}_\n\n`);
	}

	/** Log and surface on-device, so results are visible without a debugger. */
	async notice(message: string, durationMs = 8000): Promise<void> {
		new Notice(message, durationMs);
		await this.line(message);
	}

	private async appendRaw(text: string): Promise<void> {
		const { adapter } = this.app.vault;
		try {
			if (await adapter.exists(this.path)) {
				await adapter.append(this.path, text);
			} else {
				await adapter.write(this.path, `# Spike log\n${text}`);
			}
		} catch (error) {
			// Never let logging failure mask an experiment result.
			console.error('[spike] log write failed', error);
		}
	}
}

/** JSON stringify that tolerates cycles, errors, and exotic host objects. */
export function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	const replacer = (_key: string, val: unknown): unknown => {
		if (val instanceof Error) {
			return { name: val.name, message: val.message, stack: val.stack };
		}
		if (typeof val === 'function') {
			const named = val as { name?: string };
			return `[function ${named.name ?? 'anonymous'}]`;
		}
		if (typeof val === 'object' && val !== null) {
			if (seen.has(val)) return '[circular]';
			seen.add(val);
		}
		return val;
	};
	return JSON.stringify(value, replacer, 2) ?? String(value);
}

/** Normalise anything thrown into something worth reading in a log. */
export function describeError(error: unknown): string {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return `non-Error thrown: ${safeStringify(error)}`;
}
