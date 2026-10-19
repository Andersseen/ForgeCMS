import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltBadge, VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnCheckIcon } from 'lumen-icons/check';
import { LmnClipboardIcon } from 'lumen-icons/clipboard';
import { CURRENT_FORGE_VERSION } from '../forge-release';
import { installCommand } from '../landing-data';
import { HeroEmberComponent } from './hero-ember.component';
import { ProductShowcaseComponent } from './product-showcase.component';

@Component({
  selector: 'forge-cms-hero-section',
  standalone: true,
  imports: [
    RouterLink,
    VoltBadge,
    VoltNativeButton,
    LmnArrowRightIcon,
    LmnCheckIcon,
    LmnClipboardIcon,
    HeroEmberComponent,
    ProductShowcaseComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="product" class="forge-product-hero">
      <div class="forge-hero-intro">
        <volt-badge variant="secondary" class="forge-release-badge"
          >Open source · ForgeCMS {{ version }} · stable</volt-badge
        >
        <h1>
          Your content.<br />Your code.<br class="forge-hero-mobile-break" />
          Your Angular.
        </h1>
        <p>
          The code-first headless CMS that feels at home in your Angular application. Model in
          TypeScript, give editors a real Angular admin, and keep the site UI yours.
        </p>
        <div class="forge-hero-actions">
          <a voltButton size="lg" routerLink="/docs/small-project-guide" class="forge-brand-button"
            >Start building <lmn-arrow-right [size]="20"
          /></a>
          <a voltButton variant="outline" size="lg" routerLink="/demo" class="forge-dark-outline"
            >Explore the live demo</a
          >
        </div>
      </div>
      <forge-cms-hero-ember />
      <div class="forge-hero-platforms">
        <span>Angular + Analog</span><span>Cloudflare D1 + R2</span
        ><span>Portable libSQL + S3</span>
      </div>
      <forge-cms-product-showcase />
      <div class="forge-install">
        <div class="forge-install-command" aria-label="Install command">
          <span aria-hidden="true" class="forge-command-prompt">$</span>
          <code>{{ command }}</code>
        </div>
        <button
          voltButton
          variant="ghost"
          size="icon"
          type="button"
          aria-label="Copy install command"
          (click)="copy()"
        >
          @if (copyStatus() === 'Copied') {
            <lmn-check [size]="20" />
          } @else {
            <lmn-clipboard [size]="20" />
          }
        </button>
        <p class="forge-copy-status" role="status">{{ copyStatus() }}</p>
      </div>
      <p class="forge-hero-note">
        MIT licensed. ForgeCMS {{ version }} is published. The 1.0.0-rc.2 candidate remains in
        release history; Agent Kit and Analytics are experimental.
      </p>
    </section>
  `
})
export class HeroSectionComponent {
  protected readonly command = installCommand;
  protected readonly version = CURRENT_FORGE_VERSION;
  protected readonly copyStatus = signal('');

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.command);
      this.copyStatus.set('Copied');
    } catch {
      this.copyStatus.set('Select and copy the command');
    }
  }
}
