import { describe, expect, it } from 'vitest';

// Deterministic last-admin concurrency proof (spec 059). Duck-typed on purpose — like every other
// contract in this package it must not import `@forge-cms/db`/`@forge-cms/auth`.

const GATED_METHODS = new Set([
  'create',
  'update',
  'updateIf',
  'delete',
  'deleteIf',
  'atomicWrite'
]);

/**
 * A barrier for database writes. Once armed for N parties, every mutating call made through a wrapped
 * database waits until N such calls have arrived, then all are released together. Whatever one party
 * read or decided *before* its write is therefore already done when any party's write lands — the
 * read→decide→write gap a check-then-act implementation leaves open is forced open, not hoped for.
 *
 * Only the first arrival per armed party is held: once released, the gate stays open until re-armed,
 * so a second write from the same operation (e.g. a compensating one) does not deadlock.
 */
export interface WriteGate {
  /** Wraps `database` so its mutating calls (`create`, `update`, `updateIf`, `delete`, `deleteIf`, `atomicWrite`) pass through the gate. Reads are never held. */
  wrap<T extends object>(database: T): T;
  /** Start holding writes until `parties` of them have arrived. Before this, wrapped databases pass straight through. */
  arm(parties: number): void;
  /** Stop holding writes and forget any partially-arrived state. */
  disarm(): void;
  /** Mutating calls that reached the gate since the last `arm()`. */
  readonly arrivals: number;
}

export function createWriteGate(options: { timeoutMs?: number } = {}): WriteGate {
  const timeoutMs = options.timeoutMs ?? 5000;
  let parties = 0;
  let arrivals = 0;
  let released = false;
  let waiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function reset(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    parties = 0;
    arrivals = 0;
    released = false;
    waiters = [];
  }

  async function pass(): Promise<void> {
    if (parties === 0 || released) return;
    arrivals++;
    if (arrivals >= parties) {
      released = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const waiter of waiters.splice(0)) waiter.resolve();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      waiters.push({ resolve, reject });
      timer ??= setTimeout(() => {
        const error = new Error(
          `WriteGate timed out: only ${arrivals} of ${parties} parties reached their write within ${timeoutMs}ms ` +
            '(an operation decided without writing, or never reached the database)'
        );
        for (const waiter of waiters.splice(0)) waiter.reject(error);
      }, timeoutMs);
    });
  }

  return {
    wrap<T extends object>(database: T): T {
      return new Proxy(database, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          const method = value as (...args: unknown[]) => unknown;
          if (typeof property === 'string' && GATED_METHODS.has(property)) {
            return async (...args: unknown[]) => {
              await pass();
              return method.apply(target, args);
            };
          }
          return method.bind(target);
        }
      });
    },
    arm(count: number) {
      reset();
      parties = count;
    },
    disarm: reset,
    get arrivals() {
      return arrivals;
    }
  };
}

type Role = 'admin' | 'editor' | 'viewer';

/** The subset of a `DatabaseAdapter` the harness reads/writes directly. */
export interface LastAdminDatabase {
  findById(collection: string, id: string): Promise<Record<string, unknown> | null>;
  count(collection: string, where?: Record<string, unknown>): Promise<number>;
  update(
    collection: string,
    id: string,
    data: Partial<Record<string, unknown>>
  ): Promise<Record<string, unknown>>;
}

/** The subset of `UsersCollectionAuthAdapter` under test. */
export interface LastAdminUsers {
  createUser(input: {
    email: string;
    password: string;
    role?: Role;
  }): Promise<{ ok: true; user: { id: string } } | { ok: false; reason?: string }>;
  updateUser(id: string, input: { role?: Role }): Promise<unknown>;
  deleteUser(id: string): Promise<void>;
}

/** One concurrent party: its own users-collection auth instance and the (gated) database it writes through. */
export interface LastAdminContender {
  users: LastAdminUsers;
  database: LastAdminDatabase;
}

