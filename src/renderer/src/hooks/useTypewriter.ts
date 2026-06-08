import { useState, useEffect, useRef } from 'react';

/**
 * Typewriter effect: when `text` changes, animates deletion of old text
 * then types in the new text character by character.
 */
export function useTypewriter(text: string, speed = 30): string {
  const [displayed, setDisplayed] = useState(text);
  const prevTextRef = useRef(text);
  const animatingRef = useRef(false);

  useEffect(() => {
    const prevText = prevTextRef.current;
    if (prevText === text) return;
    prevTextRef.current = text;

    // Don't animate on initial mount or if already animating same transition
    if (!prevText) {
      setDisplayed(text);
      return;
    }

    animatingRef.current = true;
    let cancelled = false;

    async function animate(): Promise<void> {
      // Phase 1: delete old text character by character
      for (let i = prevText.length; i >= 0; i--) {
        if (cancelled) return;
        setDisplayed(prevText.slice(0, i));
        await new Promise((r) => setTimeout(r, speed / 2));
      }

      // Phase 2: type new text character by character
      for (let i = 0; i <= text.length; i++) {
        if (cancelled) return;
        setDisplayed(text.slice(0, i));
        await new Promise((r) => setTimeout(r, speed));
      }

      animatingRef.current = false;
    }

    void animate();

    return () => {
      cancelled = true;
      animatingRef.current = false;
      setDisplayed(text);
    };
  }, [text, speed]);

  return displayed;
}
