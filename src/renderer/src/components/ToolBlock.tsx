import { useState, useEffect, useRef } from 'react'
import { IconBan, IconCheck, IconX } from '@tabler/icons-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { ToolNode } from '../state/transcriptController'
import { MESSAGE_CONTENT_MAX_WIDTH } from '../lib/layoutConstants'
import SyntaxHighlightedCode from './syntaxHighlightedCode'
import DiffView from './DiffView'
import type { EditEntry } from '../lib/diffUtils'

interface ToolBlockProps {
  node: ToolNode
}

interface ToolCommandParts {
  prefix: string
  body: string
}

const STATUS_CONFIG = {
  running: {
    label: 'Running',
    Icon: null,
    className: 'bg-yellow-50 text-yellow-700',
  },
  success: {
    label: 'Succeeded',
    Icon: IconCheck,
    className: 'bg-green-50 text-green-700',
  },
  error: {
    label: 'Failed',
    Icon: IconX,
    className: 'bg-red-50 text-red-700',
  },
  cancelled: {
    label: 'Cancelled',
    Icon: IconBan,
    className: 'bg-muted/60 text-muted-foreground',
  },
} as const

function ElapsedTimer(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return <span className="tabular-nums">Elapsed {elapsed.toFixed(1)}s</span>
}

export const TOOL_OUTPUT_LINE_LIMIT = 10

const SECONDS_PER_MILLISECOND = 1 / 1000

const TOOL_OUTPUT_LANGUAGE_BY_NAME: Record<string, string> = {
  bash: 'bash',
}

const FILE_EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  css: 'css',
  cts: 'typescript',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  py: 'python',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'zsh',
}

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') {
    return ''
  }

  const record = args as Record<string, unknown>
  if (Object.keys(record).length === 0) {
    return ''
  }

  return JSON.stringify(record, null, 2)
}

function getToolCommandParts(node: ToolNode): ToolCommandParts | null {
  const args = node.args as Record<string, unknown> | undefined
  if (!args) {
    return null
  }

  switch (node.name) {
    case 'bash': {
      return { prefix: '$', body: String(args.command ?? '') }
    }
    case 'read':
    case 'write': {
      const path = String(args.path ?? '')
      return path
        ? { prefix: node.name, body: path }
        : { prefix: node.name, body: formatToolArgs(args) }
    }
    case 'edit': {
      const path = String(args.path ?? '')
      return path
        ? { prefix: node.name, body: path }
        : { prefix: node.name, body: formatToolArgs(args) }
    }
    default:
      return { prefix: node.name, body: formatToolArgs(args) }
  }
}

function getToolOutputLanguage(node: ToolNode): string {
  const args = node.args as Record<string, unknown> | undefined
  const path = typeof args?.path === 'string' ? args.path : ''
  return getLanguageFromPath(path) ?? TOOL_OUTPUT_LANGUAGE_BY_NAME[node.name] ?? 'bash'
}

function getLanguageFromPath(path: string): string | null {
  const fileName = path.split('/').pop() ?? ''
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : ''
  if (!extension) {
    return null
  }

  return FILE_EXTENSION_LANGUAGE_MAP[extension] ?? null
}

function getEditEntries(node: ToolNode): EditEntry[] | null {
  if (node.name !== 'edit') return null
  const args = node.args as Record<string, unknown> | undefined
  if (!args) return null
  const edits = args.edits as Array<{ oldText?: string; newText?: string }> | undefined
  if (!Array.isArray(edits) || edits.length === 0) return null
  return edits
    .filter((e) => typeof e.oldText === 'string' && typeof e.newText === 'string')
    .map((e) => ({ oldText: e.oldText!, newText: e.newText! }))
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs)) {
    return null
  }

  const seconds = Math.max(0.1, durationMs * SECONDS_PER_MILLISECOND)
  const formattedSeconds = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString()
  return `Took ${formattedSeconds}s`
}

export default function ToolBlock({ node }: ToolBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { Icon: StatusIcon, className: statusClassName } = STATUS_CONFIG[node.status]
  const command = getToolCommandParts(node)
  const editEntries = getEditEntries(node)
  const hasOutput = node.output.length > 0
  const outputLines = node.output.split('\n')
  const visibleOutput = expanded
    ? node.output
    : outputLines.slice(-TOOL_OUTPUT_LINE_LIMIT).join('\n')
  const hiddenLineCount = Math.max(0, outputLines.length - TOOL_OUTPUT_LINE_LIMIT)
  const outputLanguage = getToolOutputLanguage(node)
  const durationLabel = formatDuration(node.durationMs)

  return (
    <div
      className="overflow-hidden rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-sm text-muted-foreground"
      style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      data-testid={`tool-block-${node.toolCallId}`}
    >
      {command && (
        <div className="flex items-start gap-1 rounded bg-background/75 py-1.5 font-mono text-[14px] font-semibold leading-5 text-foreground">
          <span className="shrink-0">{command.prefix}</span>
          <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {command.body}
          </span>
        </div>
      )}

      {editEntries && editEntries.length > 0 && node.status !== 'error' && (
        <DiffView edits={editEntries} />
      )}

      {hasOutput && (node.name !== 'edit' || node.status === 'error') && (
        <>
          <pre className="mt-2 overflow-hidden whitespace-pre-wrap break-words font-mono text-[14px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
            {!expanded && hiddenLineCount > 0 && (
              <code className="mb-1 block bg-transparent p-0 font-mono text-[14px]">
                {`... (${hiddenLineCount.toLocaleString()} earlier lines)`}
              </code>
            )}
            <SyntaxHighlightedCode code={visibleOutput} language={outputLanguage} />
          </pre>
          {hiddenLineCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mt-1 h-7 px-2 text-xs text-muted-foreground hover:bg-muted/70"
              onClick={() => {
                setExpanded((current) => !current)
              }}
            >
              {expanded ? 'Show less' : 'Show all'}
            </Button>
          )}
        </>
      )}

      <div
        className={cn(
          '-mx-3 -mb-2 mt-2 flex items-center justify-start gap-1.5 px-3 py-1.5 text-xs',
          statusClassName,
        )}
      >
        {node.status === 'running' ? (
          <ElapsedTimer />
        ) : (
          <>
            {durationLabel && <span>{durationLabel}</span>}
            {StatusIcon && <StatusIcon className="size-3.5" />}
          </>
        )}
      </div>
    </div>
  )
}
