/**
 * useTranscript - React hook that manages a TranscriptController for the active session.
 *
 * - Creates/resets controller on session switch
 * - Subscribes to push events and stream batches via MessagePort
 * - Hydrates transcript from getMessages on session_ready
 * - Exposes state + imperative ref for streaming DOM updates
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { TranscriptController, type TranscriptState } from '../state/transcriptController'
import { useAppStore } from '../state/appStore'
import { onPush, onStreamBatch, getMessages } from '../services/piAgentClient'
import type { PiPush, StreamBatch } from '../../../shared/ipcContract'

interface UseTranscriptResult {
  state: TranscriptState
  controller: React.RefObject<TranscriptController>
}

export function useTranscript(sessionId: string | null): UseTranscriptResult {
  const controllerRef = useRef<TranscriptController>(new TranscriptController())

  // Reset controller when session changes
  useEffect(() => {
    const controller = controllerRef.current
    controller.reset()
    if (!sessionId) {
      return
    }

    let cancelled = false
    getMessages(sessionId)
      .then((messages) => {
        if (!cancelled) {
          controller.hydrate(messages)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to hydrate messages:', err)
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Subscribe to push events
  useEffect(() => {
    if (!sessionId) return

    const controller = controllerRef.current

    const unsubPush = onPush(sessionId, (msg: PiPush) => {
      switch (msg.type) {
        case 'session_ready':
          // Update app store with metadata
          useAppStore.getState().updateSession(sessionId, {
            model: msg.model,
            thinkingLevel: msg.thinkingLevel,
            contextUsage: msg.contextUsage,
            autoCompactionEnabled: msg.autoCompactionEnabled,
            status: 'idle',
          })
          break

        case 'session_error':
          useAppStore.getState().updateSession(sessionId, { error: msg.error, status: 'error' })
          break

        case 'event':
          controller.processEvent(msg.event)
          break

        case 'error':
          console.error(`[session ${sessionId}] error:`, msg.error)
          break
      }
    })

    return unsubPush
  }, [sessionId])

  // Subscribe to stream batches
  useEffect(() => {
    if (!sessionId) return

    const controller = controllerRef.current

    const unsubStream = onStreamBatch(sessionId, (batch: StreamBatch) => {
      controller.applyStreamBatch(batch)
    })

    return unsubStream
  }, [sessionId])

  // Use useSyncExternalStore for React-compatible subscription
  const state = useSyncExternalStore(
    (onStoreChange) => controllerRef.current.subscribe(onStoreChange),
    () => controllerRef.current.state,
  )

  return { state, controller: controllerRef }
}
