import { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import { type ToolNode, getToolArgs } from '../state/transcriptController';
import { MESSAGE_CONTENT_MAX_WIDTH, BLOCK_CONTENT_MAX_HEIGHT } from '../lib/layoutConstants';
import SyntaxHighlightedCode from './syntaxHighlightedCode';
import DiffView from './DiffView';
import type { EditEntry, DiffLine } from '../lib/diffUtils';
import { parseDiffString } from '../lib/diffUtils';
import ImagePreview from './ImagePreview';
import { getToolCommandParts, cleanReadOutput, READ_IMAGE_RE } from '../lib/toolDisplay';
import OverflowClamp from './overflowClamp';
import { Skeleton } from './ui/skeleton';

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

/** Diff-styled placeholder shown while an edit is still running */
function DiffSkeleton(): React.JSX.Element {
  // Faint add/remove tints so the placeholder reads as an upcoming diff
  const rows = [
    { tint: '', width: 'w-2/3' },
    { tint: 'bg-red-500/10', width: 'w-1/2' },
    { tint: 'bg-red-500/10', width: 'w-2/5' },
    { tint: 'bg-green-500/10', width: 'w-3/4' },
    { tint: 'bg-green-500/10', width: 'w-2/5' },
    { tint: '', width: 'w-3/5' },
    { tint: '', width: 'w-1/2' },
    { tint: 'bg-green-500/10', width: 'w-4/5' },
  ];
  return (
    <div className="overflow-hidden rounded font-mono text-[13px] leading-5" aria-hidden>
      {rows.map((row, index) => (
        <div key={index} className={cn('flex h-7 items-center gap-2 px-2', row.tint)}>
          <Skeleton className="h-4 w-6 shrink-0" />
          <Skeleton className={cn('h-4', row.width)} />
        </div>
      ))}
    </div>
  );
}

/** File-content placeholder shown while a write is still streaming */
function WriteSkeleton(): React.JSX.Element {
  const widths = ['w-1/2', 'w-4/5', 'w-2/3', 'w-3/4', 'w-1/3', 'w-3/5'];
  return (
    <div className="mt-2 flex flex-col font-mono text-[13px] leading-5" aria-hidden>
      {widths.map((width, index) => (
        <div key={index} className="flex h-7 items-center gap-2">
          <Skeleton className="h-4 w-6 shrink-0" />
          <Skeleton className={cn('h-4', width)} />
        </div>
      ))}
    </div>
  );
}

/** Terminal-output placeholder shown while a bash command runs with no output yet.
 *  No line-number gutter, unlike WriteSkeleton, to read as log/terminal lines. */
function BashSkeleton(): React.JSX.Element {
  const widths = ['w-3/4', 'w-2/3'];
  return (
    <div className="flex flex-col font-mono text-[14px] leading-5" aria-hidden>
      {widths.map((width, index) => (
        <div key={index} className="flex h-7 items-center">
          <Skeleton className={cn('h-4', width)} />
        </div>
      ))}
    </div>
  );
}

interface ToolBlockProps {
  node: ToolNode;
}

const STATUS_CONFIG = {
  running: {
    label: 'Running',
    className: 'text-[#92400e]',
    style: {
      background: '#fef3c7',
    },
  },
  success: {
    label: 'Succeeded',
    className: 'text-[#166534]',
    style: {
      background: '#dcfce7',
    },
  },
  error: {
    label: 'Failed',
    className: 'text-[#991b1b]',
    style: {
      background: '#fee2e2',
    },
  },
  cancelled: {
    label: 'Cancelled',
    className: 'text-[#3f3f46]',
    style: {
      background: '#f4f4f5',
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

/** Tools that stream output while running (shown immediately, not gated on completion) */
const STREAMING_OUTPUT_TOOLS = new Set(['bash', 'read']);

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

/** Extract pre-computed DiffLines from tool result details (used by tagged-edit and similar tools) */
function getEditDiffFromDetails(node: ToolNode): DiffLine[][] | null {
  if (node.name !== 'edit') return null;
  if (!node.details?.diff) return null;
  const parsed = parseDiffString(node.details.diff);
  return parsed.length > 0 ? parsed : null;
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

function getReadImagePath(node: ToolNode): string | null {
  if (node.name !== 'read') return null;
  const lines = node.output.split('\n');
  if (!lines[0]?.match(READ_IMAGE_RE)) return null;
  const args = getToolArgs(node);
  return typeof args?.path === 'string' ? args.path : null;
}

export default function ToolBlock({ node }: ToolBlockProps): React.JSX.Element | null {
  const [commandExpanded, setCommandExpanded] = useState(false);
  const commandRef = useRef<HTMLSpanElement>(null);
  const [isCommandTruncated, setIsCommandTruncated] = useState(false);

  // For read tool: filter hint lines and detect images
  const cleanedOutput = useMemo(() => cleanReadOutput(node), [node]);
  const imagePath = useMemo(() => getReadImagePath(node), [node]);

  useEffect(() => {
    if (commandRef.current) {
      setIsCommandTruncated(commandRef.current.scrollHeight > commandRef.current.clientHeight);
    }
  }, [node, commandExpanded]);

  // Read tool returns fast — skip rendering the running state to avoid flicker
  if (node.name === 'read' && node.status === 'running') return null;

  const { className: statusClassName, style: statusStyle } = STATUS_CONFIG[node.status];
  // A successful edit already shows its result via the diff, so its green
  // footer fill clashes with the diff's green. Keep the footer bar and its
  // green text, but drop the background for this case; other statuses stay
  // fully colored.
  const isSuccessfulEdit = node.name === 'edit' && node.status === 'success';
  const footerStyle = isSuccessfulEdit ? undefined : statusStyle;
  const command = getToolCommandParts(node);
  const editDiffFromDetails = getEditDiffFromDetails(node);
  const writeEntries = getWriteEntries(node);
  const hasOutput = cleanedOutput.length > 0;
  // While running, the body is empty until content loads; show a skeleton
  // instead of a blank card. Each tool gets a placeholder matching its real
  // output: a diff for edit, file lines for write, terminal lines for bash.
  const showEditSkeleton = node.name === 'edit' && node.status === 'running';
  const showWriteSkeleton =
    node.name === 'write' && node.status === 'running' && (writeEntries?.length ?? 0) === 0;
  const showBashSkeleton = node.name === 'bash' && node.status === 'running' && !hasOutput;
  const outputLanguage = getToolOutputLanguage(node);
  const durationLabel = formatDuration(node.durationMs);
  const args = getToolArgs(node);
  const timeout = typeof args?.timeout === 'number' ? args.timeout : undefined;

  return (
    <>
      <div
        className="overflow-clip rounded-md border border-border/65 bg-muted/25 px-3 pt-0 pb-1.5 text-sm text-muted-foreground flex flex-col"
        style={{
          maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px`,
          minHeight: node.status === 'running' ? TOOL_BLOCK_RUNNING_MIN_HEIGHT : undefined,
        }}
        data-testid={`tool-block-${node.toolCallId}`}
      >
        {command.body ? (
          <div className="-mx-3 flex items-start gap-1 px-3 py-1.5 font-mono text-[14px] font-medium leading-5 text-foreground border-b border-border/80">
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
            {(isCommandTruncated || commandExpanded) && (
              <button
                type="button"
                onClick={() => setCommandExpanded((v) => !v)}
                className="shrink-0 self-end text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                {commandExpanded ? 'Less' : 'More'}
              </button>
            )}
          </div>
        ) : (
          <div className="-mx-3 flex items-start gap-1 px-3 py-1.5 font-mono text-[14px] font-medium leading-5 text-foreground border-b border-border/80">
            <span className="shrink-0">{command.prefix}</span>
            <span className="min-w-0 text-muted-foreground">…</span>
          </div>
        )}

        <OverflowClamp
          maxHeight={BLOCK_CONTENT_MAX_HEIGHT}
          className="py-2"
          tailAnchor={node.name !== 'edit'}
        >
          {node.status !== 'running' && node.status !== 'error' && editDiffFromDetails && (
            <DiffView lines={editDiffFromDetails} />
          )}

          {showEditSkeleton && <DiffSkeleton />}

          {/* Write preview shown during running (streaming) unlike edit which waits for completion */}
          {writeEntries && writeEntries.length > 0 && node.status !== 'error' && (
            <WritePreview
              content={writeEntries[0].newText}
              language={outputLanguage}
              isStreaming={node.status === 'running'}
            />
          )}

          {showWriteSkeleton && <WriteSkeleton />}

          {(node.status !== 'running' || STREAMING_OUTPUT_TOOLS.has(node.name)) &&
            hasOutput &&
            ((node.name !== 'edit' && node.name !== 'write') || node.status === 'error') && (
              <pre className="overflow-hidden whitespace-pre-wrap break-words font-mono text-[14px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                <SyntaxHighlightedCode code={cleanedOutput} language={outputLanguage} />
              </pre>
            )}

          {showBashSkeleton && <BashSkeleton />}
        </OverflowClamp>

        <div
          data-search-ignore
          className={cn(
            '-mx-3 -mb-2 mt-auto flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs rounded-b-md border-t border-border/80',
            statusClassName,
          )}
          style={footerStyle}
        >
          <span>
            {node.status === 'running' ? (
              <ElapsedTimer startedAt={node.startedAt} />
            ) : (
              <>{durationLabel && <span>{durationLabel}</span>}</>
            )}
          </span>
          {timeout !== undefined && <span data-search-ignore>timeout {timeout}s</span>}
        </div>
      </div>
      {imagePath && <ImagePreview src={`local-file://${imagePath}`} alt={imagePath} />}
    </>
  );
}
