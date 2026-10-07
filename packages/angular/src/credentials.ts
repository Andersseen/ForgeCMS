import { computed, signal } from '@angular/core';
import type { Signal } from '@angular/core';

/**
 * The credential boundary of one `CmsApiService` (spec 077, roadmap C03). Internal — not exported from
 * `index.ts`. Resources compare its {@link revision} to know whether a result still belongs to the identity
 * the browser currently presents; `ForgeAuthSession` calls {@link invalidate} at every identity change it
 * controls (login, signup, logout, expiry).
 *
 * The revision also follows a **reactive** `authToken` function: reading a signal inside it makes a token
 * change a credential change. A token read from non-reactive storage cannot be observed. The revision is
 * an opaque object compared by reference; the token itself is never exposed.
 */
export class ForgeCredentialBoundary {
  private readonly epoch = signal(0);

  readonly revision: Signal<object>;

  constructor(token: () => string | null) {
    // `equal` keeps the previous object for the same epoch and token, so `===` means "same identity".
    this.revision = computed(() => ({ epoch: this.epoch(), token: token() }), {
      equal: (a, b) => a.epoch === b.epoch && a.token === b.token
    });
  }

  invalidate(): void {
    this.epoch.update((epoch) => epoch + 1);
  }
}

const boundaries = new WeakMap<object, ForgeCredentialBoundary>();

/** Called once by `CmsApiService`'s constructor. */
export function registerCredentialBoundary(owner: object, token: () => string | null): void {
  boundaries.set(owner, new ForgeCredentialBoundary(token));
}

/**
 * Whether one `CmsApiService` is anonymous by construction, and the logical namespace of its API
 * (spec 080). Internal. `eligible` is `false` whenever the client carries or may carry identity.
 */
export interface PublicTransferPolicy {
  eligible: boolean;
  /** The configured content base — identical on server and browser (never the resolved server origin). */
  namespace: string;
}

const transferPolicies = new WeakMap<object, PublicTransferPolicy>();

export function registerPublicTransferPolicy(owner: object, policy: PublicTransferPolicy): void {
  transferPolicies.set(owner, policy);
}

/** Stand-in services (test doubles) never registered one: not eligible. */
export function publicTransferPolicy(owner: object): PublicTransferPolicy {
  return transferPolicies.get(owner) ?? { eligible: false, namespace: '' };
}

/** The boundary of a `CmsApiService` instance. */
export function credentialBoundary(owner: object): ForgeCredentialBoundary {
  let boundary = boundaries.get(owner);
  if (boundary === undefined) {
    // A stand-in service (a test double) never registered one: give it a static boundary.
    boundary = new ForgeCredentialBoundary(() => null);
    boundaries.set(owner, boundary);
  }
  return boundary;
}
