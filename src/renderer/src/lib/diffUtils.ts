import { diffLines, diffWords } from 'diff';

export interface EditEntry {
  oldText: string;
  newText: string;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber: number | null; // null for removed lines (they don't exist in new file)
  oldLineNumber: number | null; // null for added lines
  /** Word-level diff segments for intra-line highlighting */
  segments?: IntraLineSegment[];
}

export interface IntraLineSegment {
  text: string;
  highlight: boolean;
}

const CONTEXT_LINES = 3;

/**
 * Generate diff lines from an array of edits (oldText/newText pairs).
 * Since we don't have the full file, we diff each edit independently
 * and concatenate the results with separators.
 */
export function computeEditDiffLines(edits: EditEntry[]): DiffLine[][] {
  return edits.map((edit) => computeSingleDiffLines(edit.oldText, edit.newText));
}

function computeSingleDiffLines(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText);
  const result: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (let ci = 0; ci < changes.length; ci++) {
    const change = changes[ci];
    const lines = change.value.split('\n');
    // diffLines includes trailing newline in the value, remove empty last element
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (change.added) {
      for (const line of lines) {
        result.push({ type: 'add', content: line, lineNumber: newLineNum, oldLineNumber: null });
        newLineNum++;
      }
    } else if (change.removed) {
      for (const line of lines) {
        result.push({
          type: 'remove',
          content: line,
          lineNumber: null,
          oldLineNumber: oldLineNum,
        });
        oldLineNum++;
      }
    } else {
      for (const line of lines) {
        result.push({
          type: 'context',
          content: line,
          lineNumber: newLineNum,
          oldLineNumber: oldLineNum,
        });
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  // Post-process: add intra-line diff for 1:1 remove/add pairs
  addIntraLineDiffs(result);

  return result;
}

/**
 * For consecutive remove/add line pairs (1:1), compute word-level diff segments.
 */
function addIntraLineDiffs(lines: DiffLine[]): void {
  let i = 0;
  while (i < lines.length) {
    // Find consecutive removed lines
    const removeStart = i;
    while (i < lines.length && lines[i].type === 'remove') i++;
    const removeEnd = i;

    // Find consecutive added lines
    const addStart = i;
    while (i < lines.length && lines[i].type === 'add') i++;
    const addEnd = i;

    const removeCount = removeEnd - removeStart;
    const addCount = addEnd - addStart;

    // Only do intra-line for 1:1 pairs (like pi-mono)
    if (removeCount === 1 && addCount === 1) {
      const removedLine = lines[removeStart];
      const addedLine = lines[addStart];
      const { removedSegments, addedSegments } = computeIntraLineDiff(
        removedLine.content,
        addedLine.content,
      );
      removedLine.segments = removedSegments;
      addedLine.segments = addedSegments;
    }

    // Skip context lines
    if (i === removeStart) i++;
  }
}

/**
 * Compute word-level diff between two lines, returning segments with highlight flags.
 * Leading whitespace is never highlighted (matches pi-mono behavior).
 */
function computeIntraLineDiff(
  oldContent: string,
  newContent: string,
): { removedSegments: IntraLineSegment[]; addedSegments: IntraLineSegment[] } {
  const parts = diffWords(oldContent, newContent);
  const removedSegments: IntraLineSegment[] = [];
  const addedSegments: IntraLineSegment[] = [];
  let isFirstRemoved = true;
  let isFirstAdded = true;

  for (const part of parts) {
    if (part.removed) {
      let value = part.value;
      if (isFirstRemoved) {
        const leadingWs = value.match(/^(\s*)/)?.[1] ?? '';
        if (leadingWs) {
          removedSegments.push({ text: leadingWs, highlight: false });
          value = value.slice(leadingWs.length);
        }
        isFirstRemoved = false;
      }
      if (value) removedSegments.push({ text: value, highlight: true });
    } else if (part.added) {
      let value = part.value;
      if (isFirstAdded) {
        const leadingWs = value.match(/^(\s*)/)?.[1] ?? '';
        if (leadingWs) {
          addedSegments.push({ text: leadingWs, highlight: false });
          value = value.slice(leadingWs.length);
        }
        isFirstAdded = false;
      }
      if (value) addedSegments.push({ text: value, highlight: true });
    } else {
      removedSegments.push({ text: part.value, highlight: false });
      addedSegments.push({ text: part.value, highlight: false });
    }
  }

  return { removedSegments, addedSegments };
}

/**
 * Collapse context lines, showing only CONTEXT_LINES around changes.
 * Returns the lines with separators inserted where context is collapsed.
 */
export function collapseContext(lines: DiffLine[]): (DiffLine | 'separator')[] {
  if (lines.length === 0) return [];

  // Find which indices are "change" lines
  const changeIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'context') {
      changeIndices.add(i);
    }
  }

  // Mark context lines that are within CONTEXT_LINES of a change
  const visibleIndices = new Set<number>();
  for (const idx of changeIndices) {
    visibleIndices.add(idx);
    for (let offset = 1; offset <= CONTEXT_LINES; offset++) {
      if (idx - offset >= 0) visibleIndices.add(idx - offset);
      if (idx + offset < lines.length) visibleIndices.add(idx + offset);
    }
  }

  const result: (DiffLine | 'separator')[] = [];
  let lastVisibleIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (visibleIndices.has(i)) {
      if (lastVisibleIdx !== -1 && i - lastVisibleIdx > 1) {
        result.push('separator');
      }
      result.push(lines[i]);
      lastVisibleIdx = i;
    }
  }

  return result;
}
