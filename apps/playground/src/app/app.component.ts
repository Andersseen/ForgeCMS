import { Component } from '@angular/core';
import { postFields, posts } from './posts.collection';

@Component({
  selector: 'forge-playground-root',
  standalone: true,
  template: `
    <main class="shell">
      <p class="eyebrow">ForgeCMS</p>
      <h1>Analog.js playground</h1>
      <p class="summary">
        The playground imports <code>@forge-cms/core</code> and declares an example
        <code>{{ collection.slug }}</code> collection.
      </p>

      <section aria-label="Collection fields" class="fields">
        @for (field of fields; track field.name) {
          <article class="field">
            <span>{{ field.name }}</span>
            <code>{{ field.kind }}</code>
          </article>
        }
      </section>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        color: #17202a;
        background: #f7f8fb;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          'Segoe UI',
          sans-serif;
      }

      .shell {
        width: min(920px, calc(100% - 32px));
        margin: 0 auto;
        padding: 72px 0;
      }

      .eyebrow {
        margin: 0 0 12px;
        color: #0f766e;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2.4rem, 7vw, 5rem);
        line-height: 0.95;
      }

      .summary {
        max-width: 680px;
        margin: 24px 0 36px;
        color: #52606d;
        font-size: 1.08rem;
        line-height: 1.7;
      }

      code {
        border-radius: 6px;
        padding: 2px 6px;
        color: #0f766e;
        background: #e6fffb;
        font: inherit;
      }

      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .field {
        display: flex;
        min-height: 64px;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border: 1px solid #d9e2ec;
        border-radius: 8px;
        padding: 16px;
        background: #ffffff;
      }

      .field span {
        font-weight: 700;
      }
    `
  ]
})
export class AppComponent {
  protected readonly collection = posts;
  protected readonly fields = postFields;
}
