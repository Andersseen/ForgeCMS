import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { MarkdownComponent, injectContent, injectContentFiles } from '@analogjs/content';
import { VoltButton } from '@voltui/components';
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
 * nothing has to be fetched or parsed here.
 */
@Component({
  selector: 'forge-cms-docs-article',
  standalone: true,
  imports: [MarkdownComponent, RouterLink, VoltButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (doc(); as page) {
      <article>
        <header class="border-b border-border pb-6">
          <h1 class="text-4xl font-semibold tracking-tight text-foreground">{{ title() }}</h1>
          @if (page.attributes.description) {
            <p class="mt-3 text-lg text-muted-foreground">{{ page.attributes.description }}</p>
          }
        </header>

        <analog-markdown class="forge-prose" [content]="page.content" />

        <nav
          class="mt-14 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between"
          aria-label="Pagination"
        >
          @if (adjacent().prev; as prev) {
            <a [routerLink]="['/docs', prev.slug]">
              <volt-button variant="outline">← {{ prev.title }}</volt-button>
            </a>
          } @else {
            <span></span>
          }
          @if (adjacent().next; as next) {
            <a [routerLink]="['/docs', next.slug]">
              <volt-button variant="outline">{{ next.title }} →</volt-button>
            </a>
          }
        </nav>
      </article>
    }
  `
})
export class DocsArticlePage {
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);

  private readonly links = flattenDocsNav(
    buildDocsNav(injectContentFiles<DocsFrontmatter>(isDocsFile))
  );

  protected readonly doc = toSignal(
    injectContent<DocsFrontmatter>({ subdirectory: 'docs', param: 'slug' })
  );

  protected readonly title = computed(() => this.doc()?.attributes.title ?? 'Documentation');

  protected readonly adjacent = computed(() => findAdjacent(this.links, this.doc()?.slug ?? ''));

  constructor() {
    effect(() => {
      const page = this.doc();
      if (!page) return;

      this.titleService.setTitle(`${this.title()} — ForgeCMS docs`);
      const description = page.attributes.description;
      if (description) this.meta.updateTag({ name: 'description', content: description });
    });
  }
}
