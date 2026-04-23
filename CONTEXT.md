# pigi — Context for New Agent Session

> **Start working in**: `/Users/mwei2/PersonalCode/pigi/`
> **Use `pnpm`** (not npm) for all package operations.

---

## What Is This Project

A macOS Electron desktop GUI for the **pi coding agent**. Inspired by OpenAI Codex's interface:

- Left sidebar: projects (grouped) → sessions list per project
- Main area: conversation view with streaming chat
- Integration via **pi SDK** (`@mariozechner/pi-coding-agent`), imported directly into Electron main process

Reference screenshot: `/Users/mwei2/Pictures/screenshot/SCR-20260422-pbtw.png`

---

## Why SDK over RPC

Pi's own docs recommend SDK for Node.js apps:

> _"If you're building a Node.js application, consider using AgentSession directly
> from @mariozechner/pi-coding-agent instead of spawning a subprocess."_

|            | RPC (subprocess)           | SDK (in-process)                         |
| ---------- | -------------------------- | ---------------------------------------- |
| 版本控制   | ❌ 绑用户的 pi CLI 版本    | ✅ package.json 锁版本，我们决定何时升级 |
| 类型安全   | ❌ JSONL 需手动 parse/type | ✅ TypeScript 类型直接用                 |
| 子进程管理 | ❌ spawn 坑多（已验证）    | ✅ 不需要                                |
| 功能丰富度 | 受限于协议                 | ✅ 完整访问 session/agent state          |
| 兼容性风险 | 协议变 → 被动 break        | API 变 → 主动选择何时升级                |

**Phase 0 已验证 RPC 可行**，现在切换到 SDK 方案。RPC 代码保留在 git history 作为 fallback 参考。

---

## Current State

**Scaffold + Tailwind CSS v4 已配置。Phase 0 (RPC) 已验证但将被 SDK 替换。**

```
/Users/mwei2/PersonalCode/pigi/
├── src/
│   ├── main/
│   │   ├── index.ts           # Electron main process
│   │   └── pi-rpc.ts          # RPC subprocess (to be replaced by pi-sdk.ts)
│   ├── preload/
│   │   ├── index.ts           # contextBridge (to be updated for SDK)
│   │   └── index.d.ts         # Type declarations
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx        # React entry
│           ├── App.tsx         # Chat UI (Phase 1 WIP)
│           ├── assets/main.css # Tailwind CSS
│           └── components/
│               ├── Sidebar.tsx    # Sidebar placeholder
│               ├── StatusBar.tsx  # Status indicator
│               ├── MessageList.tsx # Message display
│               └── ChatInput.tsx  # Input box
├── electron.vite.config.ts    # Vite + Tailwind configured
├── package.json
└── tsconfig*.json
```

- `pnpm run dev` → Electron + Vite HMR ✅
- React 19 + TypeScript + electron-vite + Tailwind CSS v4 ✅

---

## Tech Stack

| Layer          | Tech                                                  |
| -------------- | ----------------------------------------------------- |
| Shell          | Electron (latest v39)                                 |
| Bundler        | electron-vite (Vite-based)                            |
| Frontend       | React 19 + TypeScript                                 |
| Styling        | Tailwind CSS v4 ✅                                    |
| Virtual scroll | @tanstack/react-virtual (to install)                  |
| Markdown       | react-markdown + remark-gfm (to install)              |
| Code highlight | shiki (to install)                                    |
| Pi integration | **SDK**: `@mariozechner/pi-coding-agent` (to install) |

---

## Pi SDK Integration (Critical Reference)

SDK docs: `~/.n/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`
Session format: `~/.n/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
RPC docs (backup reference): `~/.n/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`

### Core API

```typescript
import {
  createAgentSession,
  createAgentSessionRuntime,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  type AgentSession,
  type AgentSessionEvent,
} from '@mariozechner/pi-coding-agent'

// Create session
const { session } = await createAgentSession({
  sessionManager: SessionManager.create(cwd),
  authStorage: AuthStorage.create(),
  modelRegistry: ModelRegistry.create(authStorage),
})

// Subscribe to events (same events as RPC, but typed)
session.subscribe((event: AgentSessionEvent) => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    // streaming text
  }
})

// Send prompt
await session.prompt('Hello')

// Abort
await session.abort()

// Direct state access
session.messages // AgentMessage[]
session.isStreaming // boolean
session.model // Model | undefined
```

### Session Management (Runtime API)

```typescript
const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager })
runtime.session // current AgentSession
await runtime.newSession() // replace with new
await runtime.switchSession(path) // switch to saved
await runtime.fork(entryId) // fork from entry

// List sessions
const sessions = await SessionManager.list(cwd)
const allSessions = await SessionManager.listAll(cwd)
```

### Key Events (same as RPC, but TypeScript typed)

```
agent_start / agent_end
message_start / message_update / message_end
  message_update.assistantMessageEvent.type: text_delta | thinking_delta | toolcall_delta | ...
