/**
 * Web Worker for computing diffs off the main thread.
 * Prevents CSS animations from janking during large edit/write tool results.
 */
import {
  computeEditDiffLines,
  collapseContext,
  type EditEntry,
  type DiffLine,
} from '../lib/diffUtils';

export type CollapsedSection = (DiffLine | 'separator')[];

interface DiffRequest {
  id: number;
  edits: EditEntry[];
}

interface DiffResponse {
  id: number;
  sections: CollapsedSection[];
}

self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, edits } = event.data;
  const allDiffLines = computeEditDiffLines(edits);
  const sections = allDiffLines.map((lines) => collapseContext(lines));
  const response: DiffResponse = { id, sections };
  self.postMessage(response);
};
