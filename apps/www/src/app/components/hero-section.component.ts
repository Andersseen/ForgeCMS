import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { MoveAnimateDirective, MoveStaggerDirective } from 'angular-movement';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCircleStackIcon } from 'lumen-icons/circle-stack';
import { LmnCodeBracketIcon } from 'lumen-icons/code-bracket';
import { LmnRectangleStackIcon } from 'lumen-icons/rectangle-stack';
import { CURRENT_FORGE_VERSION } from '../forge-release';
import { exampleCode, installCommand } from '../landing-data';

@Component({
  selector: 'forge-cms-hero-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltBadge,
    VoltNativeButton,
    MoveAnimateDirective,
    MoveStaggerDirective,
    LmnArrowRightIcon,
    LmnCircleStackIcon,
    LmnCodeBracketIcon,
    LmnRectangleStackIcon
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="product"
      class="mx-auto grid w-full max-w-7xl gap-14 px-5 pb-22 pt-14 md:px-8 lg:grid-cols-[1.16fr_0.84fr] lg:items-center lg:pb-30 lg:pt-22"
    >
      <!-- min-w-0: a grid item defaults to its min-content width, which let the hero overflow (and be
           clipped) on phones. -->
      <div class="min-w-0">
        <volt-badge variant="secondary">Experimental · pre-1.0 · v{{ version }}</volt-badge>
        <h1 class="forge-display mt-7 max-w-[13ch] text-5xl md:text-7xl lg:text-[5rem]">
          The Angular CMS that stays in your application.
        </h1>
        <p class="mt-7 max-w-[62ch] text-lg leading-8 text-muted-foreground md:text-xl">
          Define content in TypeScript, call it through a Local API, and mount a real Angular admin.
          ForgeCMS runs on Cloudflare D1 and R2 or travels with libSQL.
        </p>

        <div class="mt-9 flex flex-col gap-3 sm:flex-row">
          <a voltButton size="lg" routerLink="/docs/small-project-guide">Start building</a>
          <a voltButton variant="outline" size="lg" routerLink="/demo">Explore the live demo</a>
        </div>

        <div
          class="mt-7 flex max-w-2xl items-center gap-3 border-l-2 border-primary/50 pl-4"
          aria-label="Install command"
        >
          <!-- Wraps between tokens, never inside a package name; copying still yields one command. -->
          <code class="min-w-0 text-sm leading-relaxed text-foreground">
            @for (token of installTokens; track $index) {
              <span class="whitespace-nowrap">{{ token }}</span
              >{{ $last ? '' : ' ' }}
            }
          </code>
        </div>
      </div>

      <section
        class="forge-workbench min-w-0"
        aria-label="How ForgeCMS connects your schema to your admin"
      >
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-[#22D3EE]"></span>
            <span class="text-sm font-medium text-white">Live content pipeline</span>
          </div>
          <span class="font-mono text-xs text-white/45">posts.ts</span>
        </header>

        <div class="p-5 md:p-6">
          <div
            class="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr]"
            moveStagger
            moveStaggerStep="110ms"
          >
            <div class="forge-pipeline-node" [move]="'zoom-in'">
              <lmn-code-bracket tone="info" [size]="20" />
              <div>
                <span>Schema</span>
                <small>TypeScript</small>
              </div>
            </div>
            <lmn-arrow-right class="hidden text-white/35 sm:block" [size]="20" />
            <div class="forge-pipeline-node" [move]="'zoom-in'">
              <lmn-circle-stack tone="primary" [size]="20" />
              <div>
                <span>Runtime</span>
                <small>Local API</small>
              </div>
            </div>
            <lmn-arrow-right class="hidden text-white/35 sm:block" [size]="20" />
            <div class="forge-pipeline-node" [move]="'zoom-in'">
              <lmn-rectangle-stack tone="success" [size]="20" />
              <div>
                <span>Admin</span>
                <small>Angular</small>
              </div>
            </div>
          </div>

          <pre
            class="forge-code mt-5"
            tabindex="0"
            aria-label="Collection example"
          ><code>{{ exampleCode }}</code></pre>

          <div class="mt-5 grid grid-cols-3 border-t border-white/10 pt-5 text-white">
            <div>
              <span class="forge-workbench-value">10</span>
              <small>packages</small>
            </div>
            <div>
              <span class="forge-workbench-value">2</span>
              <small>database profiles</small>
            </div>
            <div>
              <span class="forge-workbench-value">MIT</span>
              <small>license</small>
            </div>
          </div>
        </div>
      </section>
    </section>
  `
})
export class HeroSectionComponent {
  protected readonly exampleCode = exampleCode;
  protected readonly installTokens = installCommand.split(' ');
  protected readonly version = CURRENT_FORGE_VERSION;
}
