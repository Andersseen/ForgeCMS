import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SiteApiService } from '../../services/site-api.service';
import { asyncState } from './async-state';

/**
 * The one place a visitor writes to the CMS.
 *
 * The POST goes to `/api/site/bookings`, which calls the Local API with `overrideAccess: false` and
 * no user — so the `bookings` collection's own `access.create` rule is what allows it, and its
 * `beforeChange` hook is what stops a crafted request from arriving pre-confirmed.
 */
@Component({
  selector: 'lumea-booking-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lumea-hero border-b border-border/60">
      <div class="mx-auto max-w-6xl px-5 py-16">
        <h1 class="lumea-display text-4xl">Request an appointment</h1>
        <p class="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Tell us what you would like to work on and when suits you. We confirm by phone within one
          working day — nothing is charged until you are in the chair.
        </p>
      </div>
    </section>

    <section class="mx-auto grid max-w-5xl gap-12 px-5 py-16 md:grid-cols-[1.3fr_1fr]">
      @if (confirmationId(); as id) {
        <div class="rounded-2xl border border-border/70 bg-card p-8">
          <h2 class="lumea-display text-2xl">Request received</h2>
          <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
            Reference <span class="font-mono">{{ id.slice(0, 8) }}</span
            >. Someone from the front desk will call you to confirm the slot.
          </p>
          <p class="mt-6 text-sm text-muted-foreground">
            It is now sitting in the clinic's inbox as a <strong>pending</strong> booking — visible
            to staff in
            <a routerLink="/admin/collections/bookings" class="underline underline-offset-4">
              the CMS
            </a>
            and to nobody else.
          </p>
          <button
            type="button"
            (click)="reset()"
            class="mt-6 rounded-full border border-border px-5 py-2 text-sm hover:bg-muted"
          >
            Send another request
          </button>
        </div>
      } @else {
        <form class="space-y-5" (submit)="submit($event)">
          <div class="grid gap-5 sm:grid-cols-2">
            <label class="block">
              <span class="text-sm font-medium">Name</span>
              <input
                name="name"
                required
                [value]="name()"
                (input)="name.set(inputValue($event))"
                class="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label class="block">
              <span class="text-sm font-medium">Email</span>
              <input
                name="email"
                type="email"
                required
                [value]="email()"
                (input)="email.set(inputValue($event))"
                class="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label class="block">
              <span class="text-sm font-medium">Phone</span>
              <input
                name="phone"
                [value]="phone()"
                (input)="phone.set(inputValue($event))"
                class="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label class="block">
              <span class="text-sm font-medium">Preferred date &amp; time</span>
              <input
                name="preferredDate"
                type="datetime-local"
                required
                [value]="preferredDate()"
                (input)="preferredDate.set(inputValue($event))"
                class="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <label class="block">
            <span class="text-sm font-medium">Treatment</span>
            <select
              name="service"
              [value]="service()"
              (change)="service.set(selectValue($event))"
              class="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Not sure yet — advise me</option>
              @for (option of services.data()?.services ?? []; track option.id) {
                <option [value]="option.id">{{ option.name }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="text-sm font-medium">Anything we should know?</span>
            <textarea
              name="notes"
              rows="4"
              [value]="notes()"
              (input)="notes.set(textareaValue($event))"
              class="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            ></textarea>
          </label>

          @if (error(); as message) {
            <p class="text-sm text-destructive">{{ message }}</p>
          }

          <button
            type="submit"
            [disabled]="submitting()"
            class="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {{ submitting() ? 'Sending…' : 'Send request' }}
          </button>
        </form>
      }

      <aside class="space-y-6 text-sm text-muted-foreground">
        <div class="rounded-2xl border border-border/70 bg-card p-5">
          <p class="font-medium text-foreground">What happens next</p>
          <ol class="mt-3 list-decimal space-y-2 pl-4">
            <li>Your request lands in the clinic inbox as <em>pending</em>.</li>
            <li>The front desk calls to agree the exact slot.</li>
            <li>You get a reminder the day before.</li>
          </ol>
        </div>
        <p>
          Prefer to talk? Call the clinic directly — the number is in the footer, and it comes from
          the CMS too.
        </p>
      </aside>
    </section>
  `
})
export class BookingPage {
  private readonly api = inject(SiteApiService);

  protected readonly services = asyncState(() => this.api.services());

  /** `/booking?service=signature-hydraglow-facial` from a treatment page's CTA. */
  readonly serviceSlug = input('', { alias: 'service' });

  constructor() {
    effect(() => {
      const slug = this.serviceSlug();
      const match = this.services.data()?.services.find((entry) => entry.slug === slug);
      if (match) this.service.set(match.id);
    });
  }

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly service = signal('');
  protected readonly preferredDate = signal('');
  protected readonly notes = signal('');

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmationId = signal<string | null>(null);

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }

  protected textareaValue(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitting.set(true);
    this.error.set(null);

    try {
      const result = await this.api.requestBooking({
        name: this.name(),
        email: this.email(),
        phone: this.phone(),
        service: this.service(),
        // `datetime-local` gives `2026-08-01T17:00`; the CMS date field parses it, but nothing
        // normalises the timezone — the value is stored exactly as sent (finding 3).
        preferredDate: this.preferredDate(),
        notes: this.notes()
      });
      this.confirmationId.set(result.id);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      this.submitting.set(false);
    }
  }

  protected reset(): void {
    this.confirmationId.set(null);
    this.name.set('');
    this.email.set('');
    this.phone.set('');
    this.service.set('');
    this.preferredDate.set('');
    this.notes.set('');
  }
}
