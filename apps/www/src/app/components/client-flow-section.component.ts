import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  VoltNativeButton,
  VoltTabs,
  VoltTabsContent,
  VoltTabsList,
  VoltTabsTrigger
} from '@voltui/components';
import { MoveAnimateDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import {
  adminRows,
  clientRole,
  developerRole,
  swapSnippets,
  swapStates,
  type SwapStateId
} from '../showcase-data';

/**
 * Spec 097: developer ↔ client. Three user-chosen states pair what the developer writes with what the
 * client sees. In "Publish" the client acts first, so the columns swap sides. Nothing auto-rotates;
 * each panel is complete and readable without its entrance animation.
 */
@Component({
  selector: 'forge-cms-client-flow-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltNativeButton,
    VoltTabs,
    VoltTabsContent,
    VoltTabsList,
    VoltTabsTrigger,
    MoveAnimateDirective,
    LmnArrowRightIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="client-site" class="forge-swap-section" aria-labelledby="client-flow-title">
      <div class="mx-auto w-full max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div class="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p class="forge-section-mark">Developer ↔ client</p>
            <h2 id="client-flow-title" class="forge-section-title mt-5">
              You build the site. They run the content.
            </h2>
          </div>
          <a voltButton variant="outline" class="w-fit" routerLink="/demo">
            See it on a real clinic site
            <lmn-arrow-right [size]="16" />
          </a>
        </div>

        <volt-tabs class="forge-swap" [value]="selected()" (valueChange)="select($event)">
          <volt-tabs-list aria-label="Developer and client views" class="forge-swap-tabs">
            @for (state of states; track state.id) {
              <volt-tabs-trigger [value]="state.id">{{ state.tab }}</volt-tabs-trigger>
            }
          </volt-tabs-list>

          @for (state of states; track state.id) {
            <volt-tabs-content [value]="state.id">
              @if (selected() === state.id) {
                <div class="forge-swap-stage" [class.is-client-first]="state.lead === 'client'">
                  <div
                    class="forge-swap-col forge-swap-dev"
                    [move]="state.lead === 'client' ? fromRight : fromLeft"
                    moveDuration="380ms"
                  >
                    <p class="forge-swap-role">{{ devLabel[state.id] }}</p>
                    <pre
                      class="forge-story-code"
                      tabindex="0"
                    ><code>{{ snippets[state.id] }}</code></pre>
                  </div>

                  <div class="forge-swap-arrow" aria-hidden="true">
                    <span>{{ state.lead === 'client' ? '←' : '→' }}</span>
                  </div>

                  <div
                    class="forge-swap-col forge-swap-client"
                    [move]="state.lead === 'client' ? fromLeft : fromRight"
                    moveDuration="380ms"
                  >
                    <p class="forge-swap-role">{{ clientLabel[state.id] }}</p>
                    @switch (state.id) {
                      @case ('model') {
                        <div
                          class="forge-swap-form"
                          role="group"
                          aria-label="Illustrative admin form"
                        >
                          <div class="forge-swap-form-head">
                            <span>Service</span><span class="forge-locale-chip">ES</span>
                          </div>
                          <div class="forge-swap-field">
                            <span>Title</span>
                            <span class="forge-swap-input">Tratamientos faciales</span>
                          </div>
                          <div class="forge-swap-field">
                            <span>Summary</span>
                            <span class="forge-swap-input"
                              >Cuida tu piel con resultados naturales.</span
                            >
                          </div>
                          <div class="forge-swap-field">
                            <span>Image</span>
                            <span class="forge-swap-input is-file">facial.jpg</span>
                          </div>
                          <div class="forge-swap-form-foot">
                            <span>Draft saved</span><span class="forge-swap-button">Publish</span>
                          </div>
                        </div>
                      }
                      @case ('build') {
                        <div
                          class="forge-swap-adminnav"
                          role="group"
                          aria-label="Illustrative Forge admin"
                        >
                          <p><img src="/logo.svg" alt="" width="16" height="16" /> Forge Admin</p>
                          <ul>
                            <li>Content</li>
                            <li>Media</li>
                            <li>
                              Analytics <span class="forge-experimental-badge">Experimental</span>
                            </li>
                            <li>Users</li>
                          </ul>
                        </div>
                      }
                      @case ('publish') {
                        <div
                          class="forge-swap-publish"
                          role="group"
                          aria-label="Illustrative publish action"
                        >
                          @for (row of rows; track row.title) {
                            <div>
                              <span>{{ row.title }}</span>
                              <span
                                class="forge-status"
                                [class.is-draft]="row.status === 'Draft'"
                                >{{ row.status }}</span
                              >
                            </div>
                          }
                          <p>Skin consultation → <strong>Publish</strong></p>
                        </div>
                      }
                    }
                  </div>
                </div>
                <p class="forge-swap-caption">{{ state.caption }}</p>
              }
            </volt-tabs-content>
          }
        </volt-tabs>

        <div class="forge-swap-roles">
          <div>
            <h3>Developer</h3>
            <ul>
              @for (item of developer; track item) {
                <li>{{ item }}</li>
              }
            </ul>
          </div>
          <div>
            <h3>Client · Forge Admin</h3>
            <ul>
              @for (item of client; track item) {
                <li>
                  {{ item }}
                  @if (item === 'Sees Analytics') {
                    <span class="forge-experimental-badge ml-1">Experimental</span>
                  }
                </li>
              }
            </ul>
          </div>
          <p class="forge-swap-note">
            Editors change content, not layouts. ForgeCMS is not a page builder: your components
            stay yours.
          </p>
        </div>
      </div>
    </section>
  `
})
export class ClientFlowSectionComponent {
  protected readonly states = swapStates;
  protected readonly snippets = swapSnippets;
  protected readonly rows = adminRows;
  protected readonly developer = developerRole;
  protected readonly client = clientRole;
  protected readonly selected = signal<SwapStateId>('model');
  protected readonly fromLeft = { opacity: [0, 1], x: [-24, 0] };
  protected readonly fromRight = { opacity: [0, 1], x: [24, 0] };
  protected readonly devLabel: Record<SwapStateId, string> = {
    model: 'Code-first · you write',
    build: 'Angular site · you build',
    publish: 'Your site · reads published content'
  };
  protected readonly clientLabel: Record<SwapStateId, string> = {
    model: 'Client-friendly · they edit',
    build: 'Forge Admin · they run',
    publish: 'Forge Admin · they publish'
  };

  protected select(value: string | undefined): void {
    const state = swapStates.find((s) => s.id === value);
    if (state) this.selected.set(state.id);
  }
}
