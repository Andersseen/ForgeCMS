import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChildren
} from '@angular/core';
import { VoltButton, VoltTextarea } from '@voltui/components';

/** A richtext node, loosely typed exactly as `@forge-cms/core` defines it. */
interface RichNode {
  type: string;
  text?: string;
  children?: RichNode[];
  [extra: string]: unknown;
}

let nextEditorId = 0;

const BLOCK_TYPES = [
  { type: 'paragraph', label: 'Paragraph' },
  { type: 'heading', label: 'Heading', extra: { level: 2 } },
  { type: 'quote', label: 'Quote' }
];

function isSimpleBlock(node: unknown): node is RichNode {
  if (typeof node !== 'object' || node === null) return false;
  const candidate = node as RichNode;
  if (typeof candidate.type !== 'string') return false;
  const children = candidate.children;
  if (children === undefined) return typeof candidate.text === 'string';
  return (
    Array.isArray(children) &&
    children.every((child) => typeof (child as RichNode)?.text === 'string')
  );
}

function nodeText(node: RichNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.children ?? []).map((child) => child.text ?? '').join('');
}

/**
 * A block editor for the `richtext` kind.
 *
 * Spec 015 shipped the field kind, but the admin rendered it as a textarea containing the raw JSON
 * tree — so writing a paragraph meant hand-typing `[{"type":"paragraph","children":[...]}]`. This
 * edits the tree as a list of text blocks instead. It is deliberately not a WYSIWYG: no inline
 * marks, no third-party editor, no runtime dependency added to the package.
 *
 * Any document it cannot represent (nested marks, custom node types) falls back to the JSON view,
 * so an editor built by another tool is never silently flattened.
 */
