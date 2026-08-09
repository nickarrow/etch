import { describe, expect, it } from 'vitest';
import {
	REFRESH_PARAM,
	applyRefreshToken,
	buildToken,
	isVaultResourceUrl,
	nextImageSrc,
	stripResourceQuery,
} from './refresh';

// The image resource URL shape as observed on device (spike session 5 and 6;
// the query is absent on mobile, which is why the cache never invalidates).
const RESOURCE =
	'capacitor://localhost/_capacitor_file_/var/mobile/Containers/Data/Application/4A172DAC-DE2F-4E7B-9935-0667E76F9ADF/Documents/etch-test-vault/Sheet%20Snapshot.png';

describe('isVaultResourceUrl', () => {
	it('accepts the capacitor resource URL', () => {
		expect(isVaultResourceUrl(RESOURCE)).toBe(true);
	});

	it('rejects anything not served out of the vault container', () => {
		for (const src of [
			'https://example.com/a.png',
			'data:image/png;base64,AAAA',
			'app://obsidian.md/a.png',
			'',
		]) {
			expect(isVaultResourceUrl(src)).toBe(false);
		}
	});
});

describe('stripResourceQuery', () => {
	it('leaves a bare URL alone', () => {
		expect(stripResourceQuery(RESOURCE)).toBe(RESOURCE);
	});

	it('drops a query and a fragment', () => {
		expect(stripResourceQuery(`${RESOURCE}?etch=1.2`)).toBe(RESOURCE);
		expect(stripResourceQuery(`${RESOURCE}?etch=1.2#page=3`)).toBe(RESOURCE);
		expect(stripResourceQuery(`${RESOURCE}#page=3`)).toBe(RESOURCE);
	});

	it('keeps an encoded question mark, which is part of the filename', () => {
		const src = `${RESOURCE.replace('.png', '')}%3F.png`;
		expect(stripResourceQuery(src)).toBe(src);
	});

	it('keeps an encoded hash, which is part of the filename', () => {
		const src = RESOURCE.replace('Sheet%20Snapshot', 'sheet%231');
		expect(stripResourceQuery(src)).toBe(src);
	});
});

describe('buildToken', () => {
	it('changes when only the counter moves', () => {
		// The case the counter exists for: Preview has rewritten a file with
		// size and mtime both frozen (spike session 5, run A), and a frozen
		// token would render the cached bitmap again.
		expect(buildToken(1786302622741, 1)).not.toBe(buildToken(1786302622741, 2));
	});

	it('holds still for the same change', () => {
		// A token that moved on its own would make the webview re-read the
		// file on every render.
		expect(buildToken(1786302622741, 3)).toBe(buildToken(1786302622741, 3));
	});

	it('needs no encoding of its own', () => {
		expect(buildToken(1786302622741, 4)).toBe('1786302622741.4');
	});
});

describe('applyRefreshToken', () => {
	it('adds the parameter to a bare URL', () => {
		expect(applyRefreshToken(RESOURCE, '1786302622741.1')).toBe(
			`${RESOURCE}?${REFRESH_PARAM}=1786302622741.1`,
		);
	});

	it('replaces its own parameter instead of stacking copies', () => {
		const once = applyRefreshToken(RESOURCE, '1.1');
		const twice = applyRefreshToken(once, '2.2');
		expect(twice).toBe(`${RESOURCE}?${REFRESH_PARAM}=2.2`);
	});

	it('preserves parameters it does not own, in order', () => {
		const src = `${RESOURCE}?a=1&${REFRESH_PARAM}=old&b=2`;
		expect(applyRefreshToken(src, 'new')).toBe(
			`${RESOURCE}?a=1&b=2&${REFRESH_PARAM}=new`,
		);
	});

	it('drops a valueless copy of its own parameter', () => {
		expect(applyRefreshToken(`${RESOURCE}?${REFRESH_PARAM}`, '3.1')).toBe(
			`${RESOURCE}?${REFRESH_PARAM}=3.1`,
		);
	});

	it('does not treat a parameter with a shared prefix as its own', () => {
		const src = `${RESOURCE}?etchy=keep`;
		expect(applyRefreshToken(src, '4.1')).toBe(
			`${src}&${REFRESH_PARAM}=4.1`,
		);
	});

	it('keeps a fragment at the end', () => {
		expect(applyRefreshToken(`${RESOURCE}#page=2`, '5.1')).toBe(
			`${RESOURCE}?${REFRESH_PARAM}=5.1#page=2`,
		);
	});

	it('encodes a token that would otherwise break the query', () => {
		expect(applyRefreshToken(RESOURCE, 'a&b=c')).toBe(
			`${RESOURCE}?${REFRESH_PARAM}=a%26b%3Dc`,
		);
	});
});

describe('nextImageSrc', () => {
	const tokens = new Map([[RESOURCE, '1786302622741.1']]);

	it('applies the token recorded for the file', () => {
		expect(nextImageSrc(RESOURCE, tokens)).toBe(
			`${RESOURCE}?${REFRESH_PARAM}=1786302622741.1`,
		);
	});

	it('rewrites a src that still carries an older token', () => {
		expect(nextImageSrc(`${RESOURCE}?${REFRESH_PARAM}=1.1`, tokens)).toBe(
			`${RESOURCE}?${REFRESH_PARAM}=1786302622741.1`,
		);
	});

	it('leaves a src that already carries the current token', () => {
		const current = `${RESOURCE}?${REFRESH_PARAM}=1786302622741.1`;
		// This is what keeps the mutation observer from looping on its own
		// rewrites, and what keeps an unchanged file off the disk on every
		// re-render.
		expect(nextImageSrc(current, tokens)).toBeNull();
	});

	it('leaves a vault image with no recorded change alone', () => {
		const other = RESOURCE.replace('Sheet%20Snapshot', 'Control');
		expect(nextImageSrc(other, tokens)).toBeNull();
	});

	it('leaves images served from outside the vault alone', () => {
		expect(nextImageSrc('https://example.com/a.png', tokens)).toBeNull();
	});

	it('matches on the path only, ignoring an unrelated query', () => {
		expect(nextImageSrc(`${RESOURCE}?a=1`, tokens)).toBe(
			`${RESOURCE}?a=1&${REFRESH_PARAM}=1786302622741.1`,
		);
	});
});
