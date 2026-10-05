import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  VoltBadge,
  VoltTabs,
  VoltTabsContent,
  VoltTabsList,
  VoltTabsTrigger
} from '@voltui/components';
import { MoveAnimateDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCodeBracketIcon } from 'lumen-icons/code-bracket';
import { LmnDocumentTextIcon } from 'lumen-icons/document-text';
import { LmnCircleStackIcon } from 'lumen-icons/circle-stack';
import { exampleCode, showcasePost, showcaseResponse } from '../landing-data';

@Component({
  selector: 'forge-cms-product-showcase',
  standalone: true,
  imports: [
    VoltBadge,
    VoltTabs,
    VoltTabsContent,
    VoltTabsList,
    VoltTabsTrigger,
    MoveAnimateDirective,
    LmnArrowRightIcon,
    LmnCodeBracketIcon,
    LmnDocumentTextIcon,
    LmnCircleStackIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="forge-showcase"
      aria-label="Explore the ForgeCMS product"
      [move]="{ opacity: [0, 1] }"
      moveDuration="450"
    >
      <volt-tabs [value]="selected()" (valueChange)="select($event)">
        <div class="forge-showcase-toolbar">
          <div class="forge-showcase-brand">
            <img src="/logo.svg" alt="" width="26" height="26" /><span
              >ForgeCMS <span class="forge-showcase-project">/ your next project</span></span
            >
          </div>
          <volt-tabs-list aria-label="Product views" class="forge-showcase-tabs">
            <volt-tabs-trigger value="schema"
              ><lmn-code-bracket [size]="16" /> Schema</volt-tabs-trigger
            >
            <volt-tabs-trigger value="content"
              ><lmn-document-text [size]="16" /> Content</volt-tabs-trigger
            >
            <volt-tabs-trigger value="api"><lmn-circle-stack [size]="16" /> API</volt-tabs-trigger>
          </volt-tabs-list>
        </div>
        <div class="forge-showcase-body">
          <aside class="forge-showcase-sidebar" aria-label="Showcase context">
            <span class="forge-sidebar-caption">Your workspace</span>
            <div class="forge-sidebar-item forge-sidebar-selected">
              <lmn-document-text [size]="16" /> Posts <span>1</span>
            </div>
            <div class="forge-sidebar-item"><lmn-circle-stack [size]="16" /> Media</div>
            <div class="forge-sidebar-item"><lmn-code-bracket [size]="16" /> Globals</div>
            <div class="forge-sidebar-bottom">
              <span class="forge-preview-dot"></span> Illustrative preview
            </div>
          </aside>
          <div class="forge-showcase-panels">
            <volt-tabs-content value="schema" class="forge-showcase-panel">
              @if (selected() === 'schema') {
                <div class="forge-showcase-view" [move]="{ opacity: [0, 1] }" moveDuration="180">
                  <div class="forge-panel-heading">
                    <span>collections / posts.ts</span><span>TypeScript</span>
                  </div>
                  <div class="forge-schema-view">
                    <pre tabindex="0" aria-label="Collection example"><code>{{ code }}</code></pre>
                    <div class="forge-schema-note">
                      <lmn-code-bracket [size]="32" />
                      <h2>Define it once.<br />&#32;Build on it everywhere.</h2>
                      <p>
                        A collection becomes validation, persistence, an API and an Angular editing
                        experience.
                      </p>
                      <span class="forge-inline-proof">No separate schema to keep in sync.</span>
                    </div>
                  </div>
                </div>
              }
            </volt-tabs-content>
            <volt-tabs-content value="content" class="forge-showcase-panel">
              @if (selected() === 'content') {
                <div
                  class="forge-showcase-view forge-content-view"
                  [move]="{ opacity: [0, 1] }"
                  moveDuration="180"
                >
                  <div class="forge-panel-heading">
                    <span>Posts / {{ post.title }}</span
                    ><volt-badge variant="secondary">Read-only preview</volt-badge>
                  </div>
                  <div class="forge-content-layout">
                    <div>
                      <div class="forge-editor-heading">
                        <h2>{{ post.title }}</h2>
                        <volt-badge variant="secondary">Published</volt-badge>
                      </div>
                      <dl class="forge-preview-fields">
                        <div>
                          <dt>Title</dt>
                          <dd>{{ post.title }}</dd>
                        </div>
                        <div>
                          <dt>Slug</dt>
                          <dd>{{ post.slug }}</dd>
                        </div>
                        <div>
                          <dt>Author</dt>
                          <dd>{{ post.author }}</dd>
                        </div>
                      </dl>
                    </div>
                    <aside class="forge-editor-note">
                      <lmn-document-text [size]="32" />
                      <h3>Made for the people<br />&#32;behind the content.</h3>
                      <p>
                        Your model gives editors a familiar place to work. The real admin lives
                        inside your Angular app.
                      </p>
                      <span>Illustrative preview</span>
                    </aside>
                  </div>
                </div>
              }
            </volt-tabs-content>
            <volt-tabs-content value="api" class="forge-showcase-panel">
              @if (selected() === 'api') {
                <div class="forge-showcase-view" [move]="{ opacity: [0, 1] }" moveDuration="180">
                  <div class="forge-panel-heading">
                    <span>GET /api/v1/posts/post_angular</span><span>Example response</span>
                  </div>
                  <div class="forge-schema-view">
                    <pre
                      tabindex="0"
                      aria-label="Example API response"
                    ><code>{{ response }}</code></pre>
                    <div class="forge-schema-note">
                      <lmn-circle-stack [size]="32" />
                      <h2>Your content.<br />&#32;Ready for your app.</h2>
                      <p>
                        Read through REST or call the Local API directly from server code. The same
                        content, wherever you need it.
                      </p>
                      <span class="forge-inline-proof">A typed Angular client is included.</span>
                    </div>
                  </div>
                </div>
              }
            </volt-tabs-content>
          </div>
        </div>
        <div class="forge-showcase-flow">
          <span>TypeScript schema</span><lmn-arrow-right [size]="16" /><span>Angular admin</span
          ><lmn-arrow-right [size]="16" /><span>Your application</span
          ><span class="forge-flow-caption">One connected system</span>
        </div>
      </volt-tabs>
    </section>
  `
})
export class ProductShowcaseComponent {
  protected readonly selected = signal<'schema' | 'content' | 'api'>('schema');
  protected readonly code = exampleCode;
  protected readonly post = showcasePost;
  protected readonly response = showcaseResponse;

  protected select(value: string | undefined): void {
    if (value === 'schema' || value === 'content' || value === 'api') this.selected.set(value);
  }
}
