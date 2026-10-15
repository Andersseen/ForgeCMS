import { describe, expect, it, vi } from 'vitest';
import { codeLanguageLabel, collectOutline, enhanceCodeBlocks } from './docs-enhance';

function article(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('docs outline', () => {
  it('lists every h2 with an id, in order, and ignores deeper headings', () => {
    const root = article(
      '<h2 id="one">One</h2><h3 id="sub">Sub</h3><h2 id="two"> Two <code>x</code></h2><h2>No id</h2>'
    );
    expect(collectOutline(root)).toEqual([
      { id: 'one', text: 'One' },
      { id: 'two', text: 'Two x' }
    ]);
  });
});

describe('code blocks', () => {
  it('labels known, unknown and missing languages', () => {
    const code = (cls: string) => Object.assign(document.createElement('code'), { className: cls });
    expect(codeLanguageLabel(code('language-ts'))).toBe('TypeScript');
    expect(codeLanguageLabel(code('foo language-bash'))).toBe('Terminal');
    expect(codeLanguageLabel(code('language-rust'))).toBe('rust');
    expect(codeLanguageLabel(code(''))).toBeNull();
    expect(codeLanguageLabel(null)).toBeNull();
  });

  it('adds a labelled toolbar once and copies the code text', async () => {
    const root = article(
      '<p>x</p><pre><code class="language-ts">const a = 1;</code></pre><pre><code>plain</code></pre>'
    );
    const copy = vi.fn(() => Promise.resolve());
    expect(enhanceCodeBlocks(root, copy)).toBe(2);
    // Idempotent: a second pass (e.g. another mutation) changes nothing.
    expect(enhanceCodeBlocks(root, copy)).toBe(0);

    const blocks = root.querySelectorAll('.forge-code-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.querySelector('.forge-code-bar span')?.textContent).toBe('TypeScript');
    expect(blocks[1]?.querySelector('.forge-code-bar span')?.textContent).toBe('Code');
    // The code itself is untouched and still inside its pre.
    expect(blocks[0]?.querySelector('pre code')?.textContent).toBe('const a = 1;');

    const button = blocks[0]?.querySelector('button');
    expect(button?.type).toBe('button');
    expect(button?.getAttribute('aria-label')).toBe('Copy TypeScript code');
    button?.click();
    expect(copy).toHaveBeenCalledWith('const a = 1;');
    await Promise.resolve();
    await Promise.resolve();
    expect(button?.textContent).toBe('Copied');
  });

  it('says how to copy by hand when the clipboard is refused', async () => {
    const root = article('<pre><code class="language-bash">pnpm build</code></pre>');
    enhanceCodeBlocks(root, () => Promise.reject(new Error('denied')));
    const button = root.querySelector('button');
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(button?.textContent).toBe('Select to copy');
  });
});
