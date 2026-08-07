import { describe, expect, it, vi } from 'vitest';

// The obsidian package ships type definitions only; routes.ts imports
// Notice as a runtime value, so give the module a stand-in.
vi.mock('obsidian', () => ({
	Notice: class {},
}));

import { encodePathSegments, isRouteId } from './routes';
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
		for (const name of ['a b.pdf', 'sheet#1.pdf', 'sheet50%.pdf']) {
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
	it('accepts the three routes', () => {
		expect(isRouteId('file')).toBe(true);
		expect(isRouteId('shareddocuments')).toBe(true);
		expect(isRouteId('share-sheet')).toBe(true);
	});

	it('rejects anything else', () => {
		for (const value of ['File', '', 'preview', 3, null, undefined, {}]) {
			expect(isRouteId(value)).toBe(false);
		}
	});
});
