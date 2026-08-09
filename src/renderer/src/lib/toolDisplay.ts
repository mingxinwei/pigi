import { type ToolNode, getToolArgs } from '../state/transcriptController';

export interface ToolCommandParts {
  prefix: string;
  body: string;
}

/**
 * Commands render as a single line everywhere (tool card, read-group labels,
 * activity feed): collapse newlines to spaces so a multi-line script never
 * breaks the one-line layout or the middle-truncation.
 */
export function collapseCommandNewlines(command: string): string {
  return command.replace(/\s*\n\s*/g, ' ');
}

/** Regex for the [N more lines in file…] hint emitted by the pi read tool. */
export const READ_MORE_LINES_RE = /^\[\d+ more lines in file\. Use offset=\d+ to continue\.\]$/;

/** Regex for the read tool's image-detection header line. */
export const READ_IMAGE_RE = /^Read image file \[(.+)\]$/;

export function getToolCommandParts(node: ToolNode): ToolCommandParts {
  const args = getToolArgs(node);

  switch (node.name) {
    case 'bash':
      return { prefix: '$', body: collapseCommandNewlines(String(args?.command ?? '')) };
    case 'read': {
      const path = String(args?.path ?? '');
      const offset = typeof args?.offset === 'number' ? args.offset : undefined;
      const limit = typeof args?.limit === 'number' ? args.limit : undefined;
      let body = path;
      if (offset != null || limit != null) {
        const from = offset ?? 1;
        const to = limit != null ? from + limit - 1 : undefined;
        body += to != null ? `:${from}-${to}` : `:${from}`;
      }
      return { prefix: node.name, body };
    }
    case 'write':
      return { prefix: node.name, body: String(args?.path ?? '') };
    case 'edit':
      return { prefix: node.name, body: String(args?.path ?? '') };
    default: {
      if (!args) return { prefix: node.name, body: '' };
      // Show the first string argument value as context, on a single line
      // like every other command body (a multi-line first argument would
      // break the same one-line surfaces).
      const firstValue = Object.values(args).find((v) => typeof v === 'string');
      return {
        prefix: node.name,
        body: typeof firstValue === 'string' ? collapseCommandNewlines(firstValue) : '',
      };
    }
  }
}

/**
 * Filter hint lines and image headers from read tool output so the
 * searchable text matches what ToolBlock actually renders.
 */
export function cleanReadOutput(node: ToolNode): string {
  if (node.name !== 'read') return node.output;
  const lines = node.output.split('\n');
  if (lines[0]?.match(READ_IMAGE_RE)) return '';
  return lines.filter((line) => !READ_MORE_LINES_RE.test(line)).join('\n');
}

/**
 * Text content as rendered by ToolBlock — used as the search target so
 * occurrence indices match DOM tree order.
 */
export function getToolSearchText(node: ToolNode): string {
  const args = getToolArgs(node);
  if (node.name === 'write' && node.status !== 'error') {
    return typeof args?.content === 'string' ? args.content : '';
  }
  if (node.name === 'edit' && node.status !== 'error') {
    return node.details?.diff ?? '';
  }
  return cleanReadOutput(node);
}
