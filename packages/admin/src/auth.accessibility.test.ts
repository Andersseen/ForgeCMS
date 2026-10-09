// @vitest-environment jsdom
/**
 * Spec 086 (roadmap 0.11 / U02): sign-in and sign-up by keyboard — fields that really are labelled
 * (one id each), Enter submits once, errors are announced, and a failed attempt leaves focus usable.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ForgeSignInComponent } from './signin.component.js';
import { ForgeSignUpComponent } from './signup.component.js';
import * as h from './reliability.test-helpers.js';

let ctx: h.Harness;
beforeAll(() => h.stubLayout());
beforeEach(() => {
  ctx = h.configureHarness();
  TestBed.overrideProvider(Router, {
    useValue: {
      navigate: ctx.navigate,
      navigateByUrl: ctx.navigate,
      createUrlTree: () => ({}),
      serializeUrl: () => ''
    }
  });
});
afterEach(() => TestBed.resetTestingModule());

async function ready(): Promise<void> {
  await h.settle();
  ctx.transport
    .last('/api/auth/me')
    .resolve({ error: { code: 'UNAUTHORIZED', message: 'no' } }, 401);
  await h.settle();
}

describe('sign in', () => {
  it('labels both fields, names the password toggle, and has one element per id', async () => {
    const fixture = TestBed.createComponent(ForgeSignInComponent);
    await ready();
    const email = h.q<HTMLInputElement>(fixture, 'input#forge-signin-email') as HTMLInputElement;
    const password = h.q<HTMLInputElement>(
      fixture,
      'input#forge-signin-password'
    ) as HTMLInputElement;
    expect(h.labelFor(email)).toBe('Email');
    expect(h.labelFor(password)).toBe('Password');
    const ids = h.qa(fixture, '[id]').map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    const toggle = h.q<HTMLButtonElement>(
      fixture,
      'button[aria-label="Show password"]'
    ) as HTMLButtonElement;
    expect(toggle.type).toBe('button');
    toggle.click();
    await h.settle();
    expect(password.type).toBe('text');
    expect(h.q(fixture, 'button[aria-label="Hide password"]')).not.toBeNull();
  });

  it('submits once, announces a rejected login, and puts focus back in the password field', async () => {
    const fixture = TestBed.createComponent(ForgeSignInComponent);
    await ready();
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-signin-email') as HTMLInputElement,
      'a@example.com'
    );
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-signin-password') as HTMLInputElement,
      'wrong'
    );

    h.submitForm(fixture);
    h.submitForm(fixture);
    await h.settle();
    expect(ctx.transport.to('/api/auth/login', 'POST')).toHaveLength(1);
    expect(h.text(fixture)).toContain('Signing in…');

    ctx.transport
      .last('/api/auth/login', 'POST')
      .resolve({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }, 401);
    await h.settle();
    expect(h.q(fixture, 'form [role="alert"]')?.textContent?.trim()).not.toBe('');
    expect(h.active()).toBe(h.q(fixture, 'input#forge-signin-password'));
  });
});

describe('sign up', () => {
  it('labels all three fields and submits once', async () => {
    const fixture = TestBed.createComponent(ForgeSignUpComponent);
    await ready();
    for (const [id, name] of [
      ['forge-signup-name', 'Name'],
      ['forge-signup-email', 'Email'],
      ['forge-signup-password', 'Password']
    ] as const) {
      expect(h.labelFor(h.q(fixture, `input#${id}`) as HTMLElement), id).toBe(name);
    }
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-signup-email') as HTMLInputElement,
      'a@example.com'
    );
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-signup-password') as HTMLInputElement,
      'longenough123'
    );
    h.submitForm(fixture);
    h.submitForm(fixture);
    await h.settle();
    expect(ctx.transport.to('/api/auth/signup', 'POST')).toHaveLength(1);
  });

  it('announces a rejected sign-up and puts focus back in the form', async () => {
    const fixture = TestBed.createComponent(ForgeSignUpComponent);
    await ready();
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-signup-email') as HTMLInputElement,
      'a@example.com'
    );
    await h.typeInto(
      h.q<HTMLInputElement>(fixture, 'input#forge-signup-password') as HTMLInputElement,
      'x'
    );
    h.submitForm(fixture);
    await h.settle();
    ctx.transport
      .last('/api/auth/signup', 'POST')
      .resolve({ error: { code: 'CONFLICT', message: 'Unable to sign up' } }, 409);
    await h.settle();
    expect(h.q(fixture, 'form [role="alert"]')?.textContent?.trim()).not.toBe('');
    expect(h.active()).toBe(h.q(fixture, 'input#forge-signup-email'));
  });
});
