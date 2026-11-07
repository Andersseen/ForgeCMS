import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { defineRouteMeta } from '@analogjs/router';
import { ActivatedRoute } from '@angular/router';
import {
  StrataDocumentLink,
  strataDocumentNavigationGuard
} from '@strata-sc/server-components/navigation';

import { PostDocumentServerComponent } from '../posts/post-document.server-component';

// SC-NAVIGATION: a later Router activation into this Server Component route is cancelled and retried as a
// real document navigation (there is no SPA transition into a Server Component subtree).
export const routeMeta = defineRouteMeta({ canActivate: [strataDocumentNavigationGuard] });

@Component({
  selector: 'app-post-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PostDocumentServerComponent, StrataDocumentLink],
  template: `
    <nav class="crumbs"><a [strataDocumentLink]="'/'" data-home-link>← Editorial desk</a></nav>
    <post-document [slug]="slug" />
  `
})
export default class PostPage {
  protected readonly slug = inject(ActivatedRoute).snapshot.paramMap.get('slug') ?? '';
}
