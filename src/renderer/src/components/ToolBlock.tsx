import { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import { type ToolNode, getToolArgs } from '../state/transcriptController';
import { MESSAGE_CONTENT_MAX_WIDTH } from '../lib/layoutConstants';
import SyntaxHighlightedCode from './syntaxHighlightedCode';
import DiffView from './DiffView';
import type { EditEntry } from '../lib/diffUtils';
import ImagePreview from './ImagePreview';

/** Max lines shown in collapsed write preview */
function WritePreview({
  content,
  language,
  isStreaming,
}: {
  content: string;
  language: string;
  isStreaming: boolean;
}): React.JSX.Element {
  // Strip trailing newline to avoid rendering an extra empty line
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return (
    <div className="mt-2 overflow-hidden rounded font-mono text-[13px] leading-5">
      <pre className="overflow-hidden whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">
        <SyntaxHighlightedCode code={trimmed} language={language} />
        {isStreaming && <span className="animate-pulse text-muted-foreground/50">▋</span>}
      </pre>
    </div>
  );
}

interface ToolBlockProps {
  node: ToolNode;
}

interface ToolCommandParts {
  prefix: string;
  body: string;
}

const STATUS_CONFIG = {
  running: {
    label: 'Running',
    className: 'text-[#92400e]',
    style: {
      background: 'linear-gradient(180deg, #fef3c7, #fffbeb)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.03)',
      textShadow: '0 1px 0 rgba(255,255,255,0.25)',
    },
  },
  success: {
    label: 'Succeeded',
    className: 'text-[#166534]',
    style: {
      background: 'linear-gradient(180deg, #dcfce7, #f0fdf4)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.03)',
      textShadow: '0 1px 0 rgba(255,255,255,0.25)',
    },
  },
  error: {
    label: 'Failed',
    className: 'text-[#991b1b]',
    style: {
      background: 'linear-gradient(180deg, #fee2e2, #fef2f2)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.03)',
      textShadow: '0 1px 0 rgba(255,255,255,0.25)',
    },
  },
  cancelled: {
    label: 'Cancelled',
    className: 'text-[#3f3f46]',
    style: {
      background: 'linear-gradient(180deg, #f4f4f5, #fafafa)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.03)',
      textShadow: '0 1px 0 rgba(255,255,255,0.2)',
    },
  },
} as const;

function ElapsedTimer({ startedAt }: { startedAt?: number }): React.JSX.Element {
  const [startMs] = useState(() => startedAt ?? Date.now());
  const [elapsed, setElapsed] = useState(() => (Date.now() - startMs) / 1000);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((Date.now() - startMs) / 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [startMs]);

  return <span className="tabular-nums">Elapsed {elapsed.toFixed(1)}s</span>;
}

/** Min height for running tool blocks to reserve space and reduce layout shift */
const TOOL_BLOCK_RUNNING_MIN_HEIGHT = '80px';

/** Max height for tool block content before showing expand button */
const TOOL_BLOCK_MAX_HEIGHT = 300;

/** Tools that stream output while running (shown immediately, not gated on completion) */
const STREAMING_OUTPUT_TOOLS = new Set(['bash', 'read']);

const READ_MORE_LINES_RE = /^\[\d+ more lines in file\. Use offset=\d+ to continue\.\]$/;
const READ_IMAGE_RE = /^Read image file \[(.+)\]$/;

const SECONDS_PER_MILLISECOND = 1 / 1000;

/**
 * Override map for file extensions that don't directly match a shiki language id/alias.
 * Most extensions (e.g. rs, go, py, ts, lua, zig) are valid shiki language keys and
 * are resolved at runtime via `bundledLanguages` in SyntaxHighlightedCode.
 */
const FILE_EXTENSION_LANGUAGE_OVERRIDE: Record<string, string> = {
  cc: 'cpp',
  cjs: 'javascript',
  cts: 'typescript',
  cxx: 'cpp',
  h: 'c',
  hbs: 'handlebars',
  hpp: 'cpp',
  hx: 'haxe',
  kts: 'kotlin',
  mjs: 'javascript',
  mk: 'make',
  mts: 'typescript',
  pl: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  ml: 'ocaml',
  pas: 'pascal',
  ps1: 'powershell',
  tf: 'terraform',
};

function getToolCommandParts(node: ToolNode): ToolCommandParts {
  const args = getToolArgs(node);

  switch (node.name) {
    case 'bash':
      return { prefix: '$', body: String(args?.command ?? '') };
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
      // Show the first string argument value as context
      const firstValue = Object.values(args).find((v) => typeof v === 'string');
      return { prefix: node.name, body: typeof firstValue === 'string' ? firstValue : '' };
    }
  }
}

