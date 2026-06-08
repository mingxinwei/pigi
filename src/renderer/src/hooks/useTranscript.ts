/**
 * useTranscript - React hook that manages a TranscriptController for the active session.
 *
 * - Keeps one controller per session (keyed by sessionPath)
 * - Subscribes to push events and stream batches via MessagePort
 * - Hydrates transcript from getMessages on session_ready
 * - Exposes state plus the controller for optimistic user messages
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore, type RefObject } from 'react';
import { TranscriptController, type TranscriptState } from '../state/transcriptController';
import { useAppStore } from '../state/appStore';
import {
  onPush,
  onStreamBatch,
  getMessages,
  getState,
  listProjectSessions,
} from '../services/piAgentClient';
import type { PiPush, StreamBatch } from '../../../shared/ipcContract';

interface UseTranscriptResult {
  state: TranscriptState;
  controller: RefObject<TranscriptController>;
}

const emptyController = new TranscriptController();
const controllersBySession = new Map<string, TranscriptController>();
const subscriptionsBySession = new Map<string, () => void>();
const hydrationStartedSessions = new Set<string>();

export function getTranscriptController(sessionPath: string): TranscriptController {
  const existing = controllersBySession.get(sessionPath);
  if (existing) {
    return existing;
  }

  const controller = new TranscriptController();
  controllersBySession.set(sessionPath, controller);
  return controller;
}

export function ensureTranscriptSession(sessionPath: string): TranscriptController {
  const controller = getTranscriptController(sessionPath);
  ensureSessionSubscription(sessionPath, controller);
  ensureSessionHydration(sessionPath, controller);
  return controller;
}

export function disposeTranscriptSession(sessionPath: string): void {
  subscriptionsBySession.get(sessionPath)?.();
  controllersBySession.delete(sessionPath);
  hydrationStartedSessions.delete(sessionPath);
}

/**
 * Mark a session as already hydrated so ensureSessionHydration skips the getMessages call.
 * Used for sessions hydrated from file before the utility process is ready.
 */
export function markSessionHydrated(sessionPath: string): void {
  hydrationStartedSessions.add(sessionPath);
}

function ensureSessionHydration(sessionPath: string, controller: TranscriptController): void {
  if (hydrationStartedSessions.has(sessionPath)) {
    return;
  }

  hydrationStartedSessions.add(sessionPath);
  void getMessages(sessionPath)
    .then(({ messages, compactionCount }) => {
      if (controller.state.nodes.length === 0) {
        controller.hydrate(messages, compactionCount);
      } else {
        controller.mergeHydratedMessages(messages);
      }
    })
    .catch((err) => {
      console.error('Failed to hydrate messages:', err);
      hydrationStartedSessions.delete(sessionPath);
    });
}

function syncSessionState(sessionPath: string, controller: TranscriptController): void {
  void getState(sessionPath)
    .then((sessionState) => {
      controller.setStatus(sessionState.isStreaming ? 'streaming' : 'idle');
      useAppStore.getState().updateSession(sessionPath, {
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

function ensureSessionSubscription(sessionPath: string, controller: TranscriptController): void {
  if (subscriptionsBySession.has(sessionPath)) {
    return;
  }

  const unsubPush = onPush(sessionPath, (pushMessage: PiPush) => {
    switch (pushMessage.type) {
      case 'session_ready':
        useAppStore.getState().updateSession(sessionPath, {
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
          .updateSession(sessionPath, { error: pushMessage.error, status: 'error' });
        break;

      case 'status_sync':
        controller.setStatus(pushMessage.isStreaming ? 'streaming' : 'idle');
        useAppStore.getState().updateSession(sessionPath, { status: controller.state.status });
        break;

      case 'event':
        controller.processEvent(pushMessage.event);
        useAppStore.getState().updateSession(sessionPath, { status: controller.state.status });
        break;

      case 'error':
        console.error(`[session ${sessionPath}] error:`, pushMessage.error);
        break;

      case 'login_open_url':
        window.piApi.openExternal(pushMessage.url);
        break;

      case 'login_complete':
        break;

      case 'login_progress':
      case 'login_error':
        break;

      case 'auto_title':
        void listProjectSessions([pushMessage.cwd]);
        break;
    }
  });

  const unsubStream = onStreamBatch(sessionPath, (batch: StreamBatch) => {
    controller.applyStreamBatch(batch);
  });

  subscriptionsBySession.set(sessionPath, () => {
    unsubPush();
    unsubStream();
    subscriptionsBySession.delete(sessionPath);
  });
}

export function useTranscript(sessionPath: string | null): UseTranscriptResult {
  const controller = useMemo(
    () => (sessionPath ? getTranscriptController(sessionPath) : emptyController),
    [sessionPath],
  );
  const controllerRef = useMemo<RefObject<TranscriptController>>(
    () => ({ current: controller }),
    [controller],
  );

  useEffect(() => {
    if (!sessionPath) {
      return;
    }

    ensureTranscriptSession(sessionPath);
    syncSessionState(sessionPath, controller);
  }, [controller, sessionPath]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.subscribe(onStoreChange),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.state, [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return { state, controller: controllerRef };
}
