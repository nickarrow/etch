import { describe, expect, it } from 'vitest';
import { describeError } from './log';

describe('describeError', () => {
	it('renders an Error as name and message', () => {
		expect(describeError(new TypeError('boom'))).toBe('TypeError: boom');
	});

	it('renders thrown strings and objects as JSON', () => {
		expect(describeError('boom')).toBe('"boom"');
		expect(describeError({ code: 3 })).toBe('{"code":3}');
	});

	it('falls back to String for undefined', () => {
		expect(describeError(undefined)).toBe('undefined');
	});

	it('falls back to String for unstringifiable values', () => {
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(describeError(circular)).toBe('[object Object]');
	});
});
