import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_COPIED_FEEDBACK_MS = 500;

/**
 * Clipboard copy with transient "copied" feedback. The reset timer is cleared
 * on unmount so a pending reset can never fire after the button is gone.
 */
export function useCopyFeedback(
  text: string,
  resetMs: number = DEFAULT_COPIED_FEEDBACK_MS,
): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), resetMs);
  }, [text, resetMs]);

  return { copied, copy };
}
