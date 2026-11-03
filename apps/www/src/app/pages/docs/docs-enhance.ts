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
  html: 'HTML',
  css: 'CSS',
  toml: 'TOML',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  diff: 'Diff'
};

/** Shell blocks are labelled "Terminal" — the one language label that is a translated word. */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell']);

/** The words the code-block toolbar shows, in the reader's language (spec 101). */
export interface CodeBlockLabels {
  readonly code: string;
  readonly terminal: string;
  readonly copy: string;
  readonly copied: string;
  readonly copyFallback: string;
  readonly copyCode: (language: string) => string;
}

export const ENGLISH_CODE_LABELS: CodeBlockLabels = {
  code: 'Code',
  terminal: 'Terminal',
  copy: 'Copy',
  copied: 'Copied',
  copyFallback: 'Select to copy',
  copyCode: (language) => `Copy ${language} code`
};

/** "TypeScript" for `language-ts`, the raw name for an unknown language, `null` for none. */
export function codeLanguageLabel(
  code: Element | null,
  labels: CodeBlockLabels = ENGLISH_CODE_LABELS
): string | null {
  const match = code?.className.match(/(?:^|\s)language-([\w-]+)/);
  if (!match?.[1]) return null;
  const language = match[1].toLowerCase();
  if (SHELL_LANGUAGES.has(language)) return labels.terminal;
  return LANGUAGE_LABELS[language] ?? match[1];
}

export type CopyText = (text: string) => Promise<void>;

/**
 * Wraps every not-yet-enhanced `pre` in a `.forge-code-block` with a toolbar: the language label and
 * a real `<button>` that copies the code text. Returns how many blocks it enhanced (0 on a re-run).
 */
export function enhanceCodeBlocks(
  root: ParentNode,
  copy: CopyText,
  labels: CodeBlockLabels = ENGLISH_CODE_LABELS
): number {
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
    label.textContent = codeLanguageLabel(code, labels) ?? labels.code;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'forge-code-copy';
    button.textContent = labels.copy;
    button.setAttribute('aria-label', labels.copyCode(label.textContent));
    button.addEventListener('click', () => {
      const text = (code ?? pre).textContent ?? '';
      copy(text).then(
        () => flash(button, labels.copied, labels.copy),
        () => flash(button, labels.copyFallback, labels.copy)
      );
    });
    bar.append(label, button);

    pre.replaceWith(block);
    block.append(bar, pre);
    enhanced += 1;
  }
  return enhanced;
}

function flash(button: HTMLButtonElement, text: string, rest: string): void {
  button.textContent = text;
  button.ownerDocument.defaultView?.setTimeout(() => (button.textContent = rest), 1800);
}
