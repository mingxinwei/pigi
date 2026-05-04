# Architecture

## Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                        Main Process                          │
│  - Window management                                        │
│  - Session process lifecycle (spawn/kill)                    │
│  - MessagePort handshake (one-time per session)             │
│  - NOT in the data path after handshake                     │
└────────────┬──────────────────────────────────┬─────────────┘
             │ IPC (lifecycle only)             │ parentPort (lifecycle only)
             │                                  │
┌────────────▼────────────────┐   ┌─────────────▼──────────────┐
│       Renderer Process      │   │   Utility Process (N=1/session) │
│  - React UI                 │   │   - Pi SDK (one session)         │
│  - Zustand store            │   │   - StreamBatcher (16ms flush)   │
│  - Per-session port mgmt    │   │   - Command handler              │
└────────────┬────────────────┘   └─────────────▲──────────────┘
             │                                  │
             └──────── MessagePort (direct) ────┘
                    (commands, responses,
                     push events, stream batches)
```

Each session gets its own utility process. Process lifecycle = session lifecycle.

## Session Creation Flow

```
Renderer                    Main                        Utility Process
   │                         │                              │
   │ invoke(create_session)  │                              │
   │────────────────────────>│                              │
   │                         │  spawn new process           │
   │                         │─────────────────────────────>│
   │                         │  postMessage({create_session, cwd})
   │                         │─────────────────────────────>│
   │                         │                              │
   │                         │                    SDK creates session
   │                         │                    gets real sessionId
   │                         │                              │
   │                         │  postMessage({session_created, sessionId})
   │                         │<─────────────────────────────│
   │                         │                              │
   │                         │  create MessageChannel       │
   │                         │  postMessage(attach_port, [port1])
   │                         │─────────────────────────────>│
   │                         │                              │
   │  postMessage(session_port, {sessionId}, [port2])       │
   │<────────────────────────│                              │
   │                         │                              │
   │ resolve({success, sessionId})                          │
   │<────────────────────────│                              │
   │                         │                              │
   │        ═══════ MessagePort established ═══════         │
   │                         │                              │
   │  port.postMessage({id, cmd: {type:'prompt', ...}})     │
   │───────────────────────────────────────────────────────>│
   │                                                        │
   │  port.postMessage({id, result: {success: true}})       │
   │<───────────────────────────────────────────────────────│
   │                                                        │
   │  port.postMessage({type:'stream_batch', text:{...}})   │
   │<───────────────────────────────────────────────────────│
   │                                                        │
   │  port.postMessage({type:'event', event:{...}})         │
   │<───────────────────────────────────────────────────────│
```

## Communication Channels

### Main ↔ Renderer (IPC, lifecycle only)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `pi:create_session` | renderer → main | Spawn process, create session |
| `pi:resume_session` | renderer → main | Spawn process, resume session |
| `pi:destroy_session` | renderer → main | Kill session process |
| `pi:session_port` | main → renderer | Deliver MessagePort |
| `pi:process_exit` | main → renderer | Notify unexpected crash |

These are the **only** IPC calls. After session creation, main is idle.

### Main → Utility (parentPort, lifecycle only)

| Message | Purpose |
|---------|---------|
| `{ type: 'create_session', cwd }` | Initialize new session |
| `{ type: 'resume_session', sessionPath }` | Resume existing session |
| `{ type: 'attach_port' }` + `[port]` | Deliver MessagePort to utility |

### Utility → Main (parentPort, lifecycle only)

| Message | Purpose |
|---------|---------|
| `{ type: 'session_created', sessionId }` | Report real session ID |
| `{ type: 'session_error', error }` | Report creation failure |

### Renderer ↔ Utility (MessagePort, all runtime data)

Everything after handshake flows over a single MessagePort per session:

**Renderer → Utility (commands):**
```ts
{ id: string, cmd: PiCommand }
// PiCommand = prompt | abort | get_state | get_messages | list_sessions | cycle_model | cycle_thinking_level
```

**Utility → Renderer (responses):**
```ts
{ id: string, result: unknown }
```

**Utility → Renderer (push events, no id):**
```ts
{ type: 'session_ready', model, thinkingLevel }
{ type: 'event', event }       // agent lifecycle events
{ type: 'error', error }       // runtime errors
```

**Utility → Renderer (stream batches, high-frequency):**
```ts
{ type: 'stream_batch', text?, thinking?, toolOutput? }
// Flushed every 16ms by StreamBatcher
```

## Why This Design

| Decision | Rationale |
|----------|-----------|
| One process per session | Crash isolation, no shared event loop blocking |
| MessagePort for all data | Main not in hot path, lowest latency |
| Single port per session | 16ms batched stream won't block commands (< 1ms processing per batch) |
| Two-step handshake | Real sessionId from SDK, no temporary/generated IDs |
| Main only does lifecycle | Minimal surface, easy to reason about |

## File Map

```
src/
├── shared/
│   └── ipcContract.ts          # All types + channel enum (single source of truth)
├── main/
│   ├── index.ts                # App lifecycle, window creation
│   ├── ipc/
│   │   └── piAgentBridge.ts    # Lifecycle handlers (~120 lines)
│   ├── processes/
│   │   └── createPiAgentProcess.ts  # Utility process spawner
│   └── windows/
│       └── createMainWindow.ts
├── preload/
│   ├── index.ts                # Port management + piApi exposure
│   └── index.d.ts              # Type declarations for window.piApi
├── processes/
│   └── utility/
│       └── piAgent.ts          # Pi SDK session + port communication
└── renderer/
    └── src/
        ├── services/
        │   └── piAgentClient.ts  # Typed wrappers over piApi
        ├── state/
        │   └── appStore.ts       # Zustand store
        └── ...
```
