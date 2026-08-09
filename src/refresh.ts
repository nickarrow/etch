import type { App, TFile } from 'obsidian';
import { isImageFile } from './formats';
import type { EtchLog } from './log';

/**
 * Image freshness after an external write.
 *
 * Obsidian hands image bytes to the webview by URL, and on iOS the resource
 * URL carries no query, so the webview cache keeps answering with the
 * pre-markup bitmap. Spike session 5 reproduced that on demand: closing and
 * reopening the file did not help, only an app restart did. Session 6 proved
 * both the remedy and its shape. Bumping the query on a rendered img src
 * refreshes it at once, and a later render reuses the cached URL, so the
 * query has to be applied at render time rather than once per handoff.
 *
 * The scope is fixed: this rewrites the query parameter of img srcs on
 * elements something else already rendered. It replaces no widgets and adds
 * no render path.
 *
 * Tokens are only ever derived forward, from a vault file to its resource
 * URL, so nothing here has to invert a URL back into a vault path. A file
 * with no token renders exactly as it did before Etch was installed.
 */

/** The query parameter this plugin owns. Other parameters are preserved. */
export const REFRESH_PARAM = 'etch';

/**
 * The marker that identifies a vault-backed resource URL. This is a separate
 * constant from the resolver's on purpose: the failure-test build breaks that
 * one deliberately, and image refresh has to keep working in that build.
 */
const CAPACITOR_FILE_MARKER = '/_capacitor_file_';

/**
 * Obsidian can report several writes for one save, and a vault event handler
 * has to debounce (engineering rule 9).
 */
const MODIFY_DEBOUNCE_MS = 250;

export function isVaultResourceUrl(src: string): boolean {
	return src.includes(CAPACITOR_FILE_MARKER);
}

/** The cache key: the URL without its query or fragment. */
export function stripResourceQuery(src: string): string {
	const hashIndex = src.indexOf('#');
	const withoutFragment = hashIndex === -1 ? src : src.slice(0, hashIndex);
	const queryIndex = withoutFragment.indexOf('?');
	return queryIndex === -1
		? withoutFragment
		: withoutFragment.slice(0, queryIndex);
}

/**
 * Replaces this plugin's parameter and leaves every other one in place, in
 * order. Obsidian does not put a query on a mobile resource URL today, but a
 * URL that arrives with one belongs to whoever wrote it.
 */
export function applyRefreshToken(src: string, token: string): string {
	const hashIndex = src.indexOf('#');
	const fragment = hashIndex === -1 ? '' : src.slice(hashIndex);
	const withoutFragment = hashIndex === -1 ? src : src.slice(0, hashIndex);
	const queryIndex = withoutFragment.indexOf('?');
	const base =
		queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex);
	const query = queryIndex === -1 ? '' : withoutFragment.slice(queryIndex + 1);
	const kept = query
		.split('&')
		.filter(
			(pair) =>
				pair.length > 0 &&
				pair !== REFRESH_PARAM &&
				!pair.startsWith(`${REFRESH_PARAM}=`),
		);
	kept.push(`${REFRESH_PARAM}=${encodeURIComponent(token)}`);
	return `${base}?${kept.join('&')}${fragment}`;
}

/**
 * Anything an img can be found in or be. Every DOM node with children is
 * both, and naming the intersection is what lets Obsidian's cross-window
 * `instanceOf` check be used on it.
 */
type RefreshRoot = Node & ParentNode;

/**
 * The whole decision for one img, kept pure so the DOM walk stays trivial.
 * Null means leave this element alone: it is not a vault resource, no change
 * has been recorded for it, or it already carries the current token.
 */
export function nextImageSrc(
	src: string,
	tokens: ReadonlyMap<string, string>,
): string | null {
	if (!isVaultResourceUrl(src)) return null;
	const token = tokens.get(stripResourceQuery(src));
	if (token === undefined) return null;
	const next = applyRefreshToken(src, token);
	return next === src ? null : next;
}

/**
 * The token changes whenever a change is observed and holds still otherwise,
 * which matters both ways: a stale token shows stale pixels, and a token that
 * moved for no reason makes the webview re-read the file on every render.
 *
 * mtime alone cannot carry it. Preview has been observed rewriting a file
 * with size and mtime both frozen (spike session 5, run A), so the generation
 * counter is what guarantees a new URL for a change the metadata hides. mtime
 * stays in the token because it makes a debug log line self-explanatory.
 */
export function buildToken(mtime: number, generation: number): string {
	return `${mtime}.${generation}`;
}

/**
 * A rendered img can be the node handed in or somewhere under it: the
 * observer reports a newly inserted img as the node itself, while a
 * post-processor hands over the block that contains one.
 */
