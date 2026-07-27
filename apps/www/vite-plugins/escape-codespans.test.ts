import { describe, expect, it } from 'vitest';
import { escapeCodespanHtml } from './escape-codespans';

describe('escapeCodespanHtml', () => {
  it('escapes the angle brackets that would otherwise be parsed as tags', () => {
    expect(escapeCodespanHtml('Promise<Post>')).toBe('Promise&lt;Post&gt;');
    expect(escapeCodespanHtml('DatabaseAdapter<TRecord extends DatabaseRecord>')).toBe(
      'DatabaseAdapter&lt;TRecord extends DatabaseRecord&gt;'
    );
  });

  it('escapes bare ampersands', () => {
    expect(escapeCodespanHtml('a && b')).toBe('a &amp;&amp; b');
  });

  it('leaves existing entities alone, so they are not double-escaped', () => {
    expect(escapeCodespanHtml('&amp; &#39; &#x2F;')).toBe('&amp; &#39; &#x2F;');
  });

  it('passes ordinary code through untouched', () => {
    expect(escapeCodespanHtml('defineField.text()')).toBe('defineField.text()');
  });
});
