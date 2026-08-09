import type { TFile } from 'obsidian';

/**
 * Which vault files Etch will hand to Preview.
 *
 * A format ships once a device round trip has been witnessed for it. PDF has
 * one in every session from the spike onward, and PNG has three from spike
 * session 5. `jpg` and `jpeg` ship alongside PNG on the plan's authority and
 * are unverified until this wave's device matrix round-trips them.
 *
 * `heic`, `tiff`, and `gif` are candidates and are absent on purpose: they
 * join the list on a witnessed round trip, not before. `svg` is excluded on
 * purpose, whatever a device run says: it is a text format, what a markup
 * tool writes back into one is unverified, and the risk to a vault file is
 * not worth the format.
 *
 * The extension check is what keeps the pencil off files Etch cannot
 * promise anything about; Obsidian's own image view opens more formats than
 * this list names.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const;

export const MARKUP_EXTENSIONS = ['pdf', ...IMAGE_EXTENSIONS] as const;

/**
 * Extensions arrive from Obsidian and from filenames, so every comparison
 * folds case first: `SHEET.PNG` is the same format as `sheet.png`.
 */
export function isImageExtension(extension: string): boolean {
	return (IMAGE_EXTENSIONS as readonly string[]).includes(
		extension.toLowerCase(),
	);
}

export function isMarkupExtension(extension: string): boolean {
	return (MARKUP_EXTENSIONS as readonly string[]).includes(
		extension.toLowerCase(),
	);
}

export function isMarkupFile(file: TFile): boolean {
	return isMarkupExtension(file.extension);
}

export function isImageFile(file: TFile): boolean {
	return isImageExtension(file.extension);
}
