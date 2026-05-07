import { useMemo } from 'react';
import { computeEditDiffLines, collapseContext, type EditEntry } from '../lib/diffUtils';

interface DiffViewProps {
  edits: EditEntry[];
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

export default function DiffView({ edits }: DiffViewProps): React.JSX.Element {
  const sections = useMemo(() => {
    const allDiffLines = computeEditDiffLines(edits);
    return allDiffLines.map((lines) => collapseContext(lines));
  }, [edits]);

  return (
    <div className="mt-2 overflow-hidden rounded border border-border/40 font-mono text-[13px] leading-5">
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
      ))}
    </div>
  );
}
