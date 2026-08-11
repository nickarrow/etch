import { describe, expect, it } from 'vitest';
import {
	IMAGE_EXTENSIONS,
	MARKUP_EXTENSIONS,
	isImageExtension,
	isImageFile,
	isMarkupExtension,
	isMarkupFile,
} from './formats';

// The file predicates ask for an extension and nothing else, so a literal
// stands in for a file and this suite needs no obsidian stand-in at all.
function fileWith(extension: string): { extension: string } {
	return { extension };
}

describe('MARKUP_EXTENSIONS', () => {
	it('carries pdf plus the image formats, pdf first', () => {
		expect(Array.from(MARKUP_EXTENSIONS)).toEqual([
			'pdf',
			'png',
			'jpg',
			'jpeg',
		]);
	});

	it('names only formats with evidence behind them', () => {
		// The gate this test exists for: a format joins the list on a
		// witnessed device round trip. heic and tiff cannot, since Obsidian
		// does not display them, and svg is excluded whatever a run says.
		for (const candidate of ['heic', 'tiff', 'gif', 'svg', 'webp', 'avif']) {
			expect(isMarkupExtension(candidate)).toBe(false);
		}
	});
});

describe('isMarkupExtension', () => {
	it('accepts every listed format', () => {
		for (const extension of MARKUP_EXTENSIONS) {
			expect(isMarkupExtension(extension)).toBe(true);
		}
	});

	it('folds case', () => {
		expect(isMarkupExtension('PDF')).toBe(true);
		expect(isMarkupExtension('PnG')).toBe(true);
		expect(isMarkupExtension('JPEG')).toBe(true);
	});

	it('rejects a near miss and an empty extension', () => {
		for (const value of ['', 'pdfx', 'png ', '.png', 'md', 'jp']) {
			expect(isMarkupExtension(value)).toBe(false);
		}
	});
});

describe('isImageExtension', () => {
	it('accepts the image formats and rejects pdf', () => {
		for (const extension of IMAGE_EXTENSIONS) {
			expect(isImageExtension(extension)).toBe(true);
		}
		// Refresh work is scoped by this: PDFs need no cache busting.
		expect(isImageExtension('pdf')).toBe(false);
	});

	it('folds case', () => {
		expect(isImageExtension('JPG')).toBe(true);
	});
});

describe('the file predicates', () => {
	it('read the extension Obsidian reports', () => {
		for (const extension of ['pdf', 'PNG', 'jpeg']) {
			expect(isMarkupFile(fileWith(extension))).toBe(true);
		}
		expect(isImageFile(fileWith('PNG'))).toBe(true);
		expect(isImageFile(fileWith('pdf'))).toBe(false);
	});

	it('decline a name that only looks like a supported one', () => {
		// Fullwidth and Cyrillic look-alikes: case folding cannot widen the
		// set, because no non-ASCII codepoint folds into these letters.
		for (const extension of ['', 'png ', 'md', 'ＰＮＧ', 'рng']) {
			expect(isMarkupFile(fileWith(extension))).toBe(false);
			expect(isImageFile(fileWith(extension))).toBe(false);
		}
	});
});
