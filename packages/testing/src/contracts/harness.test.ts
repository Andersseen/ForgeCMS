import { describe, expect, it } from 'vitest';
import { createFaultInjector } from './bootstrap.js';
import { codeOf, requireContenders, requirePair, winnerIndex } from './harness.js';
import { createWriteGate } from './last-admin.js';

// Spec 089 — the concurrency contracts only mean something if their own harness is trustworthy. These pin
// the harness behaviour every contract relies on: the write barrier that forces the read→decide→write
// gap open, its diagnostic when an operation never reaches a write, and the setup validation.

describe('codeOf', () => {
  it('reports ok, the rejection code, or the raw reason', () => {
    expect(codeOf({ status: 'fulfilled', value: 1 })).toBe('ok');
    expect(
      codeOf({ status: 'rejected', reason: Object.assign(new Error('x'), { code: 'CONFLICT' }) })
    ).toBe('CONFLICT');
    expect(codeOf({ status: 'rejected', reason: 'plain' })).toBe('plain');
    expect(codeOf({ status: 'rejected', reason: null })).toBeNull();
  });
});

describe('contender validation', () => {
  it('accepts the expected number and names the expectation when it is wrong', () => {
    expect(requireContenders(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
    expect(() => requireContenders(['a'], 2)).toThrow('setup() must return exactly 2 contenders');
    expect(() => requireContenders([], 0)).toThrow('setup() must return exactly 0 contenders');
    expect(requirePair(['a', 'b'])).toEqual(['a', 'b']);
    expect(() => requirePair(['a', 'b', 'c'])).toThrow('setup() must return exactly 2 contenders');
  });
});

describe('createWriteGate', () => {
  function database() {
    const calls: string[] = [];
    return {
      calls,
      label: 'db',
      async create(name: string) {
        calls.push(`create:${name}`);
        return name;
      },
      async findById(id: string) {
        calls.push(`read:${id}`);
        return id;
      }
    };
  }

  it('passes straight through until armed, and never holds reads or plain properties', async () => {
    const gate = createWriteGate();
    const db = gate.wrap(database());
    expect(db.label).toBe('db');
    expect(await db.create('a')).toBe('a');
    gate.arm(2);
    expect(await db.findById('r')).toBe('r');
    expect(gate.arrivals).toBe(0);
    gate.disarm();
  });

  it('holds the first write until the last party arrives, then releases everyone together', async () => {
    const gate = createWriteGate();
    const inner = database();
    const db = gate.wrap(inner);
    gate.arm(2);

    let firstDone = false;
    const first = db.create('first').then((v) => {
      firstDone = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(firstDone).toBe(false);
    expect(inner.calls).toEqual([]);
    expect(gate.arrivals).toBe(1);

    const second = db.create('second');
    expect(await Promise.all([first, second])).toEqual(['first', 'second']);
    expect(gate.arrivals).toBe(2);

    // Once released the gate stays open until re-armed: a compensating write does not deadlock.
    expect(await db.create('third')).toBe('third');
    gate.disarm();
  });

  it('rejects every held write with a diagnostic when the other party never reaches its write', async () => {
    const gate = createWriteGate({ timeoutMs: 30 });
    const inner = database();
    const db = gate.wrap(inner);
    gate.arm(3);
    const a = db.create('a');
    const b = db.create('b');
    await expect(a).rejects.toThrow(
      /WriteGate timed out: only 2 of 3 parties reached their write within 30ms/
    );
    await expect(b).rejects.toThrow(/WriteGate timed out/);
    expect(inner.calls).toEqual([]);
    gate.disarm();
  });

  it('a single-party gate releases immediately without ever starting a timer', async () => {
    const gate = createWriteGate({ timeoutMs: 20 });
    const db = gate.wrap(database());
    gate.arm(1);
    expect(await db.create('solo')).toBe('solo');
    await new Promise((r) => setTimeout(r, 40)); // a leaked timer would reject nothing, but must not throw
    expect(gate.arrivals).toBe(1);
    gate.disarm();
  });

  it('disarming forgets partial arrivals so a stale barrier cannot leak into the next scenario', async () => {
    const gate = createWriteGate({ timeoutMs: 1000 });
    const db = gate.wrap(database());
    gate.arm(2);
    void db.create('stranded').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 10));
    gate.disarm();
    expect(gate.arrivals).toBe(0);
    expect(await db.create('after')).toBe('after');
  });
});

describe('winnerIndex', () => {
  it('names the single fulfilled racer and refuses ambiguous races', () => {
    const ok = { status: 'fulfilled', value: 1 } as const;
    const no = { status: 'rejected', reason: new Error('x') } as const;
    expect(winnerIndex([ok, no])).toBe(0);
    expect(winnerIndex([no, ok])).toBe(1);
    expect(() => winnerIndex([ok, ok])).toThrow('expected exactly one winner, got 2 of 2');
    expect(() => winnerIndex([no, no])).toThrow('expected exactly one winner, got 0 of 2');
  });
});

describe('first-admin fault injector', () => {
  function recording() {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    return {
      calls,
      async create(...args: unknown[]) {
        calls.push({ method: 'create', args });
        return { id: 'created' };
      },
      async atomicWrite(...args: unknown[]) {
        calls.push({ method: 'atomicWrite', args });
        return [];
      },
      async findById(...args: unknown[]) {
        calls.push({ method: 'findById', args });
        return null;
      }
    };
  }
  const userCreate = { type: 'create', collection: 'users', data: { email: 'a@b.c' } };
  const claim = { type: 'create', collection: '_forge_bootstrap', data: { slot: 'users' } };

  it('is transparent until armed, and never touches reads', async () => {
    const fault = createFaultInjector();
    const inner = recording();
    const db = fault.wrap(inner, 'users');
    await db.create('users', {});
    await db.atomicWrite([claim, userCreate]);
    await db.findById('users', '1');
    expect(inner.calls.map((c) => c.method)).toEqual(['create', 'atomicWrite', 'findById']);
    expect(inner.calls[1]!.args).toEqual([[claim, userCreate]]);
  });

  it('fails a plain user create but lets other collections through', async () => {
    const fault = createFaultInjector();
    const inner = recording();
    const db = fault.wrap(inner, 'users');
    fault.arm('duplicate-email');
    await expect(db.create('users', {})).rejects.toThrow('injected: user create failed');
    await expect(db.create('posts', {})).resolves.toEqual({ id: 'created' });
    fault.disarm();
    await expect(db.create('users', {})).resolves.toEqual({ id: 'created' });
  });

  it('appends a failing operation AFTER the claim and user create of an atomic batch', async () => {
    const fault = createFaultInjector();
    const inner = recording();
    const db = fault.wrap(inner, 'users');

    fault.arm('duplicate-email');
    await db.atomicWrite([claim, userCreate]);
    expect(inner.calls.at(-1)!.args[0]).toEqual([
      claim,
      userCreate,
      { ...userCreate, data: { email: 'a@b.c', id: 'injected-duplicate' } }
    ]);

    fault.arm('missing-row');
    await db.atomicWrite([claim, userCreate]);
    expect(inner.calls.at(-1)!.args[0]).toEqual([
      claim,
      userCreate,
      { type: 'update', collection: 'users', id: 'injected-missing-row', data: { name: 'nobody' } }
    ]);

    // A batch that creates no user is none of its business.
    await db.atomicWrite([claim]);
    expect(inner.calls.at(-1)!.args[0]).toEqual([claim]);
  });
});
