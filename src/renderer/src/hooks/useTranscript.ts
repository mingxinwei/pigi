/**
 * useTranscript - React hook that manages a TranscriptController for the active session.
 *
 * - Keeps one controller per live session so inactive running sessions still collect stream output
 * - Subscribes to push events and stream batches via MessagePort
 * - Hydrates transcript from getMessages on session_ready
 * - Exposes state plus the controller for optimistic user messages
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore, type RefObject } from 'react';
import { TranscriptController, type TranscriptState } from '../state/transcriptController';
import { useAppStore } from '../state/appStore';
import { onPush, onStreamBatch, getMessages, getState } from '../services/piAgentClient';
import type { PiPush, StreamBatch } from '../../../shared/ipcContract';

function hasSessionAlias(sessionId: string): boolean {
  return window.piApi.hasSessionAlias(sessionId);
}

interface UseTranscriptResult {
  state: TranscriptState;
  controller: RefObject<TranscriptController>;
}

const emptyController = new TranscriptController();
const controllersBySession = new Map<string, TranscriptController>();
const subscriptionsBySession = new Map<string, () => void>();
const hydrationStartedSessions = new Set<string>();

export function getTranscriptController(sessionId: string): TranscriptController {
  const existing = controllersBySession.get(sessionId);
  if (existing) {
    return existing;
  }

  const controller = new TranscriptController();
  controllersBySession.set(sessionId, controller);
  return controller;
}

export function ensureTranscriptSession(sessionId: string): TranscriptController {
  const controller = getTranscriptController(sessionId);
  ensureSessionSubscription(sessionId, controller);
  ensureSessionHydration(sessionId, controller);
  return controller;
}

export function disposeTranscriptSession(sessionId: string): void {
  subscriptionsBySession.get(sessionId)?.();
  controllersBySession.delete(sessionId);
  hydrationStartedSessions.delete(sessionId);
}

/**
 * Mark a session as already hydrated so ensureSessionHydration skips the getMessages call.
 * Used for sessions hydrated from file before the utility process is ready.
 */
export function markSessionHydrated(sessionId: string): void {
  hydrationStartedSessions.add(sessionId);
}

function ensureSessionHydration(sessionId: string, controller: TranscriptController): void {
  if (hydrationStartedSessions.has(sessionId)) {
    return;
  }

  hydrationStartedSessions.add(sessionId);
  void getMessages(sessionId)
    .then(({ messages, compactionCount }) => {
      // Do not overwrite live or optimistic content that may have arrived before hydration returns.
      if (controller.state.nodes.length === 0) {
        controller.hydrate(messages, compactionCount);
      } else {
        controller.mergeHydratedMessages(messages);
      }
    })
    .catch((err) => {
      console.error('Failed to hydrate messages:', err);
      hydrationStartedSessions.delete(sessionId);
    });
}

function syncSessionState(sessionId: string, controller: TranscriptController): void {
  // Skip for placeholder sessions without an alias (process not ready yet)
  if (sessionId.startsWith('pending:') && !hasSessionAlias(sessionId)) return;
  void getState(sessionId)
    .then((sessionState) => {
      controller.setStatus(sessionState.isStreaming ? 'streaming' : 'idle');
      useAppStore.getState().updateSession(sessionId, {
        model: sessionState.model,
        thinkingLevel: sessionState.thinkingLevel,
        contextUsage: sessionState.contextUsage,
        autoCompactionEnabled: sessionState.autoCompactionEnabled,
        status: controller.state.status,
      });
    })
    .catch((err) => {
      console.error('Failed to sync session state:', err);
    });
}

function ensureSessionSubscription(sessionId: string, controller: TranscriptController): void {
  if (subscriptionsBySession.has(sessionId)) {
    return;
  }
  // Skip if this is a placeholder session without an alias (process not ready yet).
  // Once the alias is registered (process ready), this will be called again.
  if (sessionId.startsWith('pending:') && !hasSessionAlias(sessionId)) {
    return;
  }

  const unsubPush = onPush(sessionId, (pushMessage: PiPush) => {
    switch (pushMessage.type) {
      case 'session_ready':
        // Update app store with metadata
        useAppStore.getState().updateSession(sessionId, {
          model: pushMessage.model,
          thinkingLevel: pushMessage.thinkingLevel,
          contextUsage: pushMessage.contextUsage,
          autoCompactionEnabled: pushMessage.autoCompactionEnabled,
          status: controller.state.status,
        });
        break;

      case 'session_error':
        useAppStore
          .getState()
          .updateSession(sessionId, { error: pushMessage.error, status: 'error' });
        break;

      case 'status_sync':
        controller.setStatus(pushMessage.isStreaming ? 'streaming' : 'idle');
        useAppStore.getState().updateSession(sessionId, { status: controller.state.status });
        break;

      case 'event':
        controller.processEvent(pushMessage.event);
        useAppStore.getState().updateSession(sessionId, { status: controller.state.status });
        break;

      case 'error':
        console.error(`[session ${sessionId}] error:`, pushMessage.error);
        break;

      case 'login_open_url':
        window.piApi.openExternal(pushMessage.url);
        break;

      case 'login_complete':
        // Model list may have changed after login
        break;

      case 'login_progress':
      case 'login_error':
        // TODO: surface these to the user if needed (currently handled via RPC response)
        break;
    }
  });

  const unsubStream = onStreamBatch(sessionId, (batch: StreamBatch) => {
    controller.applyStreamBatch(batch);
  });

  subscriptionsBySession.set(sessionId, () => {
    unsubPush();
    unsubStream();
    subscriptionsBySession.delete(sessionId);
  });
}

export function useTranscript(sessionId: string | null): UseTranscriptResult {
  const controller = useMemo(
    () => (sessionId ? getTranscriptController(sessionId) : emptyController),
    [sessionId],
  );
  const controllerRef = useMemo<RefObject<TranscriptController>>(
    () => ({ current: controller }),
    [controller],
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    ensureTranscriptSession(sessionId);
    syncSessionState(sessionId, controller);
  }, [controller, sessionId]);

  // Use useSyncExternalStore for React-compatible subscription
  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.subscribe(onStoreChange),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.state, [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return { state, controller: controllerRef };
}
