import type { TFile } from 'obsidian';

/**
 * Which vault files Etch will hand to Preview.
 *
 * A format ships once a device round trip has been witnessed for it. All four
 * of these have one, from the wave 3 session of 2026-08-11; PDF and PNG have
 * several going back to the spike.
 *
 * `heic` and `tiff` will not join: Obsidian's accepted-formats list covers
 * avif, bmp, gif, jpeg, jpg, png, svg, and webp, so it never displays those
 * two, and a file Obsidian does not show has nowhere to put a pencil. `gif` is
 * on that list, did not appear on device in the wave 3 session for reasons
 * nobody established, and would flatten to a still image under markup anyway.
 * `svg` is excluded on purpose whatever a device run says: it is a text
 * format, what a markup tool writes back into one is unverified, and the risk
 * to a vault file is not worth the format.
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

/**
 * The extension is all these predicates read, and asking for no more than
 * that is what lets the tests hand them a literal instead of a file.
 */
export function isMarkupFile(file: Pick<TFile, 'extension'>): boolean {
	return isMarkupExtension(file.extension);
}

export function isImageFile(file: Pick<TFile, 'extension'>): boolean {
	return isImageExtension(file.extension);
}
