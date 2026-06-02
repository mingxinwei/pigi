import { useRef, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  IconArrowUp,
  IconCheck,
  IconChevronRight,
  IconGitBranch,
  IconPlus,
  IconSquare,
} from '@tabler/icons-react';
import type {
  ContextUsage,
  ModelInfo,
  SkillSlashCommand,
  ThinkingLevel,
} from '../../../shared/ipcContract';
import type { SessionEntry } from '../state/appStore';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from './ui/input-group';
import { Button } from './ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Separator } from './ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { CHAT_INPUT_MAX_WIDTH } from '../lib/layoutConstants';
import { cn } from '../lib/utils';
import { getAllSlashCommands, matchSlashCommands, type SlashCommand } from '../lib/slashCommands';

interface ChatInputProps {
  onSend: (message: string) => void;
  onFollowUp: (message: string) => void;
  onAbort: () => void;
  onSlashCommand: (command: string, arg: string) => void;
  isStreaming: boolean;
  gitBranch: string | null;
  restoreText: string | null;
  onRestoredText: () => void;
  onRefreshGitBranch: () => Promise<void>;
  session: SessionEntry | null;
  modelOptions: ModelInfo[];
  thinkingLevelOptions: ThinkingLevel[];
  skillOptions: SkillSlashCommand[];
  onSelectModel: (model: ModelInfo) => void;
  onSelectThinkingLevel: (thinkingLevel: ThinkingLevel) => void;
}

const TOKEN_UNIT = 1000;
const TOKEN_SUFFIX = 'k';
const UNKNOWN_STATUS = '--';
const MODEL_FALLBACK = 'Model';
const THINKING_FALLBACK = 'Thinking';
const MODEL_OPTION_KEY_SEPARATOR = '|';
const CONTEXT_USAGE_UNAVAILABLE = 'context --';
const AUTO_COMPACT_LABEL = 'auto';
const MODEL_SEARCH_PLACEHOLDER = 'Search models';
const MODEL_EMPTY_TEXT = 'No models found';
const MODEL_LIST_MAX_HEIGHT_CLASS = 'max-h-56';
const THINKING_MENU_LABEL = 'Thinking';
const THINKING_LEVEL_VALUES: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];
const TEXTAREA_MAX_HEIGHT_RATIO = 0.35;

