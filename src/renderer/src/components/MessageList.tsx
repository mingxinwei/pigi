import React, { useRef, useLayoutEffect, useEffect, useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowDown, IconCopy, IconCheck, IconSparkles } from '@tabler/icons-react';
import {
  type TranscriptNode,
  type AssistantNode,
  type ToolNode,
  type UserNode,
  getToolArgs,
} from '../state/transcriptController';
import { MESSAGE_CONTENT_MAX_WIDTH, MESSAGE_LIST_MAX_WIDTH } from '../lib/layoutConstants';
import ToolBlock from './ToolBlock';
import MarkdownMessage from './markdownMessage';
import { cn } from '../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import UserMessageMiniMap from './UserMessageMiniMap';

interface MessageListProps {
  nodes: TranscriptNode[];
  sessionPath: string;
}

function isRenderableNode(node: TranscriptNode): boolean {
  if (node.role !== 'assistant') return true;
  return Boolean(node.text || node.thinking || node.errorMessage);
}

const MESSAGE_ROW_GAP = 4;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 2;
const SCROLL_BUTTON_VIEWPORT_MULTIPLIER = 2;
const TOOL_BLOCK_ESTIMATE_BUFFER = 24;
const TOOL_STATUS_LINE_ESTIMATE_HEIGHT = 24;
const USER_MESSAGE_TOOLBAR_HEIGHT = 24;
const USER_MESSAGE_LEADING_PADDING = 24;
const USER_MESSAGE_TRAILING_PADDING = 8;
const USER_MESSAGE_WRAP_ESTIMATE_WIDTH = 72;
/** Max estimated height for user bubbles capped by max-h-[40vh] CSS */
const USER_MESSAGE_MAX_ESTIMATE_HEIGHT = 400;
/** Max height (px) for user bubble content before showing expand button */
const USER_MESSAGE_MAX_HEIGHT = 360;

