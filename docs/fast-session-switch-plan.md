# Fast Session Switch

## Problem

When switching to a session whose utility process has been pruned, the user waits 1-3 seconds (spawn process + create services + load session + bind extensions) before seeing anything. This feels inconsistent compared to sessions that still have a live process (instant switch).

## Solution

Decouple message display from process readiness. When switching to a session without a live process:

1. **Immediately** read messages from the session JSONL file (via sessionWorker, ~50-200ms)
2. **In background** spawn utility process as before
3. If user sends a prompt before process is ready, buffer it and send once ready

From the user's perspective, every session switch is instant. The only difference is a slightly longer wait for the first LLM response if the process wasn't already alive.

## Key Design Decisions

1. **No re-hydration after process ready**: The file read via sessionWorker is the authoritative source for historical messages. Once the utility process is ready, we do NOT call `get_messages` again. Reason: session files are append-only JSONL, and the old process was already killed before resume, so file content and runtime state are guaranteed identical.

2. **Buffer in renderer, not preload/main**: Pending prompts are held in App.tsx. The preload `send()` API continues to reject if no port exists — the renderer is responsible for holding messages until the port is available.

3. **Seamless UX**: No "reconnecting" state, no disabled input. User sees instant session switch, can type and send immediately. If the process isn't ready yet, we show optimistic user message + streaming status, then flush the buffered prompt once ready.

4. **Skip `ensureSessionHydration` for file-hydrated sessions**: The existing `useTranscript.ts` calls `getMessages` on the utility process when a session becomes active. For sessions that were already hydrated from file, this must be skipped to avoid redundant fetching and potential flicker.

## Implementation Plan

### 1. Add `ReadSessionMessages` IPC

**`src/shared/ipcContract.ts`**

- Add `PiChannel.ReadSessionMessages = 'pi:read_session_messages'`
- Add `ReadSessionMessagesCommand` to `SessionWorkerCommand`:
  ```ts
  {
    type: 'read_session_messages';
    requestId: string;
    sessionPath: string;
  }
  ```
- Add response type to `SessionWorkerResponse`:
  ```ts
  { type: 'session_messages_result'; requestId: string; success: boolean; messages?: unknown[]; compactionCount?: number; error?: string }
  ```

### 2. Implement in sessionWorker

**`src/processes/utility/sessionWorker.ts`**

- Handle `read_session_messages` command:
  ```ts
  const sessionManager = SessionManager.open(command.sessionPath);
  const { messages } = sessionManager.buildSessionContext();
  const branch = sessionManager.getBranch();
  const compactionCount = branch.filter((e) => e.type === 'compaction').length;
  sendToMain({
    type: 'session_messages_result',
    requestId,
    success: true,
    messages,
    compactionCount,
  });
  ```

### 3. Expose via main process bridge

**`src/main/ipc/piAgentBridge.ts`**

- Add `ipcMain.handle(PiChannel.ReadSessionMessages, ...)` that:
  - Sends command to sessionWorker
  - Returns a promise resolved when sessionWorker responds (same pattern as `RenamePersistedSession`)

### 4. Expose via preload

**`src/preload/index.ts`**

- Add `readSessionMessages(sessionPath: string): Promise<{ messages: unknown[]; compactionCount: number }>` to `piApi`

### 5. Expose via renderer client

**`src/renderer/src/services/piAgentClient.ts`**

- Add `readSessionMessages(sessionPath: string)` function

### 6. Change session switch flow in App.tsx

**`src/renderer/src/App.tsx` — `handleResumeSession`**

Before (blocking):

```ts
const sessionId = await resumeSession(session.path);
addSessionEntry(...);
setActiveSession(sessionId);
```

After (non-blocking):

```ts
// 1. Create a temporary session entry immediately
const tempSessionId = `pending-${session.id}`;
addSessionEntry({ sessionId: tempSessionId, ..., status: 'idle' });
setActiveSession(tempSessionId);

// 2. Hydrate from file (fast)
const { messages, compactionCount } = await readSessionMessages(session.path);
ensureTranscriptSession(tempSessionId).hydrate(messages, compactionCount);

// 3. Spawn utility process in background
resumeSession(session.path).then(realSessionId => {
  // Migrate: replace temp entry with real entry, transfer transcript
  migrateSession(tempSessionId, realSessionId);
  // Flush any pending prompt
  flushPendingPrompt(realSessionId);
});
```

### 7. Pending prompt buffer

**`src/renderer/src/App.tsx`**

- Add `pendingPromptBySession: Map<string, string>` ref
- In `handleSend`: if session has no live port yet, store message in buffer, show optimistic user message + streaming status
- On session migration (process ready): check buffer, send prompt if present
- On abort: clear buffer, remove optimistic message, reset status

### 8. Session migration helper

When the real sessionId arrives (utility process ready):

- Replace temp session entry in store with real one (same UI state, new sessionId)
- Transfer transcript controller from temp to real sessionId
- Update `activeSessionId` if it was pointing to temp
- Subscribe to live push/stream events

## Edge Cases

- **User sends multiple messages before ready**: Buffer only the first as `prompt`, subsequent as `followUp` or `steer` (same as current queuing logic)
- **User aborts before ready**: Clear buffer, remove optimistic message, reset status
- **Process fails to start**: Show error toast, remove streaming status, session remains viewable (history still shown)
- **User switches away before process ready**: Let process finish in background as normal (existing behavior)
- **Session file missing or corrupt**: `buildSessionContext` throws → show error, fall back to current behavior (wait for process)

## Files Changed

1. `src/shared/ipcContract.ts` — new channel + command/response types
2. `src/processes/utility/sessionWorker.ts` — read_session_messages handler
3. `src/main/ipc/piAgentBridge.ts` — IPC handler + sessionWorker dispatch
4. `src/preload/index.ts` — expose readSessionMessages
5. `src/renderer/src/services/piAgentClient.ts` — typed wrapper
6. `src/renderer/src/App.tsx` — new handleResumeSession flow + pending prompt buffer
7. `src/renderer/src/hooks/useTranscript.ts` — session migration helper

## Out of Scope

- Changing eviction strategy (MAX_IDLE stays at 6)
- Cleaning up unused servicesByCwd in claimed processes
- Time-based idle eviction