export default function ChatInput({
  onSend,
  onFollowUp,
  onAbort,
  onSlashCommand,
  isStreaming,
  gitBranch,
  restoreText,
  onRestoredText,
  onRefreshGitBranch,
  session,
  modelOptions,
  thinkingLevelOptions,
  onSelectModel,
  onSelectThinkingLevel,
  skillOptions,
}: ChatInputProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const prevSessionIdRef = useRef<string | null>(null);
  const [slashMatches, setSlashMatches] = useState<{
    builtin: SlashCommand[];
    skill: SlashCommand[];
  }>({ builtin: [], skill: [] });
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const slashListRef = useRef<HTMLDivElement>(null);

  const allSlashCommands = useMemo(() => getAllSlashCommands(skillOptions), [skillOptions]);

  // Flat index helpers for keyboard nav across builtin + skill groups
  const flatSlashMatches = useMemo(() => {
    const items: SlashCommand[] = [];
    for (const cmd of slashMatches.builtin) items.push(cmd);
    for (const cmd of slashMatches.skill) items.push(cmd);
    return items;
  }, [slashMatches]);
  const hasSlashMatches = slashMatches.builtin.length > 0 || slashMatches.skill.length > 0;

  // Scroll selected slash item into view
  useEffect(() => {
    if (!hasSlashMatches) return;
    const container = slashListRef.current;
    if (!container) return;
    // The scrollable element is PopoverContent (parent of the ref div)
    const scrollParent = container.parentElement;
    if (!scrollParent) return;
    if (selectedSlashIndex === 0) {
      scrollParent.scrollTop = 0;
      return;
    }
    const buttons = container.querySelectorAll('button');
    const selected = buttons[selectedSlashIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedSlashIndex, hasSlashMatches]);

  // Save/restore draft per session
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const prevId = prevSessionIdRef.current;
    const currentId = session?.sessionId ?? null;

    // Save previous session's draft
    if (prevId && prevId !== currentId) {
      const draft = textarea.value;
      if (draft) {
        draftsRef.current.set(prevId, draft);
      } else {
        draftsRef.current.delete(prevId);
      }
    }

    // Restore current session's draft
    if (currentId !== prevId) {
      textarea.value = draftsRef.current.get(currentId ?? '') ?? '';
      // Auto-focus the input when switching to a new/different session
      textarea.focus();
    }

    prevSessionIdRef.current = currentId;
  }, [session?.sessionId]);

  // Restore text from abort/dequeue
  useEffect(() => {
    if (restoreText === null) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Join restored text with current input (current goes last)
    const currentText = textarea.value.trim();
    const combined = [restoreText, currentText].filter((t) => t).join('\n\n');
    textarea.value = combined;
    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight * TEXTAREA_MAX_HEIGHT_RATIO;
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    textarea.focus();
    onRestoredText();
  }, [restoreText, onRestoredText]);
  const contextUsage = session?.contextUsage ?? null;
  const autoCompactionEnabled = session?.autoCompactionEnabled ?? false;
  const contextUsageLabel = formatContextUsage(contextUsage, autoCompactionEnabled);
  const modelLabel = session?.model?.name ?? MODEL_FALLBACK;
  const rawThinkingLevel = session?.thinkingLevel ?? null;
  const thinkingValue =
    rawThinkingLevel && isThinkingLevel(rawThinkingLevel) ? rawThinkingLevel : null;
  const thinkingLabel = rawThinkingLevel ?? THINKING_FALLBACK;

  const handleSend = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const text = textarea.value.trim();
    if (!text) {
      return;
    }

    // Check for slash command (only if it matches a known command)
    if (text.startsWith('/')) {
      const spaceIndex = text.indexOf(' ');
      const name = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
      const arg = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();

      // Check builtin commands
      const builtinMatch = allSlashCommands.find((c) => c.source === 'builtin' && c.name === name);
      if (builtinMatch) {
        textarea.value = '';
        textarea.style.height = 'auto';
        setSlashMatches({ builtin: [], skill: [] });
        onSlashCommand(name, arg);
        return;
      }

      // Check skill commands — send as regular prompt, SDK handles expansion
      const skillMatch = allSlashCommands.find((c) => c.source === 'skill' && c.name === name);
      if (skillMatch) {
        textarea.value = '';
        textarea.style.height = 'auto';
        setSlashMatches({ builtin: [], skill: [] });
        onSend(text);
        return;
      }
      // Not a known command — fall through and send as regular message
    }

    textarea.value = '';
    textarea.style.height = 'auto';
    onSend(text);
  }, [onSend, onSlashCommand, allSlashCommands]);

  const handleFollowUpSend = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    textarea.style.height = 'auto';
    onFollowUp(text);
  }, [onFollowUp]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.key === 'Process') {
        return;
      }

      // Slash command autocomplete navigation
      if (hasSlashMatches) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedSlashIndex((i) => (i - 1 + flatSlashMatches.length) % flatSlashMatches.length);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedSlashIndex((i) => (i + 1) % flatSlashMatches.length);
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault();
          const selectedCommand = flatSlashMatches[selectedSlashIndex];
          if (selectedCommand && textareaRef.current) {
            if (selectedCommand.source === 'builtin' && !selectedCommand.hasArg) {
              // Builtin no-arg: execute immediately (e.g., /compact, /new)
              textareaRef.current.value = '';
              textareaRef.current.style.height = 'auto';
              setSlashMatches({ builtin: [], skill: [] });
              onSlashCommand(selectedCommand.name, '');
            } else {
              textareaRef.current.value = `/${selectedCommand.name} `;
              setSlashMatches({ builtin: [], skill: [] });
              textareaRef.current.focus();
            }
          }
          return;
        }
        if (e.key === 'Escape') {
          setSlashMatches({ builtin: [], skill: [] });
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Alt+Enter queues a follow-up message during streaming
      if (e.key === 'Enter' && e.altKey && isStreaming) {
        e.preventDefault();
        handleFollowUpSend();
      }
    },
    [
      handleSend,
      handleFollowUpSend,
      isStreaming,
      hasSlashMatches,
      flatSlashMatches,
      selectedSlashIndex,
    ],
  );

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight * TEXTAREA_MAX_HEIGHT_RATIO;
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';

    // Update slash command matches
    const value = textarea.value;
    setSlashMatches(matchSlashCommands(value, allSlashCommands));
    setSelectedSlashIndex(0);
  }, [allSlashCommands]);

  return (
    <div className="relative z-10 shrink-0 px-8 pb-3" data-testid="chat-input">
      <Popover
        open={hasSlashMatches}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSlashMatches({ builtin: [], skill: [] });
        }}
      >
        <PopoverContent
          side="top"
          align="start"
          sideOffset={6}
          className="max-h-[40vh] overflow-y-auto p-1 bg-popover/50"
          style={{ width: `${CHAT_INPUT_MAX_WIDTH}px` }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div ref={slashListRef}>
            {slashMatches.builtin.map((slashCommand, i) => (
              <SlashCommandItem
                key={slashCommand.name}
                slashCommand={slashCommand}
                isSelected={i === selectedSlashIndex}
                onSelect={() => {
                  const textarea = textareaRef.current;
                  if (!textarea) return;
                  textarea.value = `/${slashCommand.name} `;
                  setSlashMatches({ builtin: [], skill: [] });
                  textarea.focus();
                }}
                onHover={() => setSelectedSlashIndex(i)}
              />
            ))}
            {slashMatches.builtin.length > 0 && slashMatches.skill.length > 0 && (
              <Separator className="my-0.5 mx-auto h-px !w-[98%] opacity-90" />
            )}
            {slashMatches.skill.map((slashCommand, i) => {
              const flatIndex = slashMatches.builtin.length + i;
              return (
                <SlashCommandItem
                  key={slashCommand.name}
                  slashCommand={slashCommand}
                  isSelected={flatIndex === selectedSlashIndex}
                  onSelect={() => {
                    const textarea = textareaRef.current;
                    if (!textarea) return;
                    textarea.value = `/${slashCommand.name} `;
                    setSlashMatches({ builtin: [], skill: [] });
                    textarea.focus();
                  }}
                  onHover={() => setSelectedSlashIndex(flatIndex)}
                />
              );
            })}
          </div>
        </PopoverContent>
        <PopoverTrigger asChild>
          <div
            className="relative mx-auto w-full"
            style={{ maxWidth: `${CHAT_INPUT_MAX_WIDTH}px` }}
          >
            <InputGroup className="h-auto min-h-28 flex-col rounded-3xl border bg-background shadow-[0_10px_34px_rgb(0_0_0_/_0.075)] has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-inherit">
              <InputGroupTextarea
                ref={textareaRef}
                onKeyDown={handleKeyDown}
                onInput={handleInput}
                placeholder="Ask for follow-up changes"
                rows={1}
                className="flex-initial min-h-16 field-sizing-fixed px-4 pb-2 pt-4 text-sm leading-5 placeholder:text-muted-foreground/70 overflow-y-auto"
                data-testid="chat-textarea"
              />
              <InputGroupAddon
                align="block-end"
                className="min-w-0 justify-between gap-2 px-2.5 pb-2.5 pt-0"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-1">
                  <InputGroupButton
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 rounded-full"
                  >
                    <IconPlus />
                  </InputGroupButton>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <ModelSettingsPicker
                    modelLabel={modelLabel}
                    modelValue={session?.model ?? null}
                    modelOptions={modelOptions}
                    onSelectModel={onSelectModel}
                    thinkingLabel={thinkingLabel}
                    thinkingValue={thinkingValue}
                    thinkingOptions={thinkingLevelOptions}
                    onSelectThinkingLevel={onSelectThinkingLevel}
                  />
                </div>
                {isStreaming ? (
                  <InputGroupButton
                    onClick={onAbort}
                    size="icon-sm"
                    variant="default"
                    className="rounded-full"
                    data-testid="abort-button"
                  >
                    <IconSquare className="fill-current" />
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    onClick={handleSend}
                    size="icon-sm"
                    variant="default"
                    className="rounded-full bg-muted-foreground text-background hover:bg-foreground"
                    data-testid="send-button"
                  >
                    <IconArrowUp />
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>

            <div className="flex items-center justify-between gap-4 px-4 pt-1.5 text-sm text-muted-foreground">
              <span
                className="flex min-w-0 items-center gap-1.5"
                onClick={() => void onRefreshGitBranch()}
              >
                <IconGitBranch className="size-4 shrink-0" />
                <span className="truncate">{gitBranch ?? UNKNOWN_STATUS}</span>
              </span>
              <ContextUsageTooltip
                label={contextUsageLabel}
                contextUsage={contextUsage}
                autoCompactionEnabled={autoCompactionEnabled}
              />
            </div>
          </div>
        </PopoverTrigger>
      </Popover>
    </div>
  );
}

function ModelSettingsPicker({
  modelLabel,
  modelValue,
  modelOptions,
  onSelectModel,
  thinkingLabel,
  thinkingValue,
  thinkingOptions,
  onSelectThinkingLevel,
}: {
  modelLabel: string;
  modelValue: ModelInfo | null;
  modelOptions: ModelInfo[];
  onSelectModel: (model: ModelInfo) => void;
  thinkingLabel: string;
  thinkingValue: ThinkingLevel | null;
  thinkingOptions: ThinkingLevel[];
  onSelectThinkingLevel: (thinkingLevel: ThinkingLevel) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const modelListRef = useRef<HTMLDivElement>(null);
  const selectedKey = modelValue ? modelOptionKey(modelValue) : '';
  const canOpen = modelOptions.length > 0 || thinkingOptions.length > 0;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && !canOpen) return;
      setOpen(nextOpen);
      if (!nextOpen) {
        setModelSearch('');
      }
    },
    [canOpen],
  );

  useEffect(() => {
    if (!open || !modelValue) {
      if (!open) return;
      const frame = window.requestAnimationFrame(() => {
        modelListRef.current?.scrollTo({ top: 0 });
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const frame = window.requestAnimationFrame(() => {
      const selectedEl = modelListRef.current?.querySelector<HTMLElement>('[data-checked="true"]');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, modelValue]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      modelListRef.current?.scrollTo({ top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [modelSearch]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <ModelSettingsButton modelLabel={modelLabel} thinkingLabel={thinkingLabel} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-0 overflow-visible p-0">
        <Command className="rounded-b-none">
          <CommandInput
            autoFocus
            value={modelSearch}
            onValueChange={setModelSearch}
            placeholder={MODEL_SEARCH_PLACEHOLDER}
          />
          <CommandList ref={modelListRef} className={MODEL_LIST_MAX_HEIGHT_CLASS}>
            <CommandEmpty>{MODEL_EMPTY_TEXT}</CommandEmpty>
            <CommandGroup>
              {modelOptions.map((model) => {
                const key = modelOptionKey(model);
                return (
                  <CommandItem
                    key={key}
                    value={modelSearchValue(model)}
                    data-checked={key === selectedKey ? true : undefined}
                    className="rounded-lg"
                    onSelect={() => {
                      onSelectModel(model);
                      setOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{model.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatModelDetails(model)}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="px-2">
          <Separator className="bg-foreground/25 !h-[0.5px]" />
        </div>
        <ThinkingLevelFlyout
          value={thinkingValue}
          label={thinkingLabel}
          options={thinkingOptions}
          onSelect={(level) => {
            onSelectThinkingLevel(level);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function ModelSettingsButton({
  modelLabel,
  thinkingLabel,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  modelLabel: string;
  thinkingLabel: string;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'h-7 max-w-60 min-w-0 gap-1.5 rounded-md px-1.5 text-sm font-normal hover:bg-muted/70',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate text-foreground">{modelLabel}</span>
      <span className="shrink-0 text-muted-foreground">{thinkingLabel}</span>
    </Button>
  );
}

function ThinkingLevelFlyout({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: ThinkingLevel | null;
  options: ThinkingLevel[];
  onSelect: (thinkingLevel: ThinkingLevel) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative px-2 py-1.5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={options.length === 0}
        className="h-8 w-full justify-start gap-2 rounded-lg px-1.5 text-sm font-normal hover:bg-muted/60 border-0"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-left text-foreground">
          {THINKING_MENU_LABEL}
        </span>
        <span className="sr-only">{label}</span>
        <IconChevronRight data-icon="inline-end" className="ml-auto text-muted-foreground" />
      </Button>

      {open && options.length > 0 && (
        <div className="absolute bottom-1 left-full pl-1">
          <div
            role="menu"
            className="min-w-28 rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
          >
            {options.map((level) => (
              <Button
                key={level}
                type="button"
                variant="ghost"
                size="sm"
                role="menuitemradio"
                aria-checked={level === value}
                className={cn(
                  'h-7 w-full justify-start gap-2 rounded-md px-2 text-sm font-normal',
                  level === value && 'bg-muted text-foreground',
                )}
                onClick={() => {
                  onSelect(level);
                }}
              >
                <span>{level}</span>
                {level === value && <IconCheck data-icon="inline-end" className="ml-auto" />}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContextUsageTooltip({
  label,
  contextUsage,
  autoCompactionEnabled,
}: {
  label: string;
  contextUsage: ContextUsage | null;
  autoCompactionEnabled: boolean;
}): React.JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="shrink-0 text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="max-w-none">
          <div className="flex flex-col gap-1 text-left">
            <span>Total context window: {formatContextWindow(contextUsage)}</span>
            <span>Used: {formatUsedContext(contextUsage)}</span>
            <span>{formatAutoCompactExplanation(autoCompactionEnabled)}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function modelOptionKey(model: ModelInfo): string {
  return `${model.provider}${MODEL_OPTION_KEY_SEPARATOR}${model.id}`;
}

function modelSearchValue(model: ModelInfo): string {
  return [model.name, model.provider, model.id, model.api].join(' ');
}

function formatModelDetails(model: ModelInfo): string {
  return `${model.provider}/${model.id} - ${formatTokenCount(model.contextWindow)} context`;
}

function isThinkingLevel(level: string): level is ThinkingLevel {
  // Cast required: TS Array.includes() signature doesn't accept supertype
  return THINKING_LEVEL_VALUES.includes(level as ThinkingLevel);
}

function formatContextUsage(
  contextUsage: ContextUsage | null,
  autoCompactionEnabled: boolean,
): string {
  if (!contextUsage || contextUsage.tokens === null || contextUsage.percent === null) {
    return CONTEXT_USAGE_UNAVAILABLE;
  }
  const suffix = autoCompactionEnabled ? ` (${AUTO_COMPACT_LABEL})` : '';
  return `${formatPercent(contextUsage.percent)}/${formatTokenCount(contextUsage.contextWindow)}${suffix}`;
}

function formatContextWindow(contextUsage: ContextUsage | null): string {
  if (!contextUsage) {
    return UNKNOWN_STATUS;
  }
  return formatTokenCount(contextUsage.contextWindow);
}

function formatUsedContext(contextUsage: ContextUsage | null): string {
  if (!contextUsage || contextUsage.tokens === null || contextUsage.percent === null) {
    return UNKNOWN_STATUS;
  }
  return `${formatTokenCount(contextUsage.tokens)} (${formatPercent(contextUsage.percent)})`;
}

function formatAutoCompactExplanation(autoCompactionEnabled: boolean): string {
  if (autoCompactionEnabled) {
    return 'Context auto compact is enabled.';
  }
  return 'Context auto compact is not enabled.';
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatTokenCount(value: number): string {
  return `${Math.round(value / TOKEN_UNIT)}${TOKEN_SUFFIX}`;
}

function SlashCommandItem({
  slashCommand,
  isSelected,
  onSelect,
  onHover,
}: {
  slashCommand: SlashCommand;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm',
        isSelected && 'bg-[var(--system-accent)] text-white',
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onHover}
    >
      <span className={cn('shrink-0 font-mono', isSelected ? 'text-white' : 'text-foreground')}>
        /{slashCommand.name}
      </span>
      {slashCommand.source !== 'skill' && (
        <span
          className={cn('min-w-0 truncate', isSelected ? 'text-white' : 'text-muted-foreground')}
        >
          {slashCommand.description}
        </span>
      )}
    </button>
  );
}
