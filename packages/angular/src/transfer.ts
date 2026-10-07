import { ApplicationRef, Injectable, PLATFORM_ID, TransferState, inject } from '@angular/core';
import { publicTransferPolicy } from './credentials.js';

/**
 * Public result transfer (spec 080, roadmap S02). Internal — not exported from `index.ts`.
 *
 * A resource created with `{ transfer: 'public' }` writes its **successful** value into Angular's
 * `TransferState` during SSR, and the first browser render reads it back instead of repeating the request.
 * The state belongs to one server-generated document and its first hydration: the browser window closes
 * when the application first becomes stable, and every Forge entry is removed from the store then. It is
 * not a cache — `reload()`, a changed key, a later route or a full page load all perform real reads.
 */
const PREFIX = 'forge:public:';

/** The transfer key of one logical read: identical on the server and in the browser. */
export function publicTransferKey(namespace: string, kind: string, requestKey: string): string {
  return `${PREFIX}${JSON.stringify([namespace, kind, requestKey])}`;
}

@Injectable({ providedIn: 'root' })
export class ForgePublicTransfer {
  private readonly state = inject(TransferState);
  private readonly server = inject(PLATFORM_ID) === 'server';
  private open = false;

  constructor() {
    if (this.server) return;
    const app = inject(ApplicationRef);
    // Open only while the first render is still settling; already stable means "not the first hydration".
    let stable = false;
    app.isStable.subscribe((value) => (stable = value)).unsubscribe();
    if (stable) {
      this.close();
      return;
    }
    this.open = true;
    void app.whenStable().then(() => this.close());
  }

  /** `true` while this browser application may still consume transferred state. */
  get hydrating(): boolean {
    return this.open;
  }

  /** Server only: stores one successful value. */
  put(key: string, value: unknown): void {
    if (this.server) this.state.set(key as never, value as never);
  }

  /** Browser only: the transferred value of `key` during the hydration window, else `undefined`. */
  read(key: string): { value: unknown } | undefined {
    if (this.server || !this.open || !this.state.hasKey(key as never)) return undefined;
    return { value: this.state.get(key as never, undefined as never) };
  }

  private close(): void {
    this.open = false;
    if (this.server) return;
    let keys: string[] = [];
    try {
      keys = Object.keys(JSON.parse(this.state.toJson()) as Record<string, unknown>);
    } catch {
      return;
    }
    for (const key of keys) if (key.startsWith(PREFIX)) this.state.remove(key as never);
  }
}

/** The transfer binding of one resource, or a `TypeError` when its client is not anonymous. */
export function bindPublicTransfer(
  owner: object,
  kind: string,
  transfer: ForgePublicTransfer
): {
  hydrating: boolean;
  keyOf(requestKey: string): string;
} {
  const policy = publicTransferPolicy(owner);
  if (!policy.eligible) {
    throw new TypeError(
      "ForgeCMS: { transfer: 'public' } needs an anonymous client — provideForgeCms({ credentials: 'omit' }) without authToken, and no forwarded Authorization during SSR"
    );
  }
  return {
    hydrating: transfer.hydrating,
    keyOf: (requestKey) => publicTransferKey(policy.namespace, kind, requestKey)
  };
}
