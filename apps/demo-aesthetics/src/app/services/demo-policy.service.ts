import { Injectable, signal } from '@angular/core';

/** What `GET /api/demo-policy` says about this deployment. */
export interface DemoPolicy {
  mode: 'full' | 'public';
  editable: string[];
  restricted: string[];
}

/**
 * Whether this Lumea is the shared public demo (spec 098). Read once from the server's read-only
 * policy endpoint; any failure means "full", so the admin never hides a capability because a probe
 * failed. The server enforces the policy either way — this only lets the UI explain it beforehand
 * instead of showing a bare 403.
 */
@Injectable({ providedIn: 'root' })
export class DemoPolicyService {
  readonly policy = signal<DemoPolicy | null>(null);
  readonly isPublic = () => this.policy()?.mode === 'public';
  #started = false;

  load(): void {
    if (this.#started) return;
    this.#started = true;
    void this.#fetch();
  }

  async #fetch(): Promise<void> {
    try {
      const response = await fetch('/api/demo-policy', { headers: { accept: 'application/json' } });
      if (!response.ok) return;
      const body = (await response.json()) as { data?: DemoPolicy };
      if (body.data && (body.data.mode === 'public' || body.data.mode === 'full')) {
        this.policy.set(body.data);
      }
    } catch {
      // Unreachable or not JSON: stay in "full" presentation; the server still enforces.
    }
  }
}
