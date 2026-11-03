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
import { injectT } from '@etyma/angular';
import { exampleCode, showcasePost, showcaseResponse } from '../landing-data';
import { i18n } from '../i18n/i18n';

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
      [attr.aria-label]="t('showcase.label')"
      [move]="{ opacity: [0, 1] }"
      moveDuration="450"
    >
      <volt-tabs [value]="selected()" (valueChange)="select($event)">
        <div class="forge-showcase-toolbar">
          <div class="forge-showcase-brand">
            <img src="/logo.svg" alt="" width="26" height="26" /><span
              >ForgeCMS
              <span class="forge-showcase-project">{{ t('showcase.project') }}</span></span
            >
          </div>
          <volt-tabs-list [attr.aria-label]="t('showcase.views')" class="forge-showcase-tabs">
            <volt-tabs-trigger value="schema"
              ><lmn-code-bracket [size]="16" /> {{ t('showcase.tabs.schema') }}</volt-tabs-trigger
            >
            <volt-tabs-trigger value="content"
              ><lmn-document-text [size]="16" /> {{ t('showcase.tabs.content') }}</volt-tabs-trigger
            >
            <volt-tabs-trigger value="api"
              ><lmn-circle-stack [size]="16" /> {{ t('showcase.tabs.api') }}</volt-tabs-trigger
            >
          </volt-tabs-list>
        </div>
        <div class="forge-showcase-body">
          <aside class="forge-showcase-sidebar" [attr.aria-label]="t('showcase.context')">
            <span class="forge-sidebar-caption">{{ t('showcase.workspace') }}</span>
            <div class="forge-sidebar-item forge-sidebar-selected">
              <lmn-document-text [size]="16" /> {{ t('showcase.posts') }} <span>1</span>
            </div>
            <div class="forge-sidebar-item">
              <lmn-circle-stack [size]="16" /> {{ t('showcase.media') }}
            </div>
            <div class="forge-sidebar-item">
              <lmn-code-bracket [size]="16" /> {{ t('showcase.globals') }}
            </div>
            <div class="forge-sidebar-bottom">
              <span class="forge-preview-dot"></span> {{ t('common.illustrativePreview') }}
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
                    <pre
                      tabindex="0"
                      [attr.aria-label]="t('showcase.collectionExample')"
                    ><code>{{ code }}</code></pre>
                    <div class="forge-schema-note">
                      <lmn-code-bracket [size]="32" />
                      <h2>
                        {{ t('showcase.schemaTitle.0') }}<br />&#32;{{
                          t('showcase.schemaTitle.1')
                        }}
                      </h2>
                      <p>{{ t('showcase.schemaBody') }}</p>
                      <span class="forge-inline-proof">{{ t('showcase.schemaProof') }}</span>
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
                    <span>{{ t('showcase.posts') }} / {{ post.title }}</span
                    ><volt-badge variant="secondary">{{ t('showcase.readOnly') }}</volt-badge>
                  </div>
                  <div class="forge-content-layout">
                    <div>
                      <div class="forge-editor-heading">
                        <h2>{{ post.title }}</h2>
                        <volt-badge variant="secondary">{{ t('showcase.published') }}</volt-badge>
                      </div>
                      <dl class="forge-preview-fields">
                        <div>
                          <dt>{{ t('showcase.fields.title') }}</dt>
                          <dd>{{ post.title }}</dd>
                        </div>
                        <div>
                          <dt>{{ t('showcase.fields.slug') }}</dt>
                          <dd>{{ post.slug }}</dd>
                        </div>
                        <div>
                          <dt>{{ t('showcase.fields.author') }}</dt>
                          <dd>{{ post.author }}</dd>
                        </div>
                      </dl>
                    </div>
                    <aside class="forge-editor-note">
                      <lmn-document-text [size]="32" />
                      <h3>
                        {{ t('showcase.editorTitle.0') }}<br />&#32;{{
                          t('showcase.editorTitle.1')
                        }}
                      </h3>
                      <p>{{ t('showcase.editorBody') }}</p>
                      <span>{{ t('common.illustrativePreview') }}</span>
                    </aside>
                  </div>
                </div>
              }
            </volt-tabs-content>
            <volt-tabs-content value="api" class="forge-showcase-panel">
              @if (selected() === 'api') {
                <div class="forge-showcase-view" [move]="{ opacity: [0, 1] }" moveDuration="180">
                  <div class="forge-panel-heading">
                    <span>GET /api/v1/posts/post_angular</span
                    ><span>{{ t('showcase.exampleResponse') }}</span>
                  </div>
                  <div class="forge-schema-view">
                    <pre
                      tabindex="0"
                      [attr.aria-label]="t('showcase.exampleResponseLabel')"
                    ><code>{{ response }}</code></pre>
                    <div class="forge-schema-note">
                      <lmn-circle-stack [size]="32" />
                      <h2>
                        {{ t('showcase.apiTitle.0') }}<br />&#32;{{ t('showcase.apiTitle.1') }}
                      </h2>
                      <p>{{ t('showcase.apiBody') }}</p>
                      <span class="forge-inline-proof">{{ t('showcase.apiProof') }}</span>
                    </div>
                  </div>
                </div>
              }
            </volt-tabs-content>
          </div>
        </div>
        <div class="forge-showcase-flow">
          <span>{{ t('showcase.flow.schema') }}</span
          ><lmn-arrow-right [size]="16" /><span>{{ t('showcase.flow.admin') }}</span
          ><lmn-arrow-right [size]="16" /><span>{{ t('showcase.flow.app') }}</span
          ><span class="forge-flow-caption">{{ t('showcase.flow.caption') }}</span>
        </div>
      </volt-tabs>
    </section>
  `
})
export class ProductShowcaseComponent {
  protected readonly t = injectT(i18n);
  protected readonly selected = signal<'schema' | 'content' | 'api'>('schema');
  protected readonly code = exampleCode;
  protected readonly post = showcasePost;
  protected readonly response = showcaseResponse;

  protected select(value: string | undefined): void {
    if (value === 'schema' || value === 'content' || value === 'api') this.selected.set(value);
  }
}
