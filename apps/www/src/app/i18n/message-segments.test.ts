import { describe, expect, it } from 'vitest';
import { createMessageFormatter } from '@etyma/core';
import { messageSegments } from './message-segments';

const parts = (source: string, params?: Record<string, string>) =>
  createMessageFormatter().formatToParts('en', 'key', source, params);

describe('messageSegments (spec 101)', () => {
  it('keeps plain text and variables as untagged text', () => {
    expect(messageSegments(parts('MIT · ForgeCMS {$version}', { version: '1.0.0' }))).toEqual([
      { text: 'MIT · ForgeCMS ', tag: null },
      { text: '1.0.0', tag: null }
    ]);
  });

  it('tags the text inside markup and resumes untagged text after it', () => {
    expect(messageSegments(parts('It stays off. {#link}Read the notice{/link}.'))).toEqual([
      { text: 'It stays off. ', tag: null },
      { text: 'Read the notice', tag: 'link' },
      { text: '.', tag: null }
    ]);
  });

  it('tags a variable placed inside markup', () => {
    expect(
      messageSegments(parts('Umami at {#code}{$host}{/code}.', { host: 'umami.example' }))
    ).toEqual([
      { text: 'Umami at ', tag: null },
      { text: 'umami.example', tag: 'code' },
      { text: '.', tag: null }
    ]);
  });
});
