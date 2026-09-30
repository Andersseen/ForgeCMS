import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { VoltNativeButton } from '@voltui/components';
import { LmnArrowPathIcon } from 'lumen-icons/arrow-path';
import { LmnArrowTopRightOnSquareIcon } from 'lumen-icons/arrow-top-right-on-square';

/**
 * The one calm "content unavailable" state every public page shows when its `/api/site/*` request
 * fails (spec 075): visitor copy, a Retry, and a way back to the ForgeCMS demo guide. The technical
 * cause stays in the browser console and the server log, never on the clinic's page.
 */
@Component({
  selector: 'lumea-site-unavailable',
  imports: [VoltNativeButton, LmnArrowPathIcon, LmnArrowTopRightOnSquareIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="status"
      class="max-w-2xl rounded-2xl border border-border bg-card p-7 md:p-9"
      [class.mt-2]="compact()"
    >
      <p class="text-sm font-medium text-muted-foreground">{{ subject() }} is unavailable</p>
      <p class="lumea-display mt-3 text-2xl md:text-3xl">We couldn't load this content.</p>
      <p class="mt-4 leading-relaxed text-muted-foreground">
        The site is still here, but its request to the clinic's CMS did not succeed. Try again in a
        moment.
      </p>
      <div class="mt-7 flex flex-wrap gap-3">
        <button voltButton type="button" (click)="retry.emit()">
          <lmn-arrow-path [size]="16" />
          Retry
        </button>
        <a voltButton variant="outline" href="https://forge-cms.pages.dev/demo" rel="noreferrer">
          ForgeCMS demo guide
          <lmn-arrow-top-right-on-square [size]="16" />
        </a>
      </div>
    </div>
  `
})
export class SiteUnavailable {
  readonly subject = input('The clinic content');
  readonly compact = input(false);
  readonly retry = output();
}
