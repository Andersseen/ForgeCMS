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
import { SiteLocaleService } from '../../i18n/site-locale.service';
import { localizePath } from '../../i18n/site-locales.mjs';
import { SiteHeadService } from '../../site-head.service';
import { docsGroupLabel } from './docs-groups';
import { activeStageIndex } from '../../showcase-data';
import {
  collectOutline,
  enhanceCodeBlocks,
  type CodeBlockLabels,
  type OutlineItem
} from './docs-enhance';
import {
  buildDocsNav,
  findAdjacent,
  flattenDocsNav,
  isDocsFile,
  isLocalizedDocsFile,
  localizeDocsNav,
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
 *
 * Spec 101: under `/es/docs/:slug` and `/uk/docs/:slug` the article is read from
 * `src/content/<locale>/docs/<slug>.md` only — never the English file, so a translated URL can never
 * show English prose. A slug that exists in English but not in the locale gets an honest notice
 * linking to the English article (noindex, 404); an unknown slug is a 404 in every locale.
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

          <nav class="forge-docs-pager" [attr.aria-label]="t('docs.pagination')">
            @if (adjacent().prev; as prev) {
              <a [routerLink]="prev.path ?? '/docs/' + prev.slug" rel="prev">
                <span>{{ t('docs.previous') }}</span>
                <strong>{{ prev.title }}</strong>
              </a>
            } @else {
              <span></span>
            }
            @if (adjacent().next; as next) {
              <a [routerLink]="next.path ?? '/docs/' + next.slug" rel="next" class="is-next">
                <span>{{ t('docs.next') }}</span>
                <strong>{{ next.title }}</strong>
              </a>
            }
          </nav>
        </article>

        @if (outline().length > 1) {
          <aside class="forge-docs-outline">
            <nav [attr.aria-label]="t('docs.onThisPage')">
              <p>{{ t('docs.onThisPage') }}</p>
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
      @if (untranslated()) {
        <article class="forge-docs-article">
          <h1>{{ t('docs.untranslatedTitle') }}</h1>
          <p class="forge-docs-lede">{{ t('docs.untranslatedBody') }}</p>
          <a [routerLink]="englishPath()" hreflang="en">{{ t('docs.readInEnglish') }}</a>
        </article>
      } @else {
        <article class="forge-docs-article">
          <h1>{{ t('docs.notFoundTitle') }}</h1>
          <p class="forge-docs-lede">{{ t('docs.notFoundBody') }}</p>
          <a [routerLink]="site.docsPath('introduction')">{{ t('docs.goToIntroduction') }}</a>
        </article>
      }
    }
  `
})
export class DocsArticlePage {
  protected readonly site = inject(SiteLocaleService);
  protected readonly t = this.site.i18n.t;
  private readonly head = inject(SiteHeadService);
  private readonly locale = this.site.locale();
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  private readonly platformId = inject(PLATFORM_ID);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly englishGroups = buildDocsNav(injectContentFiles<DocsFrontmatter>(isDocsFile));
  private readonly groups = localizeDocsNav(
    this.englishGroups,
    this.locale === 'en'
      ? injectContentFiles<DocsFrontmatter>(isDocsFile)
      : injectContentFiles<DocsFrontmatter>((file) => isLocalizedDocsFile(file, this.locale)),
    (slug, translated) => localizePath(`/docs/${slug}`, translated ? this.locale : 'en')
  );
  private readonly links = flattenDocsNav(this.groups);
  private readonly route = inject(ActivatedRoute);
  private readonly slug = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap
  });

  protected readonly doc = toSignal(
    injectContent<DocsFrontmatter>({
      subdirectory: this.locale === 'en' ? 'docs' : `${this.locale}/docs`,
      param: 'slug'
    })
  );
  /** Analog hands back a placeholder (no title) for a file that does not exist: not an article. */
  private readonly found = computed(() => {
    const page = this.doc();
    const slug = this.slug().get('slug') ?? '';
    return page?.attributes.title !== undefined && this.site.hasDoc(slug) ? page : undefined;
  });
  /** One entry per page, keyed by slug, so each navigation re-creates the article and its entrance. */
  protected readonly pages = computed(() => {
    const page = this.found();
    return page ? [page] : [];
  });
  /** The slug exists in English but has no translation in this locale. */
  protected readonly untranslated = computed(() => {
    const slug = this.slug().get('slug') ?? '';
    return !this.site.hasDoc(slug) && this.site.hasDoc(slug, 'en');
  });
  protected readonly englishPath = computed(() =>
    localizePath(`/docs/${this.slug().get('slug') ?? ''}`, 'en')
  );

  protected readonly title = computed(
    () => this.found()?.attributes.title ?? this.t('docs.notFoundTitle')
  );
  protected readonly group = computed(() => {
    const heading = this.groups.find((group) =>
      group.links.some((link) => link.slug === this.found()?.slug)
    )?.heading;
    return heading === undefined ? undefined : docsGroupLabel(this.t, heading);
  });
  protected readonly adjacent = computed(() => findAdjacent(this.links, this.found()?.slug ?? ''));
  private readonly codeLabels: CodeBlockLabels = {
    code: this.t('docs.code'),
    terminal: this.t('docs.terminal'),
    copy: this.t('common.copy'),
    copied: this.t('common.copied'),
    copyFallback: this.t('docs.copyFallback'),
    copyCode: (language) => this.t('docs.copyCode', { language })
  };

  protected readonly outline = signal<OutlineItem[]>([]);
  protected readonly activeSection = signal(0);
  protected readonly enter = { opacity: [0, 1], y: [10, 0] };

  constructor() {
    // Decided from the slug, not from the (asynchronous) markdown: an unknown slug, or one with no
    // translation in this locale, is a real 404 that is never indexed.
    const requested = this.route.snapshot.paramMap.get('slug') ?? '';
    if (!this.site.hasDoc(requested) && this.responseInit) this.responseInit.status = 404;

    effect(() => {
      if (!this.site.hasDoc(this.slug().get('slug') ?? '')) {
        this.titleService.setTitle(this.t('seo.docsNotFound'));
        this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
        return;
      }
      const page = this.found();
      if (!page) return;

      this.titleService.setTitle(this.t('seo.docsTitle', { title: this.title() }));
      const description = page.attributes.description;
      if (description) this.meta.updateTag({ name: 'description', content: description });
      this.head.syncSharing();
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
        enhanceCodeBlocks(prose, copy, this.codeLabels);
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