tool_execution_start / tool_execution_update / tool_execution_end
turn_start / turn_end
compaction_start / compaction_end
queue_update
```

---

## Architecture

```
┌─────────────────────────────────────┐
│  Electron Main Process              │
│  src/main/index.ts + pi-sdk.ts      │
│                                     │
│  • createAgentSession() in-process  │
│  • session.subscribe() → events     │
│  • SessionManager.list() for sidebar│
│  • ipcMain handlers for renderer    │
├─────────────────────────────────────┤
│  Preload                            │
│  src/preload/index.ts               │
│                                     │
│  • contextBridge.exposeInMainWorld  │
│  • piApi.prompt(text)               │
│  • piApi.abort()                    │
│  • piApi.onEvent(callback)          │
│  • piApi.getSessions()              │
│  • piApi.switchSession(path)        │
│  • piApi.newSession()               │
│  • piApi.getState()                 │
├─────────────────────────────────────┤
│  Renderer (React)                   │
│  src/renderer/src/                  │
│                                     │
│  • Sidebar: project list → sessions │
│  • Chat: message list + input       │
│  • Virtual scroll for messages      │
│  • Streaming: DOM append for tokens │
│  • Markdown + code highlight        │
└─────────────────────────────────────┘
```

---

## Performance Rules (Non-negotiable)

1. **Streaming tokens**: During `text_delta`, use direct DOM manipulation (`ref.current.textContent += delta`). NO React state update per token. Re-render with Markdown only after `message_end`.
2. **Virtual scroll**: Use `@tanstack/react-virtual` for message list. Only render visible items + buffer.
3. **Async code highlight**: Never block main thread. Use shiki async or Web Worker.
4. **Lazy tool output**: Collapsed by default. Only render content on expand.
5. **Auto-scroll**: Follow bottom during streaming. Stop following on manual scroll up.

---

## Development Plan

### Phase 0: SDK Integration ✅ DONE

- [x] `pnpm add @mariozechner/pi-coding-agent` — installed v0.67.68
- [x] Create `src/main/pi-sdk.ts`: `createAgentSessionRuntime()` + event forwarding
- [x] Forward SDK events to renderer via `webContents.send('pi:event', event)`
- [x] Update preload: typed `piApi` (prompt, abort, getState, onEvent, etc.)
- [x] Update renderer: receives events, displays model name
- [x] Remove old `pi-rpc.ts`
- Note: electron-vite config needs `build.externalizeDeps.exclude` for ESM-only `@mariozechner/*` packages
- Note: Main bundle is ~7MB (full SDK bundled), acceptable for desktop app

### Phase 1: Minimal Chat UI ← CURRENT

- [ ] Layout: left sidebar (240px) + main content (already scaffolded)
- [ ] Input box: multiline, Enter=send, Shift+Enter=newline (already scaffolded)
- [ ] Message list: user/assistant bubbles (plain text, already scaffolded)
- [ ] Streaming: direct DOM append on text_delta → finalize with React state on message_end
- [ ] Auto-scroll: follow bottom during streaming, stop on manual scroll up
- [ ] Abort button during streaming
- [ ] Status indicator: idle / streaming / tool_executing

### Phase 2: Session Management + Sidebar

- [ ] `SessionManager.listAll()` to get all sessions
- [ ] Group by project path, display in sidebar
- [ ] Click → `runtime.switchSession()`, re-subscribe events
- [ ] New session button → `runtime.newSession()`
- [ ] Load history on switch (`session.messages`), highlight current

### Phase 3: Markdown + Code Rendering

- [ ] react-markdown for assistant messages (on message_end only)
- [ ] shiki for code blocks (async highlight)
- [ ] Copy button, inline code, clickable links

### Phase 4: Tool Output

- [ ] Collapsible tool blocks (collapsed by default)
- [ ] Bash: monospace + ANSI colors
- [ ] Read/Edit: file content + diff view
- [ ] Expand on click → lazy render content

### Phase 5: Virtual Scroll + Perf

- [ ] @tanstack/react-virtual for message list
- [ ] Dynamic height measurement
- [ ] Streaming message bypasses virtualizer (pinned at bottom)
- [ ] Lazy expand for tool output

### Phase 6: Model + Settings

- [ ] Model switcher (`session.cycleModel()` / `session.setModel()`)
- [ ] Thinking level control (`session.setThinkingLevel()`)
- [ ] Token usage display (from `message_end` usage data)
- [ ] Context window usage bar

### Phase 7: Polish

- [ ] Keyboard shortcuts (Cmd+N new session, Cmd+K clear, Escape abort)
- [ ] Theme support
- [ ] Crash recovery (session persistence is handled by pi)
- [ ] Window state persistence (size, position)
- [ ] App icon + about dialog

---

## Commands

```bash
cd /Users/mwei2/PersonalCode/pigi
pnpm run dev          # Start dev (Electron + Vite HMR)
pnpm run build        # Typecheck + build
pnpm run build:mac    # Build macOS distributable
pnpm run lint         # ESLint
pnpm run format       # Prettier
```

---

## Key File Paths

| What             | Path                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| Project root     | `/Users/mwei2/PersonalCode/pigi/`                                     |
| Main process     | `src/main/index.ts`                                                   |
| Pi SDK wrapper   | `src/main/pi-sdk.ts` (to create)                                      |
| Preload          | `src/preload/index.ts`                                                |
| React entry      | `src/renderer/src/main.tsx`                                           |
| App component    | `src/renderer/src/App.tsx`                                            |
| Vite config      | `electron.vite.config.ts`                                             |
| Pi SDK docs      | `~/.n/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`     |
| Pi session docs  | `~/.n/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md` |
| Pi RPC docs      | `~/.n/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`     |
| Pi sessions dir  | `~/.pi/agent/sessions/`                                               |
| Codex screenshot | `/Users/mwei2/Pictures/screenshot/SCR-20260422-pbtw.png`              |
