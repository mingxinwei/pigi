import { diffLines } from 'diff'

export interface EditEntry {
  oldText: string
  newText: string
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  lineNumber: number | null // null for removed lines (they don't exist in new file)
  oldLineNumber: number | null // null for added lines
}

const CONTEXT_LINES = 3

/**
 * Generate diff lines from an array of edits (oldText/newText pairs).
 * Since we don't have the full file, we diff each edit independently
 * and concatenate the results with separators.
 */
export function computeEditDiffLines(edits: EditEntry[]): DiffLine[][] {
  return edits.map((edit) => computeSingleDiffLines(edit.oldText, edit.newText))
}

function computeSingleDiffLines(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText)
  const result: DiffLine[] = []
  let oldLineNum = 1
  let newLineNum = 1

  for (const change of changes) {
    const lines = change.value.split('\n')
    // diffLines includes trailing newline in the value, remove empty last element
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }

    if (change.added) {
      for (const line of lines) {
        result.push({ type: 'add', content: line, lineNumber: newLineNum, oldLineNumber: null })
        newLineNum++
      }
    } else if (change.removed) {
      for (const line of lines) {
        result.push({ type: 'remove', content: line, lineNumber: null, oldLineNumber: oldLineNum })
        oldLineNum++
      }
    } else {
      for (const line of lines) {
        result.push({ type: 'context', content: line, lineNumber: newLineNum, oldLineNumber: oldLineNum })
        oldLineNum++
        newLineNum++
      }
    }
  }

  return result
}

/**
 * Collapse context lines, showing only CONTEXT_LINES around changes.
 * Returns the lines with separators inserted where context is collapsed.
 */
export function collapseContext(lines: DiffLine[]): (DiffLine | 'separator')[] {
  if (lines.length === 0) return []

  // Find which indices are "change" lines
  const changeIndices = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'context') {
      changeIndices.add(i)
    }
  }

  // Mark context lines that are within CONTEXT_LINES of a change
  const visibleIndices = new Set<number>()
  for (const idx of changeIndices) {
    visibleIndices.add(idx)
    for (let offset = 1; offset <= CONTEXT_LINES; offset++) {
      if (idx - offset >= 0) visibleIndices.add(idx - offset)
      if (idx + offset < lines.length) visibleIndices.add(idx + offset)
    }
  }

  const result: (DiffLine | 'separator')[] = []
  let lastVisibleIdx = -1

  for (let i = 0; i < lines.length; i++) {
    if (visibleIndices.has(i)) {
      if (lastVisibleIdx !== -1 && i - lastVisibleIdx > 1) {
        result.push('separator')
      }
      result.push(lines[i])
      lastVisibleIdx = i
    }
  }

  return result
}
