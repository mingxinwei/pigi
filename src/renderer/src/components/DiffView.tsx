import { useState, useEffect, useRef } from 'react';
import type { DiffLine, EditEntry } from '../lib/diffUtils';
import type { CollapsedSection } from '../workers/diffWorker';
import DiffWorker from '../workers/diffWorker?worker';

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

// =============================================================================
// Diff Worker (shared singleton)
// =============================================================================

let sharedWorker: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<number, (sections: CollapsedSection[]) => void>();

function getDiffWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new DiffWorker();
    sharedWorker.onmessage = (
      event: MessageEvent<{ id: number; sections: CollapsedSection[] }>,
    ) => {
      const { id, sections } = event.data;
      const resolve = pendingRequests.get(id);
      if (resolve) {
        pendingRequests.delete(id);
        resolve(sections);
      }
    };
  }
  return sharedWorker;
}

function computeDiffInWorker(edits: EditEntry[]): {
  id: number;
  promise: Promise<CollapsedSection[]>;
} {
  const id = nextRequestId++;
  const promise = new Promise<CollapsedSection[]>((resolve) => {
    pendingRequests.set(id, resolve);
    getDiffWorker().postMessage({ id, edits });
  });
  return { id, promise };
}

// =============================================================================
// Component
// =============================================================================

export default function DiffView({ edits }: DiffViewProps): React.JSX.Element {
  const [sections, setSections] = useState<CollapsedSection[] | null>(null);
  const requestIdRef = useRef<number>(-1);

  // Compute diff in worker
  useEffect(() => {
    const { id, promise } = computeDiffInWorker(edits);
    requestIdRef.current = id;

    promise.then((result) => {
      if (requestIdRef.current === id) {
        setSections(result);
      }
    });

    return () => {
      pendingRequests.delete(id);
    };
  }, [edits]);

  if (!sections) {
    return (
      <div className="overflow-hidden rounded border border-border/40 px-3 py-2 font-mono text-[13px] leading-5 text-muted-foreground">
        Computing diff…
      </div>
    );
  }

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
            return <DiffLineRow key={lineIdx} line={item} />;
          })}
        </div>
      ))}
    </div>
  );
}

/** Single diff line */
function DiffLineRow({ line }: { line: DiffLine }): React.JSX.Element {
  return (
    <div className={`flex ${LINE_STYLES[line.type]}`}>
      <span className="w-5 shrink-0 select-none text-right opacity-60">{PREFIX[line.type]}</span>
      <span className="min-w-0 whitespace-pre-wrap break-all px-2">{line.content}</span>
    </div>
  );
}
