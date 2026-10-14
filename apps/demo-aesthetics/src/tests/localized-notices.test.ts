/**
 * The demo's localized showcase (spec 094): the `notices` collection read in English and Spanish
 * through the same Local API call the public route makes, as an anonymous visitor.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createRuntime, type DemoRuntime } from '../server/api/runtime';
import { ensureNotices, seedContent } from '../server/api/seed';
import { toNotice } from '../server/api/mappers';
import { isSiteLocale } from '../shared/site-content';

const AS_VISITOR = { overrideAccess: false, user: null } as const;

let cms: DemoRuntime;

beforeEach(async () => {
  cms = createRuntime(undefined, { devMode: true });
  await cms.syncSchema();
  await seedContent(cms);
});

describe('localized notices', () => {
  it('reads the same notice in English and in Spanish', async () => {
    const en = await cms.find({ collection: 'notices', locale: 'en', ...AS_VISITOR });
    const es = await cms.find({ collection: 'notices', locale: 'es', ...AS_VISITOR });

    expect(en.docs.map(toNotice).map((n) => n.title)).toEqual([
      'Free skin consultation this month'
    ]);
    expect(es.docs.map(toNotice).map((n) => n.title)).toEqual([
      'Consulta de piel gratuita este mes'
    ]);
    // The shared slug and link target are the same in both languages.
    expect(en.docs[0]?.slug).toBe(es.docs[0]?.slug);
    expect(toNotice(en.docs[0]!).linkPath).toBe('/booking');
  });

  it('never leaks the draft notice to a visitor, in either language', async () => {
    for (const locale of ['en', 'es']) {
      const visitor = await cms.find({ collection: 'notices', locale, ...AS_VISITOR });
      expect(JSON.stringify(visitor.docs)).not.toMatch(/draft|borrador|August|agosto/i);
    }
    const serverView = await cms.find({ collection: 'notices', locale: 'en', status: 'all' });
    expect(serverView.totalDocs).toBe(2);
  });

  it('keeps the languages independent when an editor changes one', async () => {
    const [notice] = (await cms.find({ collection: 'notices', locale: 'en', ...AS_VISITOR })).docs;
    await cms.update({
      collection: 'notices',
      id: String(notice!.id),
      locale: 'es',
      data: { title: 'Valoración gratuita' }
    });
    const en = await cms.findByID({ collection: 'notices', id: String(notice!.id), locale: 'en' });
    const es = await cms.findByID({ collection: 'notices', id: String(notice!.id), locale: 'es' });
    expect(en['title']).toBe('Free skin consultation this month');
    expect(es['title']).toBe('Valoración gratuita');
  });

  it('accepts only the two declared locales at the route boundary', () => {
    expect(isSiteLocale('en')).toBe(true);
    expect(isSiteLocale('es')).toBe(true);
    for (const value of ['fr', 'EN', '', undefined, 'en,es', '../en']) {
      expect(isSiteLocale(value)).toBe(false);
    }
  });

  it('ensureNotices fills only an empty collection, once', async () => {
    // A deployment seeded before `notices` existed: schema synced, nothing in the new table.
    const bare = createRuntime(undefined, { devMode: true });
    await bare.syncSchema();
    expect(await bare.count({ collection: 'notices' })).toBe(0);

    await ensureNotices(bare);
    expect(await bare.count({ collection: 'notices' })).toBe(2);
    await ensureNotices(bare);
    expect(await bare.count({ collection: 'notices' })).toBe(2);
  });

  it('keeps at least one notice so the banner cannot be emptied by a visitor', async () => {
    const docs = (await cms.find({ collection: 'notices', status: 'all' })).docs;
    await cms.delete({ collection: 'notices', id: String(docs[0]!.id) });
    await expect(cms.delete({ collection: 'notices', id: String(docs[1]!.id) })).rejects.toThrow(
      /keeps at least 1/
    );
  });
});