function getToolOutputLanguage(node: ToolNode): string {
  const args = getToolArgs(node);
  const path = typeof args?.path === 'string' ? args.path : '';
  return getLanguageFromPath(path) ?? 'text';
}

function getLanguageFromPath(path: string): string | null {
  const fileName = path.split('/').pop() ?? '';
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
  if (!extension) {
    return null;
  }

  // Check override map first, then use the extension directly
  // (most extensions like rs, go, py, ts are valid shiki language ids/aliases)
  return FILE_EXTENSION_LANGUAGE_OVERRIDE[extension] ?? extension;
}

function getEditEntries(node: ToolNode): EditEntry[] | null {
  if (node.name !== 'edit') return null;
  const args = getToolArgs(node);
  if (!args) return null;
  // Array.isArray confirms shape; elements are validated below via filter
  const edits = Array.isArray(args.edits)
    ? (args.edits as Array<{ oldText?: string; newText?: string }>)
    : undefined;
  if (!edits || edits.length === 0) return null;
  return edits
    .filter((e) => typeof e.oldText === 'string' && typeof e.newText === 'string')
    .map((e) => ({ oldText: e.oldText!, newText: e.newText! }));
}

function getWriteEntries(node: ToolNode): EditEntry[] | null {
  if (node.name !== 'write') return null;
  const args = getToolArgs(node);
  const content = typeof args?.content === 'string' ? args.content : null;
  if (!content) return null;
  return [{ oldText: '', newText: content }];
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs)) {
    return null;
  }

  const seconds = Math.max(0.1, durationMs * SECONDS_PER_MILLISECOND);
  const formattedSeconds = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return `Took ${formattedSeconds}s`;
}

function cleanReadOutput(node: ToolNode): string {
  if (node.name !== 'read') return node.output;
  const lines = node.output.split('\n');
  if (lines[0]?.match(READ_IMAGE_RE)) return '';
  return lines.filter((line) => !READ_MORE_LINES_RE.test(line)).join('\n');
}

function getReadImagePath(node: ToolNode): string | null {
  if (node.name !== 'read') return null;
  const lines = node.output.split('\n');
  if (!lines[0]?.match(READ_IMAGE_RE)) return null;
  const args = getToolArgs(node);
  return typeof args?.path === 'string' ? args.path : null;
}

