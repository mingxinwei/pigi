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

function ensureSessionHydration(sessionId: string, controller: TranscriptController): void {
  if (hydrationStartedSessions.has(sessionId)) {
    return;
  }

  hydrationStartedSessions.add(sessionId);
  void getMessages(sessionId)
    .then((messages) => {
      // Do not overwrite live or optimistic content that may have arrived before hydration returns.
      if (controller.state.nodes.length === 0) {
        controller.hydrate(messages);
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

  const unsubPush = onPush(sessionId, (msg: PiPush) => {
    switch (msg.type) {
      case 'session_ready':
        // Update app store with metadata
        useAppStore.getState().updateSession(sessionId, {
          model: msg.model,
          thinkingLevel: msg.thinkingLevel,
          contextUsage: msg.contextUsage,
          autoCompactionEnabled: msg.autoCompactionEnabled,
          status: controller.state.status,
        });
        break;

      case 'session_error':
        useAppStore.getState().updateSession(sessionId, { error: msg.error, status: 'error' });
        break;

      case 'event':
        controller.processEvent(msg.event);
        useAppStore.getState().updateSession(sessionId, { status: controller.state.status });
        break;

      case 'error':
        console.error(`[session ${sessionId}] error:`, msg.error);
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
