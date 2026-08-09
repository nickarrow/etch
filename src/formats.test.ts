import { describe, expect, it } from 'vitest';
import {
	IMAGE_EXTENSIONS,
	MARKUP_EXTENSIONS,
	isImageExtension,
	isMarkupExtension,
} from './formats';

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
		// The gate this test exists for: a candidate format joins the list on
		// a witnessed device round trip, and svg never joins it.
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
