import { Directive, ElementRef, afterEveryRender, inject, input } from '@angular/core';

/**
 * Makes the *rendered* native control honest about its state (spec 086).
 *
 * Volt's `volt-input`/`volt-textarea`/`volt-switch` render the real `<input>`/`<textarea>`/`<button>`
 * inside their own template, and their public API forwards neither `aria-describedby` nor an
 * `aria-invalid` that is not tied to an Angular form control — putting those attributes on the
 * `<volt-input>` host would label a wrapper no assistive technology focuses. This directive sits on
 * the field's wrapper and sets them on the element that actually carries `controlId`.
 *
 * It only ever touches `aria-invalid` and its own token in `aria-describedby`, so a control that
 * already describes itself (e.g. a hint) keeps that.
 */
@Directive({ selector: '[forgeControlA11y]', standalone: true })
export class ForgeControlA11yDirective {
  /** The `id` of the native control inside this wrapper. */
  readonly controlId = input.required<string>({ alias: 'forgeControlA11y' });
  readonly invalid = input(false, { alias: 'forgeControlInvalid' });
  /** The id of the element holding the error text; only referenced while `invalid`. */
  readonly errorId = input<string | null>(null, { alias: 'forgeControlErrorId' });

  /** The error id this directive last wrote, so a changed one replaces it instead of piling up. */
  private applied: string | null = null;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    // Volt controls render after this wrapper does, so this has to run after every render.
    afterEveryRender(() => this.apply());
  }

  private apply(): void {
    const id = this.controlId();
    if (id === '') return;
    const control = Array.from(this.host.querySelectorAll<HTMLElement>('[id]')).find(
      (element) => element.id === id && element.tagName !== 'FIELDSET'
    );
    if (control === undefined) return;

    const invalid = this.invalid();
    if (invalid) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');

    const errorId = this.errorId();
    const tokens = (control.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((token) => token !== '' && token !== this.applied && token !== errorId);
    this.applied = invalid ? errorId : null;
    if (invalid && errorId !== null) tokens.push(errorId);
    if (tokens.length > 0) control.setAttribute('aria-describedby', tokens.join(' '));
    else control.removeAttribute('aria-describedby');
  }
}
