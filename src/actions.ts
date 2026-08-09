import { App, FileView, TFile } from 'obsidian';
import { isMarkupFile } from './formats';

/**
 * The view header action, installed per open view that holds a file Etch can
 * hand off. Kept out of main.ts so that file stays lifecycle and
 * registration.
 */

/**
 * Obsidian's own view types for the two file kinds this plugin acts on.
 * Neither id is exported by the API, so both are strings this plugin asserts:
 * `pdf` carried the action through the wave 1 and wave 2 device sessions, and
 * `image` is unverified until the wave 3 session. A wrong id costs the header
 * action in that view and nothing else, since every other tap point is
 * independent of it.
 */
export const MARKUP_VIEW_TYPES = ['pdf', 'image'] as const;

const VIEW_ACTION_CLASS = 'etch-view-action';

export class ViewActions {
	/**
	 * The elements this plugin created, keyed by the view holding each one.
	 * Presence is this map rather than a DOM query, and cleanup walks the
	 * elements in it rather than re-deriving them from a view type: an action
	 * installed in a view type a later build stops walking still comes out on
	 * unload. An element whose header was rebuilt reads as absent, since a
	 * detached element is no longer connected, so the next sync reinstalls it.
	 */
	private readonly installed = new Map<FileView, HTMLElement>();

	constructor(
		private readonly app: App,
		private readonly icon: string,
		private readonly title: string,
		private readonly onTrigger: (file: TFile) => void,
	) {}

	/**
	 * Brings the installed set in line with what is open. Cheap enough for a
	 * workspace event: it walks open leaves of two view types and touches the
	 * DOM only where something is missing or orphaned.
	 */
	sync(): void {
		const wanted = new Set<FileView>();
		for (const type of MARKUP_VIEW_TYPES) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				const view = leaf.view;
				// The file is checked here, not at install time only, because
				// one image view is reused for the next image opened in it,
				// and Obsidian's image view opens formats Etch does not claim.
				if (view instanceof FileView && view.file && isMarkupFile(view.file)) {
					wanted.add(view);
				}
			}
		}

		for (const [view, el] of this.installed) {
			if (wanted.has(view) && el.isConnected) continue;
			el.remove();
			this.installed.delete(view);
		}
		for (const view of wanted) {
			if (this.installed.has(view)) continue;
			this.installed.set(view, this.install(view));
		}
	}

	dispose(): void {
		for (const el of this.installed.values()) el.remove();
		this.installed.clear();
	}

	/**
	 * The click closure holds its view and reads `view.file` when it fires, so
	 * a file swap inside the same view hands off the file on screen. The
	 * element dies with the view, so the lifetimes match.
	 */
	private install(view: FileView): HTMLElement {
		const el = view.addAction(this.icon, this.title, () => {
			const file = view.file;
			if (file && isMarkupFile(file)) this.onTrigger(file);
		});
		el.addClass(VIEW_ACTION_CLASS);
		// Obsidian labels its own header actions; setting it here makes the
		// accessible name this plugin's responsibility rather than an
		// assumption about Obsidian's internals (engineering rule 10).
		el.setAttribute('aria-label', this.title);
		return el;
	}
}
