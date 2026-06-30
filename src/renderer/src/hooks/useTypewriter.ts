import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Typewriter effect: when `text` changes, animates deletion of old text
 * then types in the new text character by character.
 *
 * Returns [displayedText, skipNext] where skipNext() suppresses the
 * animation for the next text change (e.g. after a manual rename).
 */
export function useTypewriter(text: string, speed = 30): [string, () => void] {
  const [displayed, setDisplayed] = useState(text);
  const prevTextRef = useRef(text);
  const skipNextRef = useRef(false);

  useEffect(() => {
    const prevText = prevTextRef.current;
    if (prevText === text) return;
    prevTextRef.current = text;

    // Skip animation if flagged (manual rename) or no previous text
    if (skipNextRef.current || !prevText) {
      skipNextRef.current = false;
      setDisplayed(text);
      return;
    }

    let cancelled = false;

    async function animate(): Promise<void> {
      // Phase 1: delete in chunks to keep total deletion under ~300ms
      const deleteStep = Math.max(1, Math.ceil(prevText.length / 10));
      for (let i = prevText.length; i >= 0; i -= deleteStep) {
        if (cancelled) return;
        setDisplayed(prevText.slice(0, i));
        await new Promise((r) => setTimeout(r, speed));
      }
      if (!cancelled) setDisplayed('');

      // Phase 2: type new text character by character
      for (let i = 0; i <= text.length; i++) {
        if (cancelled) return;
        setDisplayed(text.slice(0, i));
        await new Promise((r) => setTimeout(r, speed));
      }
    }

    void animate();

    return () => {
      cancelled = true;
      setDisplayed(text);
    };
  }, [text, speed]);

  const skipNext = useCallback((): void => {
    skipNextRef.current = true;
  }, []);

  return [displayed, skipNext];
}
