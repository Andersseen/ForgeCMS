import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { VoltAlert, VoltAlertDescription, VoltAlertTitle } from '@voltui/components';
import { DemoPolicyService } from '../services/demo-policy.service';

/**
 * The shared-demo notice (spec 098). Renders nothing in the maintainer / local demo, and in the
 * hosted one explains — before anyone hits a refusal — what can be done and what is intentionally
 * limited. Says explicitly that a real ForgeCMS project has none of these limits.
 */
@Component({
  selector: 'lumea-demo-notice',
  standalone: true,
  imports: [VoltAlert, VoltAlertTitle, VoltAlertDescription],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (demo.policy(); as policy) {
      @if (policy.mode === 'public') {
        <volt-alert variant="info" role="status" data-demo-notice>
          <volt-alert-title>Shared demo</volt-alert-title>
          <volt-alert-description>
            <p>
              Content editing is intentionally limited here so the hosted example stays available
              for everyone. The full ForgeCMS feature set is available when you run your own project
              &mdash; those limits belong to this demo, not to ForgeCMS.
            </p>
            <div class="mt-3 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <p class="font-medium text-foreground">You can</p>
                <ul class="mt-1 list-disc space-y-0.5 pl-4">
                  @for (item of policy.editable; track item) {
                    <li>{{ item }}</li>
                  }
                </ul>
              </div>
              <div>
                <p class="font-medium text-foreground">Limited in this demo</p>
                <ul class="mt-1 list-disc space-y-0.5 pl-4">
                  @for (item of policy.restricted; track item) {
                    <li>{{ item }}</li>
                  }
                </ul>
              </div>
            </div>
          </volt-alert-description>
        </volt-alert>
      }
    }
  `
})
export class DemoNoticeComponent implements OnInit {
  protected readonly demo = inject(DemoPolicyService);

  ngOnInit(): void {
    this.demo.load();
  }
}
