import { describe, expect, it, vi } from 'vitest';

// The obsidian package ships type definitions only; routes.ts imports
// Notice as a runtime value, so give the module a stand-in.
vi.mock('obsidian', () => ({
	Notice: class {},
}));

import {
	ROUTE_LABELS,
	buildHandoffTarget,
	encodePathSegments,
	isRouteId,
} from './routes';
import { parseResourcePath } from './resolve';

describe('encodePathSegments', () => {
	it('encodes spaces and keeps separators', () => {
		expect(encodePathSegments('/a b/c d.pdf')).toBe('/a%20b/c%20d.pdf');
	});

	it('encodes # and %', () => {
		expect(encodePathSegments('/v/sheet#1.pdf')).toBe('/v/sheet%231.pdf');
		expect(encodePathSegments('/v/sheet50%.pdf')).toBe('/v/sheet50%25.pdf');
	});

	it('preserves the leading slash', () => {
		expect(encodePathSegments('/var/mobile')).toBe('/var/mobile');
	});

	it('inverts the parser for hostile names', () => {
		const container =
			'/var/mobile/Containers/Data/Application/AAAA/Documents/vault';
		for (const name of [
			'a b.pdf',
			'sheet#1.pdf',
			'sheet50%.pdf',
			// Image names, since wave 3 hands off images as well. The last two
			// are a Mac-created decomposed accent and an emoji; the deeper
			// filename matrix is wave 7 work, these two are here because the
			// encoding is shared with the refresh path.
			'a+b.png',
			'a&b=c.jpg',
			'SHEET.JPEG',
			'cafe\u0301.png',
			'🎲 sheet.jpg',
		]) {
			const path = `${container}/${name}`;
			const resourcePath = `capacitor://localhost/_capacitor_file_${encodePathSegments(path)}`;
			expect(parseResourcePath(resourcePath, name)).toEqual({
				ok: true,
				absolutePath: path,
			});
		}
	});
});

describe('isRouteId', () => {
	it('accepts the two routes', () => {
		expect(isRouteId('file')).toBe(true);
		expect(isRouteId('shareddocuments')).toBe(true);
	});

	it('rejects the removed share-sheet route', () => {
		// A pre-0.1.0 data.json can still carry it; the guard is what makes
		// it fall back to the default instead of navigating.
		expect(isRouteId('share-sheet')).toBe(false);
	});

	it('rejects anything else', () => {
		for (const value of ['File', '', 'preview', 3, null, undefined, {}]) {
			expect(isRouteId(value)).toBe(false);
		}
	});
});

describe('buildHandoffTarget', () => {
	const encoded = '/var/mobile/Documents/v/Kal-Arath%20Sheet.pdf';

	it('builds the file scheme and opens it', () => {
		expect(buildHandoffTarget('file', encoded)).toEqual({
			url: `file://${encoded}`,
			kind: 'open',
			description: `window.open("file://${encoded}")`,
		});
	});

	it('builds the shareddocuments scheme and assigns it', () => {
		expect(buildHandoffTarget('shareddocuments', encoded)).toEqual({
			url: `shareddocuments://${encoded}`,
			kind: 'assign',
			description: `window.location.href = "shareddocuments://${encoded}"`,
		});
	});

	it('gives both schemes three slashes before an absolute path', () => {
		// file:///var/... not file://var/...: the empty authority matters.
		expect(buildHandoffTarget('file', '/var/x.pdf').url).toBe(
			'file:///var/x.pdf',
		);
		expect(buildHandoffTarget('shareddocuments', '/var/x.pdf').url).toBe(
			'shareddocuments:///var/x.pdf',
		);
	});

	it('passes the encoded path through untouched', () => {
		const hostile = encodePathSegments('/v/sheet#1 50%.pdf');
		for (const route of ['file', 'shareddocuments'] as const) {
			expect(buildHandoffTarget(route, hostile).url).toContain(
				'sheet%231%2050%25.pdf',
			);
		}
	});
});

describe('ROUTE_LABELS', () => {
	it('labels both routes with the default first', () => {
		expect(Object.entries(ROUTE_LABELS)).toEqual([
			['file', 'Preview (default)'],
			['shareddocuments', 'Files viewer'],
		]);
	});
});