@Component({
  selector: 'forge-richtext-editor',
  standalone: true,
  imports: [VoltTextarea, VoltButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canEditAsBlocks()) {
      <div #root class="space-y-2">
        @for (block of blocks(); track $index) {
          <div
            #blockEl
            role="group"
            class="rounded-md border border-border p-2"
            [attr.aria-label]="blockName($index)"
          >
            <div class="mb-1.5 flex items-center justify-between gap-2">
              <label class="sr-only" [for]="typeId($index)">{{ blockName($index) }} type</label>
              <select
                [id]="typeId($index)"
                class="h-7 rounded border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                [value]="block.type"
                (change)="changeType($index, $event)"
              >
                @for (option of blockTypes; track option.type) {
                  <option [value]="option.type">{{ option.label }}</option>
                }
              </select>
              <div class="flex items-center gap-1">
                <volt-button
                  data-action="up"
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-xs"
                  [disabled]="$first"
                  (click)="move($index, -1)"
                >
                  <span aria-hidden="true">↑</span>
                  <span class="sr-only">Move {{ blockName($index) }} up</span>
                </volt-button>
                <volt-button
                  data-action="down"
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-xs"
                  [disabled]="$last"
                  (click)="move($index, 1)"
                >
                  <span aria-hidden="true">↓</span>
                  <span class="sr-only">Move {{ blockName($index) }} down</span>
                </volt-button>
                <volt-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-xs"
                  (click)="remove($index)"
                >
                  Remove<span class="sr-only"> {{ blockName($index) }}</span>
                </volt-button>
              </div>
            </div>
            <label class="sr-only" [for]="textId($index)">{{ blockName($index) }} text</label>
            <volt-textarea
              [id]="textId($index)"
              [value]="text(block)"
              (valueChange)="setText($index, $event)"
              [rows]="block.type === 'heading' ? 1 : 3"
            />
          </div>
        } @empty {
          <p class="text-sm text-muted-foreground">No content yet.</p>
        }

        <volt-button data-forge-add type="button" variant="outline" size="sm" (click)="add()">
          Add block<span class="sr-only"> to {{ label() }}</span>
        </volt-button>
      </div>
    } @else {
      <div class="space-y-1.5">
        <label class="text-xs text-muted-foreground" [for]="jsonId()">
          <span class="sr-only">{{ label() }}: </span>This document uses nodes the block editor
          cannot represent, so it is shown as JSON.
        </label>
        <volt-textarea
          [id]="jsonId()"
          [value]="json()"
          (valueChange)="emitJson($event)"
          [rows]="8"
        />
      </div>
    }
  `
})
export class ForgeRichTextEditorComponent {
  value = input<unknown>();
  /** The owning field's label; the blocks and their controls are named after it. */
  label = input('Rich text');
  /** Prefix for the ids of this editor's controls; unique per editor when omitted. */
  idPrefix = input('');

  private readonly uid = `forge-richtext-${nextEditorId++}`;
  private readonly injector = inject(Injector);
  private readonly blockEls = viewChildren<ElementRef<HTMLElement>>('blockEl');
  private readonly root = viewChildren<ElementRef<HTMLElement>>('root');

  private readonly base = computed(() => this.idPrefix() || this.uid);
  protected readonly jsonId = computed(() => `${this.base()}-json`);
  protected typeId(index: number): string {
    return `${this.base()}-block-${index}-type`;
  }
  protected textId(index: number): string {
    return `${this.base()}-block-${index}-text`;
  }
  /** "Body block 2 of 3" — what every control of that block is named after. */
  protected blockName(index: number): string {
    return `${this.label()} block ${index + 1} of ${this.blocks().length}`;
  }

  valueChange = output<unknown>();

  protected readonly blockTypes = BLOCK_TYPES;

  protected readonly blocks = computed<RichNode[]>(() => {
    const value = this.value();
    if (!Array.isArray(value)) return [];
    return value.filter(isSimpleBlock);
  });

  protected readonly canEditAsBlocks = computed(() => {
    const value = this.value();
    if (value === undefined || value === null || value === '') return true;
    return Array.isArray(value) && value.every(isSimpleBlock);
  });

  protected readonly json = computed(() => {
    const value = this.value();
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });

  protected text(block: RichNode): string {
    return nodeText(block);
  }

  private emit(blocks: RichNode[]): void {
    this.valueChange.emit(blocks);
  }

  protected setText(index: number, text: string): void {
    this.emit(
      this.blocks().map((block, i) => {
        if (i !== index) return block;
        // Always store the text as a child node, never as `text` on the block itself, so a block
        // that arrived in either shape leaves in one.
        const { text: _dropped, ...rest } = block;
        return { ...rest, children: [{ type: 'text', text }] };
      })
    );
  }

  protected changeType(index: number, event: Event): void {
    const type = (event.target as HTMLSelectElement).value;
    const extra = BLOCK_TYPES.find((option) => option.type === type)?.extra ?? {};
    this.emit(
      this.blocks().map((block, i) => (i === index ? { ...block, ...extra, type } : block))
    );
  }

  protected add(): void {
    this.emit([...this.blocks(), { type: 'paragraph', children: [{ type: 'text', text: '' }] }]);
    this.focusAfterRender(() => this.blockEls().at(-1)?.nativeElement.querySelector('textarea'));
  }

  protected remove(index: number): void {
    this.emit(this.blocks().filter((_, i) => i !== index));
    // The neighbour that took its place, or "Add block" when nothing is left.
    this.focusAfterRender(() => {
      const blocks = this.blockEls();
      const neighbour = blocks[Math.min(index, blocks.length - 1)];
      return (
        neighbour?.nativeElement.querySelector('textarea') ??
        this.root()[0]?.nativeElement.querySelector('[data-forge-add] button')
      );
    });
  }

  protected move(index: number, delta: number): void {
    const blocks = [...this.blocks()];
    const target = index + delta;
    const moved = blocks[index];
    const displaced = blocks[target];
    if (moved === undefined || displaced === undefined) return;

    blocks[index] = displaced;
    blocks[target] = moved;
    this.emit(blocks);
    // Focus follows the moved block; if its button just became disabled (it reached an end), use the other.
    const wanted = delta < 0 ? 'up' : 'down';
    const other = delta < 0 ? 'down' : 'up';
    this.focusAfterRender(() => {
      const block = this.blockEls()[target]?.nativeElement;
      return (
        block?.querySelector(`[data-action="${wanted}"] button:not([disabled])`) ??
        block?.querySelector(`[data-action="${other}"] button:not([disabled])`)
      );
    });
  }

  private focusAfterRender(find: () => Element | null | undefined): void {
    afterNextRender(
      () => {
        const target = find();
        if (target instanceof HTMLElement) target.focus();
      },
      { injector: this.injector }
    );
  }

  protected emitJson(raw: string): void {
    try {
      this.valueChange.emit(raw === '' ? undefined : JSON.parse(raw));
    } catch {
      this.valueChange.emit(raw);
    }
  }
}
