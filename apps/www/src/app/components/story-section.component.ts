import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MoveInViewDirective, MoveStaggerDirective, MoveVariantsDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCheckIcon } from 'lumen-icons/check';
import {
  activeStageIndex,
  adminRows,
  deployProfiles,
  runtimePipeline,
  storySnippets,
  storyStages
} from '../showcase-data';

/**
 * Spec 097: the homepage's main story — Schema → Runtime → Angular → Admin → Deploy.
 *
 * Every stage is a real list item (heading, sentence, visual) in reading order, so the section reads the
 * same with no script, no motion and on a phone. At `lg+` a sticky index marks the stage under the
 * reading line, and the other stages recede through Movement variants. The active stage is plain state
 * from a passive scroll listener that runs only while the section is on screen: nothing intercepts
 * the wheel, touch or keyboard, and nothing scrolls on its own.
 */
@Component({
  selector: 'forge-cms-story-section',
  standalone: true,
  imports: [
    RouterLink,
    MoveInViewDirective,
    MoveStaggerDirective,
    MoveVariantsDirective,
    LmnArrowRightIcon,
    LmnCheckIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="how-it-works" class="forge-story" aria-labelledby="story-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <header class="max-w-3xl">
          <p class="forge-section-mark">How ForgeCMS fits together</p>
          <h2 id="story-title" class="forge-section-title mt-5">
            Everything between your schema and your client’s editor.
          </h2>
          <p class="mt-5 max-w-[52ch] leading-7 text-muted-foreground">
            Five steps from a TypeScript file to a site your client runs. Each one is part of the
            published 1.0 release.
          </p>
        </header>

        <div class="forge-story-grid">
          <nav class="forge-story-index" aria-label="Story stages">
            <div class="forge-story-index-sticky">
              <ol>
                @for (stage of stages; track stage.id; let i = $index) {
                  <li>
                    <a
                      [href]="'#story-' + stage.id"
                      [class.is-active]="active() === i"
                      [attr.aria-current]="active() === i ? 'step' : null"
                    >
                      <span class="forge-story-index-number">{{ stage.index }}</span>
                      <span class="forge-story-index-label">{{ stage.label }}</span>
                      <span class="forge-story-index-kicker">{{ stage.kicker }}</span>
                    </a>
                  </li>
                }
              </ol>
              <div class="forge-story-progress" aria-hidden="true">
                <span [style.transform]="progress()"></span>
              </div>
            </div>
          </nav>

          <ol class="forge-story-steps">
            @for (stage of stages; track stage.id; let i = $index) {
              <li
                class="forge-story-step"
                [id]="'story-' + stage.id"
                [attr.data-stage]="stage.id"
                [attr.data-active]="active() === i ? 'true' : null"
                [moveVariants]="variants"
                [moveVariant]="variantFor(i)"
                (focusin)="focused.set(i)"
                (focusout)="focused.set(null)"
              >
                <div class="forge-story-copy">
                  <p class="forge-story-kicker">
                    <span>{{ stage.index }}</span> {{ stage.label }} · {{ stage.kicker }}
                  </p>
                  <h3>{{ stage.title }}</h3>
                  <p class="forge-story-body">{{ stage.body }}</p>
                </div>

                <div
                  class="forge-story-visual"
                  moveStagger="70ms"
                  [attr.aria-label]="stage.label + ' illustration'"
                  role="group"
                >
                  @switch (stage.id) {
                    @case ('schema') {
                      <div class="forge-story-panel" [moveInView]="reveal">
                        <div class="forge-story-panel-bar">
                          <span>collections/services.ts</span><span>TypeScript</span>
                        </div>
                        <pre
                          class="forge-story-code"
                          tabindex="0"
                        ><code>{{ snippets.schema }}</code></pre>
                      </div>
                      <ul class="forge-story-chips" [moveInView]="reveal">
                        @for (out of schemaOutputs; track out) {
                          <li>{{ out }}</li>
                        }
                      </ul>
                    }
                    @case ('runtime') {
                      <div class="forge-story-panel" [moveInView]="reveal">
                        <div class="forge-story-panel-bar">
                          <span>Local API · server code</span><span>no HTTP hop</span>
                        </div>
                        <pre
                          class="forge-story-code"
                          tabindex="0"
                        ><code>{{ snippets.localApi }}</code></pre>
                      </div>
                      <div class="forge-story-panel forge-story-rest" [moveInView]="reveal">
                        <span class="forge-story-method">REST</span>
                        <code>{{ snippets.rest }}</code>
                      </div>
                      <ol
                        class="forge-story-pipeline"
                        [moveInView]="reveal"
                        aria-label="Shared pipeline"
                      >
                        @for (step of pipeline; track step) {
                          <li>{{ step }}</li>
                        }
                      </ol>
                      <a class="forge-story-link" routerLink="/docs/local-api"
                        >Local API guide <lmn-arrow-right [size]="14"
                      /></a>
                    }
                    @case ('angular') {
                      <div class="forge-story-panel" [moveInView]="reveal">
                        <div class="forge-story-panel-bar">
                          <span>services.page.ts</span><span>&#64;forge-cms/angular</span>
                        </div>
                        <pre
                          class="forge-story-code"
                          tabindex="0"
                        ><code>{{ snippets.angular }}</code></pre>
                      </div>
                      <div class="forge-story-rendered" [moveInView]="reveal">
                        <p>Rendered on the server · hydrated in the browser</p>
                        <div>
                          <span>Tratamientos faciales</span>
                          <span>Depilación láser</span>
                        </div>
                      </div>
                    }
                    @case ('admin') {
                      <div class="forge-story-admin" [moveInView]="reveal">
                        <div class="forge-story-admin-bar">
                          <span
                            ><img src="/logo.svg" alt="" width="16" height="16" /> Forge Admin</span
                          >
                          <span class="forge-locale-chip">ES · EN</span>
                        </div>
                        <div class="forge-story-admin-body">
                          <ul class="forge-story-admin-nav" aria-label="Admin sections">
                            <li class="is-selected">Services</li>
                            <li>Media</li>
                            <li>Users</li>
                          </ul>
                          <ul class="forge-story-admin-rows">
                            @for (row of rows; track row.title) {
                              <li>
                                <span>{{ row.title }}</span>
                                <span
                                  class="forge-status"
                                  [class.is-draft]="row.status === 'Draft'"
                                  >{{ row.status }}</span
                                >
                              </li>
                            }
                          </ul>
                        </div>
                      </div>
                    }
                    @case ('deploy') {
                      <div class="forge-story-profiles">
                        @for (profile of profiles; track profile.name) {
                          <div class="forge-story-profile" [moveInView]="reveal">
                            <p class="forge-story-profile-name">{{ profile.name }}</p>
                            <dl>
                              <div>
                                <dt>Host</dt>
                                <dd>{{ profile.host }}</dd>
                              </div>
                              <div>
                                <dt>Database</dt>
                                <dd>{{ profile.database }}</dd>
                              </div>
                              <div>
                                <dt>Files</dt>
                                <dd>{{ profile.storage }}</dd>
                              </div>
                            </dl>
                            <p class="forge-story-certified">
                              <lmn-check [size]="14" /> Certified from packed artifacts
                            </p>
                          </div>
                        }
                      </div>
                    }
                  }
                </div>
              </li>
            }
          </ol>
        </div>
      </div>
    </section>
  `
})
export class StorySectionComponent {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly stages = storyStages;
  protected readonly snippets = storySnippets;
  protected readonly pipeline = runtimePipeline;
  protected readonly rows = adminRows;
  protected readonly profiles = deployProfiles;
  protected readonly schemaOutputs = [
    'Validation',
    'Storage',
    'REST + Local API',
    'Admin form',
    'Types'
  ];

  /** Calm, short and precise: a receding stage is still readable, just not the subject. */
  protected readonly variants = {
    active: { opacity: 1, scale: 1, duration: 420 },
    idle: { opacity: 0.55, scale: 0.98, duration: 420 }
  };
  protected readonly reveal = { opacity: [0, 1], y: [18, 0] };

  protected readonly active = signal(0);
  protected readonly focused = signal<number | null>(null);
  /** Whether the stateful desktop story applies: wide enough, and motion not reduced. */
  readonly #storytelling = signal(false);

  protected readonly progress = computed(
    () => `scaleY(${(this.active() + 1) / this.stages.length})`
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const view = this.#host.nativeElement.ownerDocument.defaultView;
      if (!view) return;
      const wide = view.matchMedia('(min-width: 1024px)');
      const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
      const syncMode = (): void => this.#storytelling.set(wide.matches && !reduced.matches);
      syncMode();
      wide.addEventListener('change', syncMode);
      reduced.addEventListener('change', syncMode);

      let frame: number | null = null;
      const measure = (): void => {
        frame = null;
        const steps = this.#host.nativeElement.querySelectorAll<HTMLElement>('.forge-story-step');
        const tops = Array.from(steps, (step) => step.getBoundingClientRect().top);
        this.active.set(activeStageIndex(tops, view.innerHeight / 2));
      };
      const onScroll = (): void => {
        frame ??= view.requestAnimationFrame(measure);
      };
      // Listen only while the section is on screen; passive, so scrolling is never delayed or blocked.
      const observer = new IntersectionObserver(([entry]) => {
        if (entry?.isIntersecting) {
          view.addEventListener('scroll', onScroll, { passive: true });
          measure();
        } else {
          view.removeEventListener('scroll', onScroll);
        }
      });
      observer.observe(this.#host.nativeElement);

      destroyRef.onDestroy(() => {
        observer.disconnect();
        view.removeEventListener('scroll', onScroll);
        wide.removeEventListener('change', syncMode);
        reduced.removeEventListener('change', syncMode);
        if (frame !== null) view.cancelAnimationFrame(frame);
      });
    });
  }

  /** Below `lg`, under reduced motion and for a focused stage, every stage is fully present. */
  protected variantFor(index: number): 'active' | 'idle' {
    if (!this.#storytelling()) return 'active';
    return index === this.active() || index === this.focused() ? 'active' : 'idle';
  }
}
