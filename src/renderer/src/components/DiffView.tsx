import { useMemo, useState } from 'react';
import { computeEditDiffLines, collapseContext, type EditEntry } from '../lib/diffUtils';

/** Maximum number of visible diff lines before truncation */
const DEFAULT_MAX_LINES = 20;

interface DiffViewProps {
  edits: EditEntry[];
  maxLines?: number;
}

const LINE_STYLES = {
  add: 'bg-green-500/15 text-green-700 dark:text-green-400',
  remove: 'bg-red-500/15 text-red-700 dark:text-red-400',
  context: 'text-muted-foreground',
} as const;

const PREFIX = {
  add: '+',
  remove: '-',
  context: ' ',
} as const;

export default function DiffView({
  edits,
  maxLines = DEFAULT_MAX_LINES,
}: DiffViewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const sections = useMemo(() => {
    const allDiffLines = computeEditDiffLines(edits);
    return allDiffLines.map((lines) => collapseContext(lines));
  }, [edits]);

  const totalLines = useMemo(
    () => sections.reduce((sum, s) => sum + s.filter((item) => item !== 'separator').length, 0),
    [sections],
  );
  const isTruncated = !expanded && totalLines > maxLines;
  let linesRendered = 0;

  return (
    <div className="my-4 overflow-hidden rounded border border-border/40 font-mono text-[13px] leading-5">
      {sections.map((section, sectionIdx) => {
        if (isTruncated && linesRendered >= maxLines) return null;
        return (
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
              if (isTruncated && linesRendered >= maxLines) return null;
              linesRendered++;
              return (
                <div key={lineIdx} className={`flex ${LINE_STYLES[item.type]}`}>
                  <span className="w-5 shrink-0 select-none text-right opacity-60">
                    {PREFIX[item.type]}
                  </span>
                  <span className="min-w-0 whitespace-pre-wrap break-all px-2">{item.content}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-border/40 bg-muted/30 px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50"
        >
          {totalLines - maxLines} more lines…
        </button>
      )}
      {expanded && totalLines > maxLines && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="w-full border-t border-border/40 bg-muted/30 px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50"
        >
          collapse
        </button>
      )}
    </div>
  );
}
