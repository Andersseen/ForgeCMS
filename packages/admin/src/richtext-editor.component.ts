import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { VoltButton, VoltTextarea } from '@voltui/components';

/** A richtext node, loosely typed exactly as `@forge-cms/core` defines it. */
interface RichNode {
  type: string;
  text?: string;
  children?: RichNode[];
  [extra: string]: unknown;
}

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
      <div class="space-y-2">
        @for (block of blocks(); track $index) {
          <div class="rounded-md border border-border p-2">
            <div class="mb-1.5 flex items-center justify-between gap-2">
              <select
                class="h-7 rounded border border-input bg-transparent px-2 text-xs"
                [value]="block.type"
                (change)="changeType($index, $event)"
              >
                @for (option of blockTypes; track option.type) {
                  <option [value]="option.type">{{ option.label }}</option>
                }
              </select>
              <div class="flex items-center gap-1">
                <volt-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-xs"
                  [disabled]="$first"
                  (click)="move($index, -1)"
                >
                  ↑
                </volt-button>
                <volt-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-xs"
                  [disabled]="$last"
                  (click)="move($index, 1)"
                >
                  ↓
                </volt-button>
                <volt-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-xs"
                  (click)="remove($index)"
                >
                  Remove
                </volt-button>
              </div>
            </div>
            <volt-textarea
              [value]="text(block)"
              (valueChange)="setText($index, $event)"
              [rows]="block.type === 'heading' ? 1 : 3"
            />
          </div>
        } @empty {
          <p class="text-sm text-muted-foreground">No content yet.</p>
        }

        <volt-button type="button" variant="outline" size="sm" (click)="add()">
          Add block
        </volt-button>
      </div>
    } @else {
      <div class="space-y-1.5">
        <p class="text-xs text-muted-foreground">
          This document uses nodes the block editor cannot represent, so it is shown as JSON.
        </p>
        <volt-textarea [value]="json()" (valueChange)="emitJson($event)" [rows]="8" />
      </div>
    }
  `
})
export class ForgeRichTextEditorComponent {
  value = input<unknown>();

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
  }

  protected remove(index: number): void {
    this.emit(this.blocks().filter((_, i) => i !== index));
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
  }

  protected emitJson(raw: string): void {
    try {
      this.valueChange.emit(raw === '' ? undefined : JSON.parse(raw));
    } catch {
      this.valueChange.emit(raw);
    }
  }
}
