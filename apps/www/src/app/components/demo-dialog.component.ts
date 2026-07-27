import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltButton } from '@voltui/components';
import {
  DEMO_ADMIN_URL,
  DEMO_APP_URL,
  DEMO_CREDENTIALS,
  DEMO_SOURCE_URL,
  DEVELOPER_STEPS,
  EDITOR_STEPS
} from '../demo-access';
import { DemoDialogService } from './demo-dialog.service';

type Audience = 'editor' | 'developer';

/**
 * The dialog between "try the demo" and the demo itself.
 *
 * A CMS has two audiences that need completely different first five minutes: someone who will only
 * ever use the UI, and a developer deciding whether the model is sound. Dropping both straight into
 * an admin panel tells neither of them what to look at — so this asks which one they are and gives
 * them a short script.
 */
@Component({
  selector: 'forge-cms-demo-dialog',
  standalone: true,
  imports: [RouterLink, VoltButton, VoltBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialog.isOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10"
        (click)="dialog.close()"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-dialog-title"
          class="w-full max-w-2xl rounded-xl border border-border bg-background shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <header class="flex items-start justify-between gap-4 border-b border-border p-6">
            <div>
              <volt-badge variant="secondary">Live demo</volt-badge>
              <h2 id="demo-dialog-title" class="mt-3 text-2xl font-semibold">
                Lumea Aesthetics — a clinic running on ForgeCMS
              </h2>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">
                A fictional skin clinic: a public marketing site, and the CMS its staff use to run
                it. Nothing on the site is hardcoded — the treatments, prices, team, journal and
                even the home page layout are content.
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close"
              (click)="dialog.close()"
            >
              ✕
            </button>
          </header>

          <div class="p-6">
            <p class="text-sm font-medium">What brings you here?</p>
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                class="rounded-lg border p-3 text-left transition-colors"
                [class]="audience() === 'editor' ? selectedClass : unselectedClass"
                (click)="audience.set('editor')"
              >
                <span class="block text-sm font-medium">I want to see the CMS</span>
                <span class="mt-1 block text-xs text-muted-foreground">
                  Publish something and watch the site change.
                </span>
              </button>
              <button
                type="button"
                class="rounded-lg border p-3 text-left transition-colors"
                [class]="audience() === 'developer' ? selectedClass : unselectedClass"
                (click)="audience.set('developer')"
              >
                <span class="block text-sm font-medium">I'm an Angular developer</span>
                <span class="mt-1 block text-xs text-muted-foreground">
                  Show me the model, the API and the code.
                </span>
              </button>
            </div>

            <ol class="mt-6 space-y-4">
              @for (step of steps(); track step.title; let index = $index) {
                <li class="flex gap-3">
                  <span
                    class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                  >
                    {{ index + 1 }}
                  </span>
                  <div>
                    <p class="text-sm font-medium">{{ step.title }}</p>
                    <p class="mt-0.5 text-sm leading-6 text-muted-foreground">{{ step.detail }}</p>
                  </div>
                </li>
              }
            </ol>

            @if (audience() === 'editor') {
              <div class="mt-6 rounded-lg border border-border bg-muted/50 p-4">
                <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Sign in with
                </p>
                <ul class="mt-2 space-y-1 text-sm">
                  @for (account of credentials; track account.email) {
                    <li>
                      <span class="text-muted-foreground">{{ account.role }} —</span>
                      <span class="font-mono">{{ account.email }}</span>
                      <span class="text-muted-foreground"> / </span>
                      <span class="font-mono">{{ account.password }}</span>
                    </li>
                  }
                </ul>
                <p class="mt-3 text-xs text-muted-foreground">
                  Everyone shares one demo database and it resets periodically, so feel free to
                  break things.
                </p>
              </div>
            } @else {
              <div class="mt-6 rounded-lg border border-border bg-muted/50 p-4">
                <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Read these three files
                </p>
                <ul class="mt-2 space-y-1 font-mono text-xs leading-6">
                  <li>apps/demo-aesthetics/src/server/api/collections.ts</li>
                  <li>apps/demo-aesthetics/src/server/routes/api/site/home.get.ts</li>
                  <li>apps/demo-aesthetics/src/tests/content-model.test.ts</li>
                </ul>
                <p class="mt-3 text-xs text-muted-foreground">
                  docs/DEMO-FINDINGS.md is the honest counterpart: everything this CMS could not do
                  when the demo was built, and what has been fixed since.
                </p>
              </div>
            }
          </div>

          <footer class="flex flex-wrap items-center gap-3 border-t border-border p-6">
            <a [href]="primaryUrl()" rel="noreferrer" target="_blank">
              <volt-button size="lg">{{ primaryLabel() }}</volt-button>
            </a>
            <a [href]="secondaryUrl()" rel="noreferrer" target="_blank">
              <volt-button variant="outline" size="lg">{{ secondaryLabel() }}</volt-button>
            </a>
          </footer>
        </div>
      </div>
    }
  `
})
export class DemoDialogComponent {
  protected readonly dialog = inject(DemoDialogService);

  protected readonly audience = signal<Audience>('editor');
  protected readonly steps = computed(() =>
    this.audience() === 'editor' ? EDITOR_STEPS : DEVELOPER_STEPS
  );

  protected readonly credentials = DEMO_CREDENTIALS;

  protected readonly selectedClass = 'border-primary bg-primary/5';
  protected readonly unselectedClass = 'border-border hover:bg-muted';

  // An editor wants the site itself; a developer wants the code. Both get one click, never a
  // checkout: the demo is deployed by CI on every push to main.
  protected readonly primaryUrl = computed(() =>
    this.audience() === 'editor' ? DEMO_APP_URL : DEMO_SOURCE_URL
  );
  protected readonly primaryLabel = computed(() =>
    this.audience() === 'editor' ? 'Open the demo site →' : 'Read the content model →'
  );
  protected readonly secondaryUrl = computed(() =>
    this.audience() === 'editor' ? DEMO_ADMIN_URL : DEMO_APP_URL
  );
  protected readonly secondaryLabel = computed(() =>
    this.audience() === 'editor' ? 'Go straight to the CMS' : 'Open the demo site'
  );
}