export interface LastAdminHarness {
  /** `parties` contenders, each with its **own adapter instance**, all over one shared store and one users collection. */
  contenders: LastAdminContender[];
  /** A further contender on a different users collection in the same store (for the scoping scenario). */
  contenderFor(collection: string): Promise<LastAdminContender>;
}

export type LastAdminHarnessFactory = (options: {
  /** A users-collection slug no other test has used, so a persistent shared store needs no cleanup. */
  collection: string;
  /** How many independent contenders to build (each over its own adapter instance). */
  parties: number;
  /** Wrap every contender's database with `gate.wrap(...)`. */
  gate: WriteGate;
}) => Promise<LastAdminHarness>;

type Operation = 'demote' | 'delete';

function isLastAdminRefusal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { reason?: unknown }).reason === 'last-admin'
  );
}

/** Classifies settled results as applied or last-admin-refused; anything else (a timeout, a DB error) fails the test loudly. */
function tally(results: PromiseSettledResult<unknown>[]): { applied: number; refused: number } {
  let applied = 0;
  let refused = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') applied++;
    else if (isLastAdminRefusal(result.reason)) refused++;
    else throw result.reason;
  }
  return { applied, refused };
}

const TEST_TIMEOUT_MS = 30_000;
let collectionCounter = 0;

/**
 * Two (or three) independent `UsersCollectionAuthAdapter` instances race conflicting last-admin
 * mutations against one store, with a {@link WriteGate} guaranteeing both have finished everything they
 * do *before* writing when either write lands. The invariant under test: a users collection with at
 * least one admin never reaches zero admins.
 *
 * The control test first proves the gate is capable of catching the bug: a naive count-then-write
 * runs through the same gate and *does* strand the collection with zero admins. Every other test
 * would pass vacuously if the harness could not do that.
 */
