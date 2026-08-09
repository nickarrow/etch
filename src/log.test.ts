import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EtchLog, describeError } from './log';

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

type AppArg = ConstructorParameters<typeof EtchLog>[0];

interface Adapter {
	calls: string[];
	contents: string;
	failWrites: boolean;
	app: AppArg;
}

function stubAdapter(options: { exists?: boolean; failWrites?: boolean } = {}) {
	const state: Adapter = {
		calls: [],
		contents: '',
		failWrites: options.failWrites === true,
		app: undefined as unknown as AppArg,
	};
	let exists = options.exists === true;
	state.app = {
		vault: {
			adapter: {
				exists: () => {
					state.calls.push('exists');
					return Promise.resolve(exists);
				},
				append: (_path: string, text: string) => {
					state.calls.push('append');
					if (state.failWrites) return Promise.reject(new Error('no space'));
					state.contents += text;
					return Promise.resolve();
				},
				write: (_path: string, text: string) => {
					state.calls.push('write');
					if (state.failWrites) return Promise.reject(new Error('no space'));
					state.contents = text;
					exists = true;
					return Promise.resolve();
				},
			},
		},
	} as unknown as AppArg;
	return state;
}

describe('EtchLog', () => {
	beforeEach(() => {
		vi.spyOn(console, 'debug').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('writes nothing while disabled', async () => {
		const stub = stubAdapter();
		const log = new EtchLog(stub.app, 'log.md');
		await log.line('quiet');
		await log.error('also quiet');
		expect(stub.calls).toEqual([]);
	});

	it('creates the file with a header, then appends', async () => {
		const stub = stubAdapter();
		const log = new EtchLog(stub.app, 'log.md');
		log.setEnabled(true);
		await log.line('first');
		await log.line('second');
		expect(stub.contents).toContain('# Etch debug log');
		expect(stub.contents).toContain('first');
		expect(stub.contents).toContain('second');
		expect(stub.calls.filter((c) => c === 'write')).toHaveLength(1);
	});

	it('asks whether the file exists only once', async () => {
		const stub = stubAdapter({ exists: true });
		const log = new EtchLog(stub.app, 'log.md');
		log.setEnabled(true);
		await log.line('a');
		await log.line('b');
		await log.line('c');
		expect(stub.calls.filter((c) => c === 'exists')).toHaveLength(1);
	});

	it('keeps lines in call order when not awaited individually', async () => {
		const stub = stubAdapter({ exists: true });
		const log = new EtchLog(stub.app, 'log.md');
		log.setEnabled(true);
		await Promise.all([log.line('one'), log.line('two'), log.line('three')]);
		const order = ['one', 'two', 'three'].map((t) => stub.contents.indexOf(t));
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(order[0]).toBeGreaterThanOrEqual(0);
	});

	it('never rejects on a failed write, and reports it once', async () => {
		const stub = stubAdapter({ exists: true, failWrites: true });
		const failures: unknown[] = [];
		const log = new EtchLog(stub.app, 'log.md', (error) => {
			failures.push(error);
		});
		log.setEnabled(true);
		// Resolving is the contract: a log failure must not block a handoff.
		await expect(log.line('lost')).resolves.toBeUndefined();
		await expect(log.line('also lost')).resolves.toBeUndefined();
		expect(failures).toHaveLength(1);
	});

	it('survives a failed write and keeps logging afterwards', async () => {
		const stub = stubAdapter({ exists: true, failWrites: true });
		const log = new EtchLog(stub.app, 'log.md');
		log.setEnabled(true);
		await log.line('lost');
		stub.failWrites = false;
		await log.line('kept');
		expect(stub.contents).toContain('kept');
	});
});