export default React.memo(function MessageList({
  nodes,
  sessionPath,
}: MessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const lastNodeIdRef = useRef<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const displayNodes = useMemo(() => nodes.filter(isRenderableNode), [nodes]);

  const getItemKey = useCallback(
    (index: number) => displayNodes[index]?.id ?? index,
    [displayNodes],
  );

  // TanStack Virtual returns imperative measurement helpers; this follows its documented React pattern.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: displayNodes.length,
    getScrollElement: () => containerRef.current,
    getItemKey,
    estimateSize: (index) => estimateNodeHeight(displayNodes[index]),
    overscan: 8,
    gap: MESSAGE_ROW_GAP,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });

  // Disable virtualizer scroll corrections when auto-scroll is off.
  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => autoScrollRef.current;

  // Resume auto-scroll when a new user message appears
  useLayoutEffect(() => {
    const lastNode = displayNodes[displayNodes.length - 1];
    if (lastNode?.id !== lastNodeIdRef.current && lastNode?.role === 'user') {
      autoScrollRef.current = true;
    }
    lastNodeIdRef.current = lastNode?.id ?? null;
  }, [displayNodes]);

  // Auto-scroll + wheel handler. ResizeObserver on the scroll container
  // detects when content height changes (virtualizer spacer div grows).
  // Stable effect — never re-created.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastScrollHeight = container.scrollHeight;
    let pendingRaf = 0;

    function scrollToBottom(): void {
      if (!autoScrollRef.current) return;
      container!.scrollTop = container!.scrollHeight;
    }

    const ro = new ResizeObserver(() => {
      if (container!.scrollHeight !== lastScrollHeight) {
        lastScrollHeight = container!.scrollHeight;
        if (pendingRaf) cancelAnimationFrame(pendingRaf);
        pendingRaf = requestAnimationFrame(scrollToBottom);
      }
    });
    // Observe the first child (the content wrapper whose height changes)
    const content = container.firstElementChild;
    if (content) ro.observe(content);

    // Also observe the container itself — when it shrinks (e.g. StreamingQueue appears)
    // we need to scroll to bottom so content isn't hidden.
    const containerRo = new ResizeObserver(() => {
      if (autoScrollRef.current) {
        if (pendingRaf) cancelAnimationFrame(pendingRaf);
        pendingRaf = requestAnimationFrame(scrollToBottom);
      }
      setContainerWidth(container!.clientWidth);
    });
    containerRo.observe(container);
    setContainerWidth(container.clientWidth);

    function handleWheel(event: WheelEvent): void {
      if (event.deltaY < 0) {
        autoScrollRef.current = false;
      } else if (event.deltaY > 0 && !autoScrollRef.current && isAtBottom(container!)) {
        autoScrollRef.current = true;
      }
    }

    function handleScroll(): void {
      const distanceFromBottom =
        container!.scrollHeight - container!.scrollTop - container!.clientHeight;
      setShowScrollButton(
        distanceFromBottom > container!.clientHeight * SCROLL_BUTTON_VIEWPORT_MULTIPLIER,
      );
    }

    container.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    container.addEventListener('scroll', handleScroll, { passive: true });

    scrollToBottom();

    return () => {
      ro.disconnect();
      containerRo.disconnect();
      if (pendingRaf) cancelAnimationFrame(pendingRaf);
      container.removeEventListener('wheel', handleWheel, { capture: true });
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Save scroll position to store on every scroll event
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionPath) return;

    function savePosition(): void {
      useAppStore.getState().setScrollPosition(sessionPath, container!.scrollTop);
    }

    container.addEventListener('scroll', savePosition, { passive: true });
    return () => container.removeEventListener('scroll', savePosition);
  }, [sessionPath]);

  // Restore saved scroll position on session change, or auto-scroll to bottom
  useEffect(() => {
    let cancelled = false;

    const savedPosition = sessionPath
      ? useAppStore.getState().scrollPositions.get(sessionPath)
      : undefined;

    if (savedPosition !== undefined) {
      autoScrollRef.current = false;
      requestAnimationFrame(() => {
        if (!cancelled && containerRef.current) {
          containerRef.current.scrollTop = savedPosition;
        }
      });
    } else {
      autoScrollRef.current = true;
    }

    return () => {
      cancelled = true;
    };
  }, [sessionPath]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  function handleScrollToBottom(): void {
    const container = containerRef.current;
    if (!container) return;
    autoScrollRef.current = true;
    container.scrollTop = container.scrollHeight;
    setShowScrollButton(false);
  }

  const handleScrollToIndex = useCallback(
    (index: number) => {
      autoScrollRef.current = false;
      rowVirtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' });
    },
    [rowVirtualizer],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto bg-background [overflow-anchor:none]"
        data-testid="message-list"
      >
        <div
          className="mx-auto px-5 pb-8 pt-14 user-content"
          style={{ maxWidth: `${MESSAGE_LIST_MAX_WIDTH}px` }}
        >
          {displayNodes.length === 0 && <div style={{ minHeight: '60vh' }} />}

          <div
            className="relative"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            data-testid="message-virtualizer"
          >
            {virtualItems.map((virtualItem) => {
              const node = displayNodes[virtualItem.index];
              return (
                <div
                  key={node.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <NodeRenderer node={node} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <UserMessageMiniMap
        nodes={displayNodes}
        containerWidth={containerWidth}
        onScrollToIndex={handleScrollToIndex}
      />
      {/* Bottom gradient fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-background to-transparent" />
      {showScrollButton && (
        <button
          type="button"
          onClick={handleScrollToBottom}
          className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center justify-center rounded-full border-[0.5px] border-border bg-background/90 shadow-md backdrop-blur-sm transition-opacity hover:bg-muted size-9"
        >
          <IconArrowDown className="size-5 text-muted-foreground" stroke={1.5} />
        </button>
      )}
    </div>
  );
});

function estimateNodeHeight(node: TranscriptNode | undefined): number {
  if (!node) {
    return 96;
  }
  switch (node.role) {
    case 'user':
      return estimateUserHeight(node.text);
    case 'assistant':
      return estimateAssistantHeight(node);
    case 'tool':
      return estimateToolHeight(node);
    case 'system':
      return 56;
  }
}

function isAtBottom(container: HTMLDivElement): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <
    AUTO_SCROLL_BOTTOM_THRESHOLD
  );
}

function estimateUserHeight(text: string): number {
  if (parseSkillBlock(text)) {
    return 88;
  }
  const visibleLineCount = countLines(text);
  const characterLineCount = Math.ceil(text.length / USER_MESSAGE_WRAP_ESTIMATE_WIDTH);
  const estimatedLineCount = Math.max(visibleLineCount, characterLineCount);
  const rawHeight =
    estimatedLineCount * 24 +
    32 +
    USER_MESSAGE_TOOLBAR_HEIGHT +
    USER_MESSAGE_LEADING_PADDING +
    USER_MESSAGE_TRAILING_PADDING;
  return Math.max(56, Math.min(rawHeight, USER_MESSAGE_MAX_ESTIMATE_HEIGHT));
}

function estimateAssistantHeight(node: AssistantNode): number {
  const textLength = node.text.length + node.thinking.length;
  const lineCount = countLines(node.text) + countLines(node.thinking);
  return Math.max(80, Math.max(Math.ceil(textLength / 84), lineCount) * 24 + 56);
}

/** Max height used by ToolBlock for content truncation */
const TOOL_BLOCK_CONTENT_MAX_HEIGHT = 300;

function estimateToolHeight(node: ToolNode): number {
  const outputLineCount = node.output ? node.output.split('\n').length : 0;
  const commandLineCount = estimateToolCommandLineCount(node);
  const contentHeight = outputLineCount * 20;
  const cappedContentHeight = Math.min(contentHeight, TOOL_BLOCK_CONTENT_MAX_HEIGHT);

  return Math.max(
    96,
    commandLineCount * 24 +
      cappedContentHeight +
      TOOL_STATUS_LINE_ESTIMATE_HEIGHT +
      TOOL_BLOCK_ESTIMATE_BUFFER,
  );
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split('\n').length;
}

function estimateToolCommandLineCount(node: ToolNode): number {
  const args = getToolArgs(node);
  const command =
    node.name === 'bash'
      ? `$ ${String(args?.command ?? '')}`
      : node.name === 'read' || node.name === 'write' || node.name === 'edit'
        ? `${node.name} ${String(args?.path ?? '')}`
        : String(JSON.stringify(args ?? {}) ?? '');

  return Math.min(2, Math.max(1, Math.ceil(command.length / 80)));
}

function NodeRenderer({ node }: { node: TranscriptNode }): React.JSX.Element {
  switch (node.role) {
    case 'user':
      return <UserBubble node={node} />;
    case 'assistant':
      return <AssistantBubble node={node} />;
    case 'tool':
      return (
        <div className="group">
          <ToolBlock node={node} />
          <MessageToolbar text={node.output} />
        </div>
      );
    case 'system':
      return <SystemBubble text={node.text} isLoading={node.isLoading} />;
  }
}

function UserBubble({ node }: { node: UserNode }): React.JSX.Element {
  const { text } = node;
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const skillBlock = useMemo(() => parseSkillBlock(text), [text]);

  useEffect(() => {
    if (contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > USER_MESSAGE_MAX_HEIGHT);
    }
  }, [text, expanded]);

  if (skillBlock) {
    return <SkillLinkBubble skillBlock={skillBlock} timestamp={node.sentAt} />;
  }

  return (
    <div className="flex justify-end pb-2 pt-6" data-testid="user-message">
      <div className="group flex max-w-[85%] flex-col items-end">
        <div className={cn('max-w-full w-fit rounded-2xl bg-muted overflow-hidden')}>
          <div
            ref={contentRef}
            className={cn(
              'px-3.5 py-1.5 text-[15px] leading-6 text-foreground',
              'whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
              'overflow-hidden',
            )}
            style={{
              maxHeight: expanded ? undefined : '40vh',
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
            {text}
          </div>
          {isOverflowing && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="block w-full px-3.5 pt-1.5 pb-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
        <div className="flex h-6 w-full items-center justify-end gap-2 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
          <MessageToolbar text={node.text} />
          <span className="text-xs text-muted-foreground">
            {formatUserMessageTime(node.sentAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function formatUserMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (isSameLocalDay(date, new Date())) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    year: isSameLocalYear(date, new Date()) ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameLocalYear(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear();
}

interface ParsedSkillBlock {
  name: string;
  body: string;
  userMessage: string | undefined;
}

const SKILL_BLOCK_PATTERN =
  /^<skill name="([^"]+)" location="[^"]+">\r?\n([\s\S]*?)\r?\n<\/skill>(?:\r?\n\r?\n([\s\S]+))?$/;

function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(SKILL_BLOCK_PATTERN);
  if (!match) return null;
  return {
    name: match[1],
    body: match[2],
    userMessage: match[3] || undefined,
  };
}

function SkillLinkBubble({
  skillBlock,
  timestamp,
}: {
  skillBlock: ParsedSkillBlock;
  timestamp: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex justify-end pb-2 pt-6" data-testid="skill-message">
      <div className="group flex max-w-[85%] flex-col items-end">
        <div className="rounded-2xl bg-muted px-3.5 py-1.5 text-[15px] leading-6 text-foreground max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] w-fit">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline text-[var(--system-accent)] hover:opacity-80 cursor-pointer"
              >
                <IconSparkles className="size-4 shrink-0 inline -mt-0.5 mr-0.5" />
                {skillBlock.name}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="w-[32rem] max-h-[60vh] overflow-y-auto p-4"
            >
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <IconSparkles className="size-4 shrink-0" />
                <span>{skillBlock.name}</span>
              </div>
              <MarkdownMessage text={skillBlock.body} />
            </PopoverContent>
          </Popover>
          {skillBlock.userMessage && <> {skillBlock.userMessage}</>}
        </div>
        <div className="flex h-6 w-full items-center justify-end gap-2 pt-1">
          <span className="text-xs text-muted-foreground">{formatUserMessageTime(timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({ node }: { node: AssistantNode }): React.JSX.Element {
  const showThinking = node.thinking.length > 0;
  const showText = node.text.length > 0;

  return (
    <div className="group flex justify-start" data-testid="assistant-message">
      <div
        className="w-full min-w-0 text-[15px] leading-6 text-foreground"
        style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      >
        {showThinking && <ThinkingBlock text={node.thinking} />}

        {showText && (
          <div style={{ marginTop: showThinking ? `${MESSAGE_ROW_GAP}px` : undefined }}>
            <MarkdownMessage text={node.text} />
          </div>
        )}

        {node.errorMessage && (
          <div className="mt-3 w-fit rounded-lg bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
            {node.errorMessage}
          </div>
        )}

        <MessageToolbar text={node.text || node.thinking} />
      </div>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="rounded-md bg-muted/70 px-3 py-1.5 text-muted-foreground">
      <div className="text-[13px] font-medium">Thinking</div>
      <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-5 text-muted-foreground">
        {text}
      </pre>
    </div>
  );
}

function SystemBubble({
  text,
  isLoading,
}: {
  text: string;
  isLoading?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-2" data-testid="system-message">
      <div className="h-px flex-1 bg-border" />
      <span className="relative shrink-0 text-sm text-muted-foreground overflow-hidden">
        {text}
        {isLoading && (
          <span
            className="absolute inset-0 animate-[shimmer_2.5s_linear_infinite]"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, transparent 30%, rgba(255,255,255,0.95) 50%, transparent 70%, transparent 100%)',
              backgroundSize: '200% 100%',
            }}
          />
        )}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function MessageToolbar({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <div className="flex h-6 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
        onClick={handleCopy}
        title="Copy message"
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}