export function runLastAdminConcurrencyContractTests(setup: LastAdminHarnessFactory) {
  describe('users-collection last-admin concurrency (spec 059)', () => {
    async function prepare(parties: number) {
      const collection = `last_admin_${++collectionCounter}`;
      const gate = createWriteGate();
      const harness = await setup({ collection, parties, gate });
      const [first] = harness.contenders;
      if (!first || harness.contenders.length !== parties) {
        throw new Error(`setup() must return exactly ${parties} contenders`);
      }

      async function seed(index: number, role: Role): Promise<string> {
        const result = await first!.users.createUser({
          email: `user${index}@example.com`,
          password: 'password123',
          role
        });
        if (!result.ok) throw new Error(`could not seed ${role} ${index}: ${result.reason}`);
        return result.user.id;
      }
      const adminCount = () => first.database.count(collection, { role: 'admin' });
      const roleOf = async (id: string) => (await first.database.findById(collection, id))?.role;

      return {
        collection,
        gate,
        harness,
        contenders: harness.contenders,
        seed,
        adminCount,
        roleOf
      };
    }

    it(
      'control: a naive count-then-write, held at the same gate, strands the collection with zero admins',
      async () => {
        const { collection, gate, contenders, seed, adminCount } = await prepare(2);
        const a = await seed(0, 'admin');
        const b = await seed(1, 'admin');

        // The pre-spec-059 shape: read the count, decide in JavaScript, write unconditionally.
        const naiveDemote = async (contender: LastAdminContender, id: string) => {
          if ((await contender.database.count(collection, { role: 'admin' })) <= 1) {
            throw new Error('would remove the last admin');
          }
          await contender.database.update(collection, id, { role: 'editor' });
        };

        gate.arm(2);
        try {
          const results = await Promise.allSettled([
            naiveDemote(contenders[0]!, a),
            naiveDemote(contenders[1]!, b)
          ]);
          expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
          expect(await adminCount()).toBe(0);
        } finally {
          gate.disarm();
        }
      },
      TEST_TIMEOUT_MS
    );

    const conflicts: [Operation, Operation][] = [
      ['demote', 'demote'],
      ['delete', 'delete'],
      ['delete', 'demote'],
      ['demote', 'delete']
    ];

    it.each(conflicts)(
      'two admins racing to leave (%s / %s): exactly one succeeds, one admin remains',
      async (opA, opB) => {
        const { collection, gate, contenders, seed, adminCount, roleOf } = await prepare(2);
        const a = await seed(0, 'admin');
        const b = await seed(1, 'admin');
        const run = (contender: LastAdminContender, op: Operation, id: string) =>
          op === 'demote'
            ? contender.users.updateUser(id, { role: 'editor' })
            : contender.users.deleteUser(id);

        gate.arm(2);
        try {
          const results = await Promise.allSettled([
            run(contenders[0]!, opA, a),
            run(contenders[1]!, opB, b)
          ]);

          // Every party reached the database's decision — nothing short-circuited before the write.
          expect(gate.arrivals).toBe(2);
          expect(tally(results)).toEqual({ applied: 1, refused: 1 });
        } finally {
          gate.disarm();
        }

        expect(await adminCount()).toBe(1);
        // The refused party's target is untouched, not half-changed.
        const survivor = (await roleOf(a)) === 'admin' ? a : b;
        expect(await roleOf(survivor)).toBe('admin');
        expect(await contenders[0]!.database.findById(collection, survivor)).not.toBeNull();

        // ...and the survivor is still protected afterwards.
        await expect(contenders[0]!.users.deleteUser(survivor)).rejects.toMatchObject({
          reason: 'last-admin'
        });
        expect(await adminCount()).toBe(1);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'three admins racing to leave: exactly two succeed, one stays',
      async () => {
        const { gate, contenders, seed, adminCount } = await prepare(3);
        const ids = [await seed(0, 'admin'), await seed(1, 'admin'), await seed(2, 'admin')];

        gate.arm(3);
        try {
          const results = await Promise.allSettled(
            ids.map((id, i) => contenders[i]!.users.updateUser(id, { role: 'editor' }))
          );
          expect(tally(results)).toEqual({ applied: 2, refused: 1 });
        } finally {
          gate.disarm();
        }
        expect(await adminCount()).toBe(1);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'does not over-block: an admin leaving concurrently with a non-admin being deleted both succeed',
      async () => {
        const { gate, contenders, seed, adminCount } = await prepare(2);
        const a = await seed(0, 'admin');
        await seed(1, 'admin');
        const viewer = await seed(2, 'viewer');

        gate.arm(2);
        try {
          const results = await Promise.allSettled([
            contenders[0]!.users.updateUser(a, { role: 'editor' }),
            contenders[1]!.users.deleteUser(viewer)
          ]);
          expect(tally(results)).toEqual({ applied: 2, refused: 0 });
        } finally {
          gate.disarm();
        }
        expect(await adminCount()).toBe(1);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'a role update that keeps admin is never held back, even for the sole admin',
      async () => {
        const { contenders, seed, adminCount, roleOf } = await prepare(1);
        const only = await seed(0, 'admin');

        await expect(
          contenders[0]!.users.updateUser(only, { role: 'admin' })
        ).resolves.not.toBeNull();
        expect(await roleOf(only)).toBe('admin');
        expect(await adminCount()).toBe(1);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'is scoped to its own users collection: other collections’ admins never satisfy the floor',
      async () => {
        const { collection, harness, contenders, seed, adminCount } = await prepare(1);
        const sole = await seed(0, 'admin');

        const sibling = await harness.contenderFor(`${collection}_staff`);
        await sibling.users.createUser({ email: 's0@example.com', password: 'password123' }); // bootstraps admin
        await sibling.users.createUser({
          email: 's1@example.com',
          password: 'password123',
          role: 'admin'
        });

        // `collection` has exactly one admin, however many admins the sibling collection has.
        await expect(contenders[0]!.users.deleteUser(sole)).rejects.toMatchObject({
          reason: 'last-admin'
        });
        await expect(
          contenders[0]!.users.updateUser(sole, { role: 'viewer' })
        ).rejects.toMatchObject({
          reason: 'last-admin'
        });
        expect(await adminCount()).toBe(1);
        expect(await sibling.database.count(`${collection}_staff`, { role: 'admin' })).toBe(2);
      },
      TEST_TIMEOUT_MS
    );
  });
}
