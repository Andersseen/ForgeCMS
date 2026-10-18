import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  RESPONSE_INIT,
  afterNextRender,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MarkdownComponent, injectContent, injectContentFiles } from '@analogjs/content';
import { MoveAnimateDirective } from 'angular-movement';
import { activeStageIndex } from '../../showcase-data';
import { collectOutline, enhanceCodeBlocks, type OutlineItem } from './docs-enhance';
import {
  buildDocsNav,
  findAdjacent,
  flattenDocsNav,
  isDocsFile,
  type DocsFrontmatter
} from './docs-nav';

/**
 * One documentation page.
 *
 * The markdown was parsed and syntax-highlighted at build time by Analog's content plugin
 * (`content: { highlighter: 'prism' }` in vite.config.ts), so `injectContent` hands back HTML and
 * nothing has to be fetched or parsed here. Spec 097 adds, in the browser only: a breadcrumb, an
 * "On this page" outline with the current section marked, and copy buttons on code blocks — all
 * progressive, so the article reads the same without them.
 */
@Component({
  selector: 'forge-cms-docs-article',
  standalone: true,
  imports: [MarkdownComponent, RouterLink, MoveAnimateDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (page of pages(); track page.slug) {
      <div class="forge-docs-layout">
        <article class="forge-docs-article" [move]="enter" moveDuration="280ms">
          <header class="forge-docs-header">
            @if (group(); as heading) {
              <p class="forge-section-mark">{{ heading }}</p>
            }
            <h1>{{ title() }}</h1>
            @if (page.attributes.description) {
              <p class="forge-docs-lede">{{ page.attributes.description }}</p>
            }
          </header>

          <analog-markdown class="forge-prose" [content]="page.content" />

          <nav class="forge-docs-pager" aria-label="Pagination">
            @if (adjacent().prev; as prev) {
              <a [routerLink]="['/docs', prev.slug]" rel="prev">
                <span>← Previous</span>
                <strong>{{ prev.title }}</strong>
              </a>
            } @else {
              <span></span>
            }
            @if (adjacent().next; as next) {
              <a [routerLink]="['/docs', next.slug]" rel="next" class="is-next">
                <span>Next →</span>
                <strong>{{ next.title }}</strong>
              </a>
            }
          </nav>
        </article>

        @if (outline().length > 1) {
          <aside class="forge-docs-outline">
            <nav aria-label="On this page">
              <p>On this page</p>
              <ul>
                @for (item of outline(); track item.id; let i = $index) {
                  <li>
                    <a
                      [routerLink]="[]"
                      [fragment]="item.id"
                      [class.is-active]="i === activeSection()"
                      [attr.aria-current]="i === activeSection() ? 'location' : null"
                      >{{ item.text }}</a
                    >
                  </li>
                }
              </ul>
            </nav>
          </aside>
        }
      </div>
    } @empty {
      <article class="forge-docs-article">
        <h1>Documentation page not found</h1>
        <p class="forge-docs-lede">This guide does not exist or may have moved.</p>
        <a routerLink="/docs/introduction">Go to the introduction</a>
      </article>
    }
  `
})
export class DocsArticlePage {
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  private readonly platformId = inject(PLATFORM_ID);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly groups = buildDocsNav(injectContentFiles<DocsFrontmatter>(isDocsFile));
  private readonly links = flattenDocsNav(this.groups);
  private readonly requestedSlug = inject(ActivatedRoute).snapshot.paramMap.get('slug');

  protected readonly doc = toSignal(
    injectContent<DocsFrontmatter>({ subdirectory: 'docs', param: 'slug' })
  );
  /** One entry per page, keyed by slug, so each navigation re-creates the article and its entrance. */
  protected readonly pages = computed(() => {
    const page = this.doc();
    return page ? [page] : [];
  });

  protected readonly title = computed(
    () => this.doc()?.attributes.title ?? 'Documentation page not found'
  );
  protected readonly group = computed(
    () =>
      this.groups.find((group) => group.links.some((link) => link.slug === this.doc()?.slug))
        ?.heading
  );
  protected readonly adjacent = computed(() => findAdjacent(this.links, this.doc()?.slug ?? ''));

  protected readonly outline = signal<OutlineItem[]>([]);
  protected readonly activeSection = signal(0);
  protected readonly enter = { opacity: [0, 1], y: [10, 0] };

  constructor() {
    if (this.requestedSlug && !this.links.some((link) => link.slug === this.requestedSlug)) {
      if (this.responseInit) this.responseInit.status = 404;
      this.titleService.setTitle('Documentation page not found — ForgeCMS');
      this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    }

    effect(() => {
      const page = this.doc();
      if (!page) return;

      this.titleService.setTitle(`${this.title()} — ForgeCMS docs`);
      const description = page.attributes.description;
      if (description) {
        this.meta.updateTag({ name: 'description', content: description });
        this.meta.updateTag({ property: 'og:description', content: description });
        this.meta.updateTag({ name: 'twitter:description', content: description });
      }
      this.meta.updateTag({ property: 'og:title', content: `${this.title()} — ForgeCMS docs` });
      this.meta.updateTag({ name: 'twitter:title', content: `${this.title()} — ForgeCMS docs` });
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const host = this.#host.nativeElement;
      const view = host.ownerDocument.defaultView;
      if (!view) return;
      const copy = (text: string): Promise<void> => view.navigator.clipboard.writeText(text);

      // The markdown arrives after the view renders (and again on every page change): enhance it
      // whenever the article's DOM changes. Enhancement is idempotent, so repeated passes are cheap.
      let frame: number | null = null;
      const refresh = (): void => {
        frame = null;
        const prose = host.querySelector('.forge-prose');
        if (!prose) return;
        enhanceCodeBlocks(prose, copy);
        const next = collectOutline(prose);
        const current = this.outline();
        if (next.map((i) => i.id).join() !== current.map((i) => i.id).join())
          this.outline.set(next);
        measure();
      };
      const schedule = (): void => {
        frame ??= view.requestAnimationFrame(refresh);
      };
      const measure = (): void => {
        const headings = this.outline()
          .map((item) => host.ownerDocument.getElementById(item.id))
          .filter((el): el is HTMLElement => el !== null);
        // The reading line sits near the top: a section is "current" once its heading passes it.
        this.activeSection.set(
          activeStageIndex(
            headings.map((h) => h.getBoundingClientRect().top),
            view.innerHeight * 0.3
          )
        );
      };
      const observer = new MutationObserver(schedule);
      observer.observe(host, { childList: true, subtree: true });
      view.addEventListener('scroll', measure, { passive: true });
      schedule();

      destroyRef.onDestroy(() => {
        observer.disconnect();
        view.removeEventListener('scroll', measure);
        if (frame !== null) view.cancelAnimationFrame(frame);
      });
    });
  }
}
