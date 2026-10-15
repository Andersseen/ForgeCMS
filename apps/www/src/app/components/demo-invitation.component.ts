import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowRightIcon } from 'lumen-icons/arrow-right';
import { LmnRectangleStackIcon } from 'lumen-icons/rectangle-stack';

@Component({
  selector: 'forge-cms-demo-invitation',
  standalone: true,
  imports: [RouterLink, VoltNativeButton, LmnArrowRightIcon, LmnRectangleStackIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="forge-demo-invitation" aria-labelledby="demo-invitation-title">
      <div class="forge-demo-art" aria-label="Illustrative Lumea project preview">
        <div class="forge-demo-art-inner">
          <div class="forge-demo-art-header">
            <span>Lumea Aesthetics</span><span>Example project</span>
          </div>
          <div class="forge-demo-art-content">
            <h3>A real site.<br />Real content.</h3>
            <p>
              A clinic website, an editorial workflow and an Angular admin. Connected by ForgeCMS.
            </p>
          </div>
          <div class="forge-demo-art-footer">
            <lmn-rectangle-stack [size]="16" /> Powered by ForgeCMS · Illustrative preview
          </div>
        </div>
      </div>
      <div class="forge-demo-copy">
        <p class="forge-section-mark">The proof</p>
        <h2 id="demo-invitation-title">You build the interface.<br />Your client gets control.</h2>
        <p>
          Lumea is a clinic site built on ForgeCMS. Everything above runs there, against a real
          runtime:
        </p>
        <ul class="forge-demo-proof">
          @for (item of proof; track item) {
            <li>
              {{ item }}
              @if (item === 'Analytics') {
                <span class="forge-experimental-badge ml-1">Experimental</span>
              }
            </li>
          }
        </ul>
        <a voltButton routerLink="/demo">Explore Lumea demo <lmn-arrow-right [size]="16" /></a>
      </div>
    </section>
  `
})
export class DemoInvitationComponent {
  /** What the live demo exercises today (see DEMO_EXPLORE on /demo). */
  protected readonly proof = ['Content', 'Drafts', 'Uploads', 'Roles', 'ES / EN', 'Analytics'];
}
