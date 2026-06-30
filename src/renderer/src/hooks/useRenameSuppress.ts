import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/appStore';

/**
 * Suppresses the next typewriter animation when a manual rename is detected
 * for the given session path. Used by both SessionToolbar and SessionItem
 * to avoid animating title changes caused by explicit user renames.
 */
export function useRenameSuppress(sessionPath: string, skipNextAnimation: () => void): void {
  const isRenamed = useAppStore((state) => state.renamedSessionPaths.has(sessionPath));
  const prevIsRenamed = useRef(isRenamed);

  useEffect(() => {
    if (isRenamed && !prevIsRenamed.current) {
      skipNextAnimation();
      useAppStore.getState().clearSessionRenamed(sessionPath);
    }
    prevIsRenamed.current = isRenamed;
  }, [isRenamed, skipNextAnimation, sessionPath]);
}
