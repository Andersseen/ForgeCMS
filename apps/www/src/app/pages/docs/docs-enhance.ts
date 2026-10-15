/**
 * Progressive enhancement of a rendered docs article (spec 097): an "On this page" outline from its
 * `h2`s, and a language label + copy button on every code block. The markdown itself is build-time
 * HTML that Angular does not manage, so these are plain DOM functions — idempotent, framework-free
 * and unit-tested under jsdom. Without them the article is complete; they only add affordances.
 */

export interface OutlineItem {
  id: string;
  text: string;
}

/** The article's sections: every `h2` that has an id (marked-gfm-heading-id always gives one). */
export function collectOutline(root: ParentNode): OutlineItem[] {
  return Array.from(root.querySelectorAll('h2[id]')).map((heading) => ({
    id: heading.id,
    text: (heading.textContent ?? '').trim()
  }));
}

const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  json: 'JSON',
  bash: 'Terminal',
  sh: 'Terminal',
  shell: 'Terminal',
  html: 'HTML',
  css: 'CSS',
  toml: 'TOML',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  diff: 'Diff'
};

/** "TypeScript" for `language-ts`, the raw name for an unknown language, `null` for none. */
export function codeLanguageLabel(code: Element | null): string | null {
  const match = code?.className.match(/(?:^|\s)language-([\w-]+)/);
  if (!match?.[1]) return null;
  return LANGUAGE_LABELS[match[1].toLowerCase()] ?? match[1];
}

export type CopyText = (text: string) => Promise<void>;

/**
 * Wraps every not-yet-enhanced `pre` in a `.forge-code-block` with a toolbar: the language label and
 * a real `<button>` that copies the code text. Returns how many blocks it enhanced (0 on a re-run).
 */
export function enhanceCodeBlocks(root: ParentNode, copy: CopyText): number {
  let enhanced = 0;
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (pre.parentElement?.classList.contains('forge-code-block')) continue;
    const doc = pre.ownerDocument;
    const code = pre.querySelector('code');

    const block = doc.createElement('div');
    block.className = 'forge-code-block';
    const bar = doc.createElement('div');
    bar.className = 'forge-code-bar';
    const label = doc.createElement('span');
    label.textContent = codeLanguageLabel(code) ?? 'Code';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'forge-code-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', `Copy ${label.textContent} code`);
    button.addEventListener('click', () => {
      const text = (code ?? pre).textContent ?? '';
      copy(text).then(
        () => flash(button, 'Copied'),
        () => flash(button, 'Select to copy')
      );
    });
    bar.append(label, button);

    pre.replaceWith(block);
    block.append(bar, pre);
    enhanced += 1;
  }
  return enhanced;
}

function flash(button: HTMLButtonElement, text: string): void {
  button.textContent = text;
  button.ownerDocument.defaultView?.setTimeout(() => (button.textContent = 'Copy'), 1800);
}
