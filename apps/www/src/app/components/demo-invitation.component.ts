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
        <h2 id="demo-invitation-title">From a collection<br />to a real experience.</h2>
        <p>
          Meet Lumea, a clinic built on ForgeCMS. Explore the public site, follow the editor
          journey, or see how its Angular application fits together.
        </p>
        <a voltButton routerLink="/demo">Meet the demo <lmn-arrow-right [size]="16" /></a>
      </div>
    </section>
  `
})
export class DemoInvitationComponent {}