export default function ToolBlock({ node }: ToolBlockProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [commandExpanded, setCommandExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isCommandTruncated, setIsCommandTruncated] = useState(false);

  // For read tool: filter hint lines and detect images
  const cleanedOutput = useMemo(() => cleanReadOutput(node), [node]);
  const imagePath = useMemo(() => getReadImagePath(node), [node]);

  useEffect(() => {
    if (contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > TOOL_BLOCK_MAX_HEIGHT);
    }
    if (commandRef.current) {
      setIsCommandTruncated(commandRef.current.scrollHeight > commandRef.current.clientHeight);
    }
  }, [node, expanded]);

  // Read tool returns fast — skip rendering the running state to avoid flicker
  if (node.name === 'read' && node.status === 'running') return null;

  const { className: statusClassName, style: statusStyle } = STATUS_CONFIG[node.status];
  const command = getToolCommandParts(node);
  const editEntries = getEditEntries(node);
  const writeEntries = getWriteEntries(node);
  const hasOutput = cleanedOutput.length > 0;
  const outputLanguage = getToolOutputLanguage(node);
  const durationLabel = formatDuration(node.durationMs);
  const args = getToolArgs(node);
  const timeout = typeof args?.timeout === 'number' ? args.timeout : undefined;

  return (
    <>
      <div
        className="overflow-hidden rounded-md border border-border/65 bg-muted/25 px-3 py-1.5 text-sm text-muted-foreground"
        style={{
          maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px`,
          minHeight: node.status === 'running' ? TOOL_BLOCK_RUNNING_MIN_HEIGHT : undefined,
        }}
        data-testid={`tool-block-${node.toolCallId}`}
      >
        {command.body ? (
          <div className="flex items-start gap-1 rounded py-1.5 font-mono text-[14px] font-medium leading-5 text-foreground">
            <span className="shrink-0">{command.prefix}</span>
            <span
              ref={commandRef}
              className={cn(
                'min-w-0 break-words [overflow-wrap:anywhere]',
                !commandExpanded && 'line-clamp-2',
              )}
            >
              {command.body}
            </span>
            {isCommandTruncated && timeout !== undefined ? (
              <div className="ml-auto shrink-0 flex flex-col items-end">
                <span className="text-xs font-normal text-muted-foreground">
                  timeout {timeout}s
                </span>
                <button
                  type="button"
                  onClick={() => setCommandExpanded((v) => !v)}
                  className="text-xs font-normal text-muted-foreground hover:text-foreground"
                >
                  {commandExpanded ? 'less' : 'more'}
                </button>
              </div>
            ) : (
              <>
                {isCommandTruncated && (
                  <button
                    type="button"
                    onClick={() => setCommandExpanded((v) => !v)}
                    className="shrink-0 self-end text-xs font-normal text-muted-foreground hover:text-foreground"
                  >
                    {commandExpanded ? 'less' : 'more'}
                  </button>
                )}
                {timeout !== undefined && (
                  <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                    timeout {timeout}s
                  </span>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-1 rounded py-1.5 font-mono text-[14px] font-medium leading-5 text-foreground">
            <span className="shrink-0">{command.prefix}</span>
            <span className="min-w-0 text-muted-foreground">…</span>
          </div>
        )}

        <div
          ref={contentRef}
          className="overflow-hidden"
          style={{
            maxHeight: expanded ? undefined : `${TOOL_BLOCK_MAX_HEIGHT}px`,
            maskImage:
              !expanded && isOverflowing
                ? 'linear-gradient(to bottom, black calc(100% - 16px), transparent)'
                : undefined,
            WebkitMaskImage:
              !expanded && isOverflowing
                ? 'linear-gradient(to bottom, black calc(100% - 16px), transparent)'
                : undefined,
          }}
        >
          {node.status !== 'running' &&
            editEntries &&
            editEntries.length > 0 &&
            node.status !== 'error' && <DiffView edits={editEntries} />}

          {/* Write preview shown during running (streaming) unlike edit which waits for completion */}
          {writeEntries && writeEntries.length > 0 && node.status !== 'error' && (
            <WritePreview
              content={writeEntries[0].newText}
              language={outputLanguage}
              isStreaming={node.status === 'running'}
            />
          )}

          {(node.status !== 'running' || STREAMING_OUTPUT_TOOLS.has(node.name)) &&
            hasOutput &&
            ((node.name !== 'edit' && node.name !== 'write') || node.status === 'error') && (
              <pre className="mt-2 overflow-hidden whitespace-pre-wrap break-words font-mono text-[14px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                <SyntaxHighlightedCode code={cleanedOutput} language={outputLanguage} />
              </pre>
            )}
        </div>

        {isOverflowing && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}

        <div
          className={cn(
            '-mx-3 -mb-2 mt-2 flex items-center justify-start gap-1.5 px-3 py-1.5 text-xs rounded-b-md',
            statusClassName,
          )}
          style={statusStyle}
        >
          {node.status === 'running' ? (
            <ElapsedTimer startedAt={node.startedAt} />
          ) : (
            <>{durationLabel && <span>{durationLabel}</span>}</>
          )}
        </div>
      </div>
      {imagePath && <ImagePreview src={`local-file://${imagePath}`} alt={imagePath} />}
    </>
  );
}