function collectImages(root: RefreshRoot): HTMLImageElement[] {
	return root.instanceOf(HTMLImageElement)
		? [root]
		: Array.from(root.querySelectorAll('img'));
}

/**
 * Obsidian sets the attribute, so the attribute is what is compared: reading
 * the src property would hand back a URL the browser has re-serialized. An
 * img with no attribute yet is left to the mutation record that will report
 * the attribute being set.
 */
function readSrc(img: HTMLImageElement): string {
	return img.getAttribute('src') ?? '';
}

export class ImageRefresh {
	/** Resource URL without its query, to the token its renders must carry. */
	private readonly tokens = new Map<string, string>();
	private readonly pending = new Map<string, TFile>();
	private generation = 0;
	/** Keeps the render paths to one log line per recorded change. */
	private reportedGeneration = 0;
	private debounceTimer: number | null = null;
	private observer: MutationObserver | null = null;

	constructor(
		private readonly app: App,
		private readonly log: EtchLog,
	) {}

	/**
	 * Applies the current tokens to whatever has just been rendered. Called
	 * from the reading-mode post-processor and from the mutation observer that
	 * covers live preview and the image view. The first render-time bump after
	 * each recorded change writes one log line: live preview rebuilds widgets
	 * constantly, so a line per render would bury the log, and one line is
	 * enough to tell a render-time bump from a missing one.
	 */
	applyTo(root: RefreshRoot): number {
		const bumped = this.apply(root);
		if (bumped > 0 && this.reportedGeneration !== this.generation) {
			this.reportedGeneration = this.generation;
			void this.log.line(
				`image refresh: ${bumped} newly rendered img(s) took the current query`,
			);
		}
		return bumped;
	}

	private apply(root: RefreshRoot): number {
		if (this.tokens.size === 0) return 0;
		let bumped = 0;
		for (const img of collectImages(root)) {
			const next = nextImageSrc(readSrc(img), this.tokens);
			if (next === null) continue;
			img.setAttribute('src', next);
			bumped += 1;
		}
		return bumped;
	}

	/**
	 * Vault modify handler. Filters to images before anything else, then
	 * debounces, per engineering rule 9. Whether this event fires at all for
	 * a write made by another app on iOS is what the wave 3 device session
	 * measures; the log line is the evidence.
	 */
	fileModified(file: TFile): void {
		if (!isImageFile(file)) return;
		this.pending.set(file.path, file);
		if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			this.flush();
		}, MODIFY_DEBOUNCE_MS);
	}

	/**
	 * Live preview re-creates embed widgets constantly and the image view
	 * builds its own img, so neither is reachable from a markdown
	 * post-processor. Watching for img elements covers both without touching
	 * how either one renders.
	 *
	 * Observation starts with the first recorded change rather than at
	 * startup, so a session that marks up nothing pays nothing: with no
	 * tokens there is nothing to rewrite, and the engine is not asked to
	 * report mutations that would all be discarded.
	 *
	 * The root is the document body rather than the workspace container,
	 * because Obsidian mounts hover previews and modals outside that
	 * container and an image can render in one.
	 */
	private ensureObserving(): void {
		if (this.observer) return;
		const observer = new MutationObserver((records) => {
			if (this.tokens.size === 0) return;
			for (const record of records) {
				if (record.type === 'attributes') {
					// Our own rewrite lands here too. It is idempotent, so the
					// second pass finds nothing to do and the loop ends.
					if (record.target.instanceOf(Element)) this.applyTo(record.target);
					continue;
				}
				for (const node of Array.from(record.addedNodes)) {
					if (node.instanceOf(Element)) this.applyTo(node);
				}
			}
		});
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['src'],
		});
		this.observer = observer;
	}

	dispose(): void {
		this.observer?.disconnect();
		this.observer = null;
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.pending.clear();
		this.tokens.clear();
	}

	/**
	 * Records what changed and refreshes what is on screen already. The URL is
	 * logged with the token because it is the one thing a mismatch would show:
	 * a key that does not equal the src Obsidian rendered produces a bump
	 * count of zero, which reads the same as nothing being open.
	 */
	private flush(): void {
		const files = Array.from(this.pending.values());
		this.pending.clear();
		for (const file of files) {
			this.generation += 1;
			const key = stripResourceQuery(this.app.vault.getResourcePath(file));
			const token = buildToken(file.stat.mtime, this.generation);
			this.tokens.set(key, token);
			void this.log.line(
				`image changed: ${file.path} size=${file.stat.size} mtime=${file.stat.mtime} token=${token} url=${key}`,
			);
		}
		this.ensureObserving();
		// Quiet, because this path reports its own count on the next line.
		const bumped = this.apply(document);
		void this.log.line(
			`image refresh: bumped ${bumped} rendered img(s) after the change`,
		);
	}
}
