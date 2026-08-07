import { describe, expect, it } from 'vitest';
import { parseResourcePath } from './resolve';

// Container path as observed on device (probe run 1 and the wave 1 session
// log). The UUID rotates on reinstall; the shape is what matters.
const CONTAINER =
	'/var/mobile/Containers/Data/Application/4A172DAC-DE2F-4E7B-9935-0667E76F9ADF/Documents/etch-test-vault';
const BASE = `capacitor://localhost/_capacitor_file_${CONTAINER}`;

describe('parseResourcePath', () => {
	it('resolves the observed resource-URL shape', () => {
		const result = parseResourcePath(
			`${BASE}/Kal-Arath%20Sheet.pdf`,
			'Kal-Arath Sheet.pdf',
		);
		expect(result).toEqual({
			ok: true,
			absolutePath: `${CONTAINER}/Kal-Arath Sheet.pdf`,
		});
	});

	it('strips a query string before decoding', () => {
		const result = parseResourcePath(
			`${BASE}/Sheet.pdf?1700000000000`,
			'Sheet.pdf',
		);
		expect(result).toEqual({
			ok: true,
			absolutePath: `${CONTAINER}/Sheet.pdf`,
		});
	});

	it('decodes an encoded # in the filename', () => {
		const result = parseResourcePath(`${BASE}/sheet%231.pdf`, 'sheet#1.pdf');
		expect(result).toEqual({
			ok: true,
			absolutePath: `${CONTAINER}/sheet#1.pdf`,
		});
	});

	it('decodes an encoded % in the filename', () => {
		const result = parseResourcePath(
			`${BASE}/sheet50%25.pdf`,
			'sheet50%.pdf',
		);
		expect(result).toEqual({
			ok: true,
			absolutePath: `${CONTAINER}/sheet50%.pdf`,
		});
	});

	it('accepts the /private/var container spelling', () => {
		const result = parseResourcePath(
			`capacitor://localhost/_capacitor_file_/private${CONTAINER}/Sheet.pdf`,
			'Sheet.pdf',
		);
		expect(result).toEqual({
			ok: true,
			absolutePath: `/private${CONTAINER}/Sheet.pdf`,
		});
	});

	it('rejects a URL without the capacitor marker', () => {
		const result = parseResourcePath(
			'app://obsidian.md/Sheet.pdf',
			'Sheet.pdf',
		);
		expect(result).toMatchObject({
			ok: false,
			failure: 'unrecognized-resource-url',
		});
	});

	it('rejects an undecodable percent sequence', () => {
		const result = parseResourcePath(`${BASE}/bad%GGname.pdf`, 'Sheet.pdf');
		expect(result).toMatchObject({ ok: false, failure: 'decode-failed' });
	});

	it('rejects a filename mismatch', () => {
		const result = parseResourcePath(`${BASE}/Other.pdf`, 'Sheet.pdf');
		expect(result).toMatchObject({ ok: false, failure: 'validation-failed' });
	});

	it('rejects a suffix match; XSheet.pdf cannot satisfy Sheet.pdf', () => {
		const result = parseResourcePath(`${BASE}/XSheet.pdf`, 'Sheet.pdf');
		expect(result).toMatchObject({ ok: false, failure: 'validation-failed' });
	});

	it('rejects a base directory returned instead of the file', () => {
		const result = parseResourcePath(BASE, 'Sheet.pdf');
		expect(result).toMatchObject({ ok: false, failure: 'validation-failed' });
	});

	it('rejects a trailing slash', () => {
		const result = parseResourcePath(`${BASE}/Sheet.pdf/`, 'Sheet.pdf');
		expect(result).toMatchObject({ ok: false, failure: 'validation-failed' });
	});

	it('rejects a relative path after the marker', () => {
		const result = parseResourcePath(
			'capacitor://localhost/_capacitor_file_Documents/Vault/Sheet.pdf',
			'Sheet.pdf',
		);
		expect(result).toMatchObject({ ok: false, failure: 'validation-failed' });
	});

	it('declines the expected iCloud container shape as non-local', () => {
		const result = parseResourcePath(
			'capacitor://localhost/_capacitor_file_/private/var/mobile/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/vault/Sheet.pdf',
			'Sheet.pdf',
		);
		expect(result).toMatchObject({ ok: false, failure: 'non-local-vault' });
	});

	it('declines an unknown absolute location as non-local', () => {
		const result = parseResourcePath(
			'capacitor://localhost/_capacitor_file_/tmp/Sheet.pdf',
			'Sheet.pdf',
		);
		expect(result).toMatchObject({ ok: false, failure: 'non-local-vault' });
	});

	it('round-trips an encoded ? in the filename', () => {
		const result = parseResourcePath(
			`${BASE}/sheet%3F1.pdf`,
			'sheet?1.pdf',
		);
		expect(result).toEqual({
			ok: true,
			absolutePath: `${CONTAINER}/sheet?1.pdf`,
		});
	});

	it('fails closed on a raw ? in the filename', () => {
		// A raw '?' reads as a query string; the truncated path then fails
		// the filename check. A loud decline, never a wrong navigation.
		const result = parseResourcePath(`${BASE}/sheet?1.pdf`, 'sheet?1.pdf');
		expect(result).toMatchObject({ ok: false, failure: 'validation-failed' });
	});
});
