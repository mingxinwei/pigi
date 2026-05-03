/**
 * Pi agent client - renderer-side wrapper for communication with pi-agent.
 *
 * Provides a unified interface over two channels:
 * - Low-frequency commands/events via window.piApi (normal IPC)
 * - High-frequency streaming via MessagePort (direct, bypasses main)
 */
import type { StreamBatch } from '../../../shared/protocol'

export type StreamBatchHandler = (batch: StreamBatch) => void

let unsubscribeStream: (() => void) | null = null

/** Subscribe to high-frequency stream batches from pi-agent */
export function subscribeToStream(handler: StreamBatchHandler): () => void {
  unsubscribeStream?.()
  unsubscribeStream = window.piApi.onStreamBatch(handler)
  return () => {
    unsubscribeStream?.()
    unsubscribeStream = null
  }
}

/** Re-export piApi methods for convenience */
export const piAgent = {
  prompt: (message: string) => window.piApi.prompt(message),
  abort: () => window.piApi.abort(),
  getState: () => window.piApi.getState(),
  getMessages: () => window.piApi.getMessages(),
  newSession: () => window.piApi.newSession(),
  switchSession: (path: string) => window.piApi.switchSession(path),
  listSessions: (cwd?: string) => window.piApi.listSessions(cwd),
  cycleModel: () => window.piApi.cycleModel(),
  cycleThinkingLevel: () => window.piApi.cycleThinkingLevel(),
}
