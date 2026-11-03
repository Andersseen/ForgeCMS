// @vitest-environment jsdom
/**
 * Spec 101: the explicit route tree localized through Etyma's Angular integration tokens — the URL
 * decides the locale, `/en/*` redirects, unknown prefixes never become locales, and `setLocale()`
 * is a navigation.
 */
import '@angular/compiler';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { EtymaI18n, provideEtyma } from '@etyma/angular';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n';
import { localizedRoutes, provideLocaleSwitch } from './locale-routing';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

@Component({ selector: 'test-page', template: 'page' })
class PageStub {}
@Component({ selector: 'test-missing', template: 'missing' })
class MissingStub {}
@Component({ selector: 'test-admin', template: 'admin' })
class AdminStub {}

const pages: Routes = [
  { path: '', pathMatch: 'full', component: PageStub },
  { path: 'demo', component: PageStub },
  { path: 'docs/:slug', component: PageStub },
  { path: '**', component: MissingStub }
];

let harness: RouterTestingHarness | undefined;

/** Navigates the test's one harness (created on first use) and reports where the router landed. */
async function at(url: string) {
  harness ??= await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return {
    url: TestBed.inject(Router).url,
    locale: TestBed.inject(EtymaI18n).locale(),
    text: harness.routeNativeElement?.textContent?.trim()
  };
}

describe('localized route tree (spec 101)', () => {
  beforeEach(() => {
    harness = undefined;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(localizedRoutes(pages, [{ path: 'admin', component: AdminStub }])),
        provideEtyma(i18n),
        provideLocaleSwitch()
      ]
    });
  });

  it('serves English unprefixed', async () => {
    expect(await at('/demo')).toEqual({ url: '/demo', locale: 'en', text: 'page' });
  });

  it('activates Spanish and Ukrainian from the prefix before the page renders', async () => {
    expect(await at('/es/demo')).toEqual({ url: '/es/demo', locale: 'es', text: 'page' });
    expect(await at('/uk')).toEqual({ url: '/uk', locale: 'uk', text: 'page' });
    expect(TestBed.inject(EtymaI18n).t('navigation.product')).toBe('Продукт');
  });

  it('redirects /en/* to the unprefixed URL, keeping query and fragment', async () => {
    expect((await at('/en')).url).toBe('/');
    expect(await at('/en/docs/quickstart?ref=x#install')).toMatchObject({
      url: '/docs/quickstart?ref=x#install',
      locale: 'en'
    });
  });

  it('never treats an unknown prefix as a locale', async () => {
    expect(await at('/fr/demo')).toEqual({ url: '/fr/demo', locale: 'en', text: 'missing' });
    expect(await at('/es/not-a-page')).toEqual({
      url: '/es/not-a-page',
      locale: 'es',
      text: 'missing'
    });
  });

  it('keeps the admin English-only, even after a localized page', async () => {
    await at('/uk/demo');
    expect(await at('/admin')).toEqual({ url: '/admin', locale: 'en', text: 'admin' });
  });

  it('makes setLocale() a navigation to the same page', async () => {
    await at('/demo?ref=x#explore');
    await TestBed.inject(EtymaI18n).setLocale('uk');
    expect(TestBed.inject(Router).url).toBe('/uk/demo?ref=x#explore');
    expect(TestBed.inject(EtymaI18n).locale()).toBe('uk');
  });
});
