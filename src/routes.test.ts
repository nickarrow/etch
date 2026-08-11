import { describe, expect, it, vi } from 'vitest';

// The obsidian package ships type definitions only. routes.ts imports Notice
// as a runtime value, and settings.ts, pulled in here to pin the default route
// against the dropdown order, extends PluginSettingTab at module scope.
vi.mock('obsidian', () => ({
	Notice: class {},
	PluginSettingTab: class {},
}));

import {
	LARGE_FILE_BYTES,
	ROUTE_LABELS,
	buildHandoffTarget,
	chooseRoute,
	encodePathSegments,
	isRouteId,
} from './routes';
import { parseResourcePath } from './resolve';
import { DEFAULT_SETTINGS } from './settings';

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
			['shareddocuments', 'Files viewer (default)'],
			['file', 'Preview'],
		]);
	});

	it('names the same route the settings default selects', () => {
		const [first] = Object.keys(ROUTE_LABELS);
		expect(first).toBe(DEFAULT_SETTINGS.route);
		expect(DEFAULT_SETTINGS.route).toBe('shareddocuments');
	});
});

describe('chooseRoute', () => {
	// Preview wrote nothing on two several-hundred-page PDFs across nine
	// handoffs in the wave 3 session; the Files viewer wrote both every time.
	it('sends a large file to the Files viewer even when Preview is chosen', () => {
		expect(chooseRoute('file', LARGE_FILE_BYTES)).toEqual({
			route: 'shareddocuments',
			overridden: true,
		});
		expect(chooseRoute('file', 254739264)).toEqual({
			route: 'shareddocuments',
			overridden: true,
		});
	});

	it('leaves a small file on Preview', () => {
		// The 1 MB PDF and the images that round-tripped through Preview in
		// the same session.
		for (const size of [0, 1016315, LARGE_FILE_BYTES - 1]) {
			expect(chooseRoute('file', size)).toEqual({
				route: 'file',
				overridden: false,
			});
		}
	});

	it('never overrides the Files viewer, at any size', () => {
		for (const size of [0, LARGE_FILE_BYTES, 254739264]) {
			expect(chooseRoute('shareddocuments', size)).toEqual({
				route: 'shareddocuments',
				overridden: false,
			});
		}
	});

	it('treats the threshold as inclusive', () => {
		expect(chooseRoute('file', LARGE_FILE_BYTES - 1).overridden).toBe(false);
		expect(chooseRoute('file', LARGE_FILE_BYTES).overridden).toBe(true);
	});

	it('sits well under the smallest size known to fail', () => {
		// 18 MB failed on device. A threshold above that would ship the
		// failure; this test is what keeps a later tweak honest.
		expect(LARGE_FILE_BYTES).toBeLessThan(18335754);
	});
});
