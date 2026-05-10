import { useMemo } from 'react';
import {
  computeEditDiffLines,
  collapseContext,
  type EditEntry,
  type DiffLine,
  type IntraLineSegment,
} from '../lib/diffUtils';
import { cn } from '../lib/utils';

interface DiffViewProps {
  edits: EditEntry[];
}

const LINE_STYLES = {
  add: 'bg-green-500/15 text-green-700 dark:text-green-400',
  remove: 'bg-red-500/15 text-red-700 dark:text-red-400',
  context: 'text-muted-foreground',
} as const;

const HIGHLIGHT_STYLES = {
  add: 'bg-green-500/30 rounded-sm',
  remove: 'bg-red-500/30 rounded-sm',
} as const;

const PREFIX = {
  add: '+',
  remove: '-',
  context: ' ',
} as const;

function renderContent(line: DiffLine): React.JSX.Element {
  if (!line.segments || line.segments.length === 0) {
    return <span className="min-w-0 whitespace-pre-wrap break-all px-2">{line.content}</span>;
  }
  const style = line.type === 'add' ? HIGHLIGHT_STYLES.add : HIGHLIGHT_STYLES.remove;
  return (
    <span className="min-w-0 whitespace-pre-wrap break-all px-2">
      {line.segments.map((seg: IntraLineSegment, i: number) =>
        seg.highlight ? (
          <span key={i} className={style}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

export default function DiffView({ edits }: DiffViewProps): React.JSX.Element {
  const sections = useMemo(() => {
    const allDiffLines = computeEditDiffLines(edits);
    return allDiffLines.map((lines) => collapseContext(lines));
  }, [edits]);

  return (
    <div className="overflow-hidden rounded border border-border/40 font-mono text-[13px] leading-5">
      {sections.map((section, sectionIdx) => (
        <div key={sectionIdx}>
          {sectionIdx > 0 && (
            <div className="border-t border-border/40 bg-muted/40 px-3 py-0.5 text-xs text-muted-foreground">
              edit [{sectionIdx}]
            </div>
          )}
          {section.map((item, lineIdx) => {
            if (item === 'separator') {
              return (
                <div
                  key={`sep-${lineIdx}`}
                  className="border-y border-border/30 bg-muted/30 px-3 py-0.5 text-xs text-muted-foreground"
                >
                  ⋯
                </div>
              );
            }
            const lineNum =
              item.type === 'remove' ? item.oldLineNumber : item.lineNumber;
            return (
              <div key={lineIdx} className={cn('flex', LINE_STYLES[item.type])}>
                <span className="w-4 shrink-0 select-none text-center opacity-50">
                  {PREFIX[item.type]}
                </span>
                <span className="w-8 shrink-0 select-none text-right opacity-50 tabular-nums">
                  {lineNum ?? ''}
                </span>
                {renderContent(item)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
