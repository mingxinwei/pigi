# pigi Lean High-Performance Plan

> Goal: Build a small, solid macOS Electron client for the pi coding agent. Prioritize fast chat, reliable session switching, readable tool output, and a clean technical foundation. Do not build every pi/TUI feature upfront.

## Scope

### In Scope

- Electron desktop app for one active pi runtime at a time.
- Chat UI with streaming assistant responses.
- Full basic tool rendering system for core pi coding tools.
- Current project/session management.
- Lightweight session sidebar with recent sessions.
- Markdown rendering for finalized assistant messages.
- Model/thinking display and simple cycle controls.
- Good performance for normal daily coding-agent usage.

### Out of Scope for Now

These are intentionally deferred unless daily use proves they are needed:

- Full session tree UI.
- Branch visualization and advanced fork/clone workflows.
- Full settings editor.
- Full extension/skill management UI.
- Multi-runtime warm cache.
- Full-text search across all sessions.
- Rich bespoke renderers for every custom/MCP/extension-specific tool beyond a generic fallback.
- Complex command palette beyond minimal slash/template support.
- Notarization/auto-update.
- Benchmark dashboard.

### Non-Negotiable Technical Foundation

These are in scope even for the small product because they shape the architecture and are expensive to retrofit:

- **MessagePort streaming** for high-frequency text/thinking/tool-output deltas.
- **Virtualized transcript viewport** for message rendering.
- **Core tool renderers** for bash/read/edit/write and generic unknown tools.
- **Markdown/code rendering** for finalized assistant messages, with strict lazy rendering and caching.
- **Agent Host isolation** using `utilityProcess` or worker for the pi SDK runtime, with Electron main kept thin.
- **shadcn/ui** for common React UI primitives.
- **Zustand** for app-level UI state, with transcript state kept in a local reducer/controller.

The product surface stays small; the technical base should still be production-shaped.

---

## Product Principles

1. **Small product, strong foundation**
   - Build the smallest useful GUI around pi.
   - Keep architecture clean enough to extend later.
   - Avoid building rarely-used features before the core feels excellent.

2. **Streaming must feel fast**
   - No React state update per token.
   - Use direct DOM/TextNode append or chunk buffers for active streaming text.
   - Batch high-frequency deltas before crossing process boundaries when needed.

3. **Use pi SDK directly, but isolate it from Electron main**
   - SDK runs in an Agent Host (`utilityProcess` preferred, worker acceptable if simpler).
   - Electron main handles window lifecycle, security, and IPC bridging only.
   - Keep a `RuntimeManager` wrapper inside the Agent Host.

4. **Keep event handling centralized**
   - Low-frequency SDK lifecycle events may be forwarded raw initially.
   - UI components should not directly switch on raw SDK events.
   - A centralized transcript controller/reducer converts SDK events, stream batches, and hydrated messages into UI state.

5. **Tool and markdown rendering are core UI, not polish**
   - Core pi tools need readable renderers: bash, read, edit, write, and generic fallback.
   - Finalized assistant messages need Markdown/code rendering.
   - Markdown parsing/highlighting must stay lazy, cached, and visible-item bounded.
   - Heavy rendering must never run per token.

6. **Large output should not break the app**
   - Tool output is collapsed by default.
   - Keep previews in memory; avoid storing huge output repeatedly in React state.
   - Full-output loading is lazy.

7. **No premature feature completeness**
   - Prefer one polished path over many half-finished panels.
   - Add advanced pi features only after the basic loop is stable.

8. **Debuggability is part of the foundation**
   - Keep renderer CDP enabled in dev.
   - Support repeatable screenshots, accessibility snapshots, console inspection, and JS evaluation.
   - Add stable `data-testid` attributes for automation.
   - See `docs/electron-debug.md` for the debugging workflow.

9. **Borrow proven pi-web-ui patterns, but keep a React/Electron implementation**
   - Reference: `docs/pi-web-ui-research.md` and `/Users/mwei2/PersonalCode/pi-mono/packages/web-ui`.
   - Reuse ideas, not the whole Lit/web-components package.
   - Keep pigi built around `AgentSessionRuntime`, pi JSONL sessions, Electron process isolation, MessagePort streaming, and React virtualization.

10. **Use small, composable UI/state libraries**

- Use shadcn/ui for accessible primitives and consistent styling.
- Use Zustand for app-shell/UI state.
- Keep transcript/streaming state in a local reducer/controller so high-frequency and large-message paths stay isolated.
- Do not introduce Redux.
- Do not add TanStack Query unless session indexing/search grows into query-cache style data fetching.

---

## Minimal Architecture

The product is small, but the process model should be solid from the start.

```text
Renderer React
  ├─ Chat UI
  ├─ Sidebar
  ├─ TranscriptController
  ├─ VirtualizedTranscriptViewport
  └─ Streaming DOM path
       ↓ preload API
Electron Main
  ├─ Window lifecycle
  ├─ Security boundary
  ├─ IPC validation
  └─ Agent Host bridge
       ↓ control IPC + MessagePort streams
Agent Host utilityProcess/worker
  ├─ RuntimeManager
  ├─ StreamBatcher
  └─ pi SDK runtime
```

Electron main should not own the pi SDK runtime long-term. A temporary SDK-in-main prototype is acceptable only as a stepping stone while wiring the Agent Host.

---

## UI and State Libraries

### shadcn/ui

Use shadcn/ui for common React UI primitives:

- Button
- Textarea
- Dialog
- DropdownMenu
- Popover
- Tooltip
- Select
- Badge
- Separator
- Sheet
- Collapsible
- Command later for slash/model palette

Guidelines:

- Use shadcn components for shell controls, dialogs, menus, buttons, inputs, badges, and collapsible sections.
- Build transcript, message bubbles, streaming text, and core tool renderers ourselves.
- Do not wrap the transcript virtualizer in shadcn `ScrollArea`; use the virtualizer's own scroll container.
- Adapt shadcn setup to Tailwind CSS v4 rather than blindly following Tailwind v3 config examples.
- Keep styling token-based through CSS variables so themes remain possible later.

### Zustand

Use Zustand for app-level UI state:

- runtime ready/error state
- active project/session metadata
- sidebar expanded/collapsed state
- selected session
- model/thinking display
- queue counts
- dialog open/close state
- drafts/preferences that are not pi session data

Do not store the full transcript in Zustand for the first version. Transcript can become large and has special streaming performance rules.

Recommended split:

```text
Zustand app store
  - app shell state
  - runtime/session metadata
  - sidebar/dialog/preferences

Local transcript controller/reducer
  - hydrated messages
  - active assistant/tool lifecycle
  - finalized transcript nodes
  - session switch/reset

Imperative refs/controllers
  - streaming TextNode/chunk append
  - scroll following
  - virtualizer instance
```

Avoid for now:

- Redux: too heavy for this app.
- TanStack Query: not needed for local IPC/event-stream data yet.
- Global transcript persistence in localStorage/Zustand: pi sessions are the source of truth.

---

## pi-web-ui Patterns to Reuse

`@mariozechner/pi-web-ui` is not a drop-in fit for pigi because it is Lit-based and built around `pi-agent-core` `Agent`, browser storage, browser API key flows, artifacts, and attachments. pigi should still implement its own React/Electron UI on top of `pi-coding-agent` `AgentSessionRuntime`.

Helpful patterns to copy conceptually:

1. **Stable finalized list + separate streaming container**
   - pi-web-ui renders stable messages separately from the active streaming message.
   - pigi should implement this as a virtualized finalized transcript plus a pinned active streaming block.
   - This avoids duplicate rendering when `message_end` moves content from streaming state to finalized state.

2. **Assistant content order preservation**
   - Render assistant blocks in the order they arrive: text, thinking, tool calls.
   - Pair tool calls with tool results by `toolCallId`.
   - Do not collapse assistant messages into a single string too early.

3. **Tool renderer registry**
   - pi-web-ui has `registerToolRenderer()` / `renderTool()` and a generic fallback renderer.
   - pigi should implement a React equivalent for bash/read/edit/write + generic fallback.

4. **Thinking block UX**
   - Thinking content should be a first-class collapsible block.
   - Streaming thinking may show subtle activity state, but should not trigger expensive Markdown rendering per token.

5. **Input editor details**
   - Enter sends, Shift+Enter inserts newline.
   - Escape aborts while streaming.
   - Preserve the IME guard from pi-web-ui:

```ts
if (e.isComposing || e.key === 'Process') return;
```

6. **Usage formatting**
   - Adapt `formatUsage`, `formatTokenCount`, and `formatCost` from pi-web-ui's `src/utils/format.ts`.

Important improvements over pi-web-ui:

- Do not deep-clone streaming messages per animation frame.
- Do not render Markdown for every streaming update.
- Do use MessagePort batches for high-frequency deltas.
- Do use virtualized transcript rendering.
- Do lazy-mount heavy tool output only when expanded.

---

## Communication Strategy

### Control Channel

Use normal Electron IPC for low-frequency operations:

- `prompt`
- `steer`
- `followUp`
- `abort`
- `getState`
- `getMessages`
- `newSession`
- `switchSession`
- `listRecentSessions`

Low-frequency lifecycle events can use `webContents.send`:

- runtime ready/error
- message start/end
- tool start/end
- queue update
- diagnostics/error

### Streaming Channel

Use MessagePort for high-frequency streaming from the Agent Host to renderer:

- batch `text_delta`, `thinking_delta`, and tool-output updates
- flush batches every 16ms or 32ms
- never send one IPC message per token
- keep normal `webContents.send` for low-frequency control/lifecycle events only

Minimal stream shape:

```ts
type StreamBatch = {
  type: 'stream_batch';
  text?: Record<string, string>;
  thinking?: Record<string, string>;
  toolOutput?: Record<string, string>;
};
```

---

## Core Renderer State

### Transcript Controller

This does not mean Redux. It can be a React `useReducer`, Zustand store, or small TypeScript class.

Responsibilities:

- Convert SDK lifecycle events into UI state.
- Apply stream batches to active streaming nodes.
- Normalize `session.messages` during startup/session switch.
- Track current status:
  - idle
  - streaming
  - tool running
  - error
- Reset safely on abort/new session/session switch.

UI components should receive clean state:

```ts
interface TranscriptState {
  nodes: TranscriptNode[];
  activeAssistantId?: string;
  activeToolId?: string;
  status: 'idle' | 'streaming' | 'tool_running' | 'error';
}
```

### Transcript Node Model

Keep the model simple but not string-only:

```ts
type TranscriptNode = UserNode | AssistantNode | ToolNode | SystemNode;

interface AssistantNode {
  id: string;
  role: 'assistant';
  text: string;
  thinking?: string;
  model?: string;
  provider?: string;
  stopReason?: string;
  errorMessage?: string;
  isStreaming?: boolean;
}

interface ToolNode {
  id: string;
  role: 'tool';
  name: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  preview: string;
  fullOutputRef?: string;
  truncated?: boolean;
}
```

Do not implement full pi session tree nodes now. Preserve enough IDs/metadata so this can evolve later.

---

## Performance Targets

These are practical targets, not a benchmark product.

- Window visible quickly in dev/prod.
- Streaming text does not trigger React render per token.
- A few hundred messages remain usable.
- Large tool output is collapsed and does not freeze the app.
- Session switch feels immediate for normal sessions.
- Build/typecheck stay fast enough for daily iteration.

---

## Phase 0 — Backend Process and SDK Runtime Foundation

### Goals

Put the pi SDK behind a small Agent Host so Electron main stays thin.

### Tasks

- Create an Agent Host using `utilityProcess` if practical; use worker thread only if Electron/Vite packaging makes utilityProcess too costly initially.
- Move pi SDK runtime creation into the Agent Host.
- Keep Electron main responsible for:
  - window lifecycle
  - input validation
  - forwarding commands to Agent Host
  - forwarding control events to renderer
  - transferring MessagePort streams
- Add `RuntimeManager` inside Agent Host.
- Add `runtime_ready` and `runtime_error` control events.
- Show runtime initialization state in renderer.
- Add input validation for IPC handlers:
  - non-empty prompt string
  - valid session path from known sessions
- Fix package scripts to use `pnpm run`, not `npm run`.
- Add shadcn/ui setup compatible with Tailwind CSS v4.
- Add Zustand for app-shell/UI state.
- Remove stale RPC labels from UI/docs.
- Add cleanup for session subscriptions on new/switch/dispose.

### Acceptance Criteria

- pi SDK does not run directly in Electron main in the target implementation.
- Electron main remains a bridge, not the agent runtime owner.
- App starts and clearly shows ready/error state.
- Prompt works after runtime ready.
- Abort works without leaving UI stuck.
- `pnpm run build` passes.

---

## Phase 1 — Solid Minimal Chat with MessagePort Streaming

### Goals

Deliver the main daily-use loop with the correct streaming architecture: send prompt, watch stream, see tools, continue.

### Tasks

- Implement centralized `TranscriptController` / `transcriptReducer`.
- Move event handling out of general UI components.
- Add startup hydration from `getMessages()`.
- Handle core control events:
  - `agent_start` / `agent_end`
  - `message_start` / `message_end`
  - `tool_execution_start` / end
  - `queue_update`
- Handle high-frequency stream events over MessagePort:
  - `text_delta`
  - `thinking_delta`
  - tool output updates
- Add Agent Host `StreamBatcher`:
  - merge deltas by node/tool id
  - flush every 16ms or 32ms
  - avoid one message per token
- Streaming text path:
  - follow pi-web-ui's high-level pattern of a separate streaming container
  - improve it by using MessagePort batches instead of deep-cloning full messages
  - append active assistant text without React state update per token
  - finalize to React state on `message_end`
- Preserve assistant block order:
  - text
  - thinking
  - tool calls
- Pair tool calls/results by `toolCallId`.
- Basic auto-scroll:
  - follow bottom while at bottom
  - stop following when user scrolls up
- Basic error display for assistant/tool failures.
- Abort button during streaming.
- Input keyboard behavior:
  - Enter sends
  - Shift+Enter newline
  - Escape aborts while streaming
  - ignore Enter handling during IME composition with `e.isComposing || e.key === 'Process'`

### Acceptance Criteria

- No duplicate empty assistant bubbles.
- User prompt appears immediately.
- Assistant streams smoothly through MessagePort batches.
- Tool call appears as a collapsed/basic block.
- Abort returns UI to idle/error-safe state.
- Reload/session hydration shows previous messages.

---

## Phase 2 — Virtualized Chat View and Recent Sessions Sidebar

### Goals

Make the main viewport scalable and session switching useful without building a full session manager.

### Tasks

- Add virtualized transcript viewport with dynamic height measurement.
- Keep active streaming node compatible with virtualization:
  - either pinned outside the virtualizer until finalized
  - or measured carefully after batch flushes
- Preserve auto-scroll behavior with the virtualizer.
- List recent sessions for the current project first.
- Add a simple sidebar group:
  - current project
  - recent sessions
- Show session title/preview:
  - session name if available
  - otherwise first user message or timestamp
- New session button.
- Switch session button/list item.
- On switch:
  - block or confirm if streaming
  - switch SDK runtime session
  - reset transcript controller
  - hydrate messages
- Avoid full global `listAll()` on every render.
- If using `listAll()`, do it manually/on refresh, not on every startup path.

### Acceptance Criteria

- Can create a new session.
- Can switch back to a recent session.
- Streaming session cannot be accidentally replaced.
- Sidebar remains simple and fast.
- A few hundred messages remain smooth because rendering is virtualized.

---

## Phase 3 — Core Tool Rendering System

### Goals

Tool rendering is basic product functionality for a coding agent. Implement clear renderers for the core pi coding tools while keeping custom/extension tools generic.

### Tasks

- Build a small tool renderer registry.
- Build a React version of pi-web-ui's renderer-registry pattern:
  - `registerToolRenderer(toolName, renderer)`
  - `renderTool(toolName, params, result, isStreaming)`
  - generic fallback renderer
- Tool blocks collapsed by default, expandable on demand.
- Shared tool header:
  - tool name
  - status: running/success/error/cancelled
  - duration if available
  - short args preview
  - error/success marker
- Large output handling:
  - truncate preview
  - keep full output ref/path if available
  - offer copy/open full output when available
  - never keep repeated huge output strings in React state
- Implement core renderers:
  - `bash`: command, output preview, exit/error/cancelled/truncated state, monospace output
  - `read`: file path, text preview, line-number-friendly layout
  - `edit`: file path, before/after or diff-style preview when available
  - `write`: file path, content/size preview when available
- Add a copy button pattern for console/code output, inspired by pi-web-ui's `ConsoleBlock`.
- Generic fallback renderer:
  - text content
  - JSON/details collapsed view
  - safe handling for unknown custom/MCP tools
- Defer only highly specialized custom tool renderers.
- Do not copy pi-web-ui's current BashRenderer directly; use it only as a reference because pigi needs truncation, full-output refs, and better large-output handling.

### Acceptance Criteria

- Bash/read/edit/write are visually distinct and understandable.
- Unknown tools still render safely with a generic fallback.
- Large tool output does not freeze the app.
- Tool failures are visible.

---

## Phase 4 — Markdown and Code Rendering

### Goals

Markdown/code rendering is basic chat functionality. Implement it for finalized assistant messages without hurting streaming performance.

### Tasks

- Add markdown rendering for finalized assistant text only.
- Keep active streaming text as plain text.
- Do not render raw HTML.
- Safe external links through Electron main, only `http:`/`https:`.
- Support common Markdown:
  - paragraphs
  - lists
  - tables/GFM
  - blockquotes
  - inline code
  - fenced code blocks
- Performance rules:
  - never parse/render Markdown per token
  - parse only finalized messages
  - render only mounted/visible virtualized items
  - memoize rendered Markdown by message id + content hash
  - avoid re-rendering all messages when one message finalizes
  - use plain text fallback for very large messages
- Add code block rendering:
  - language label
  - copy button
  - readable styling
- Add Shiki or equivalent syntax highlighting as part of the core renderer:
  - create/cache one highlighter instance
  - highlight only finalized/visible code blocks
  - cache highlighted output by language + code hash
  - skip or defer huge code blocks
  - do not block streaming path
  - move highlighting to a worker if visible jank appears

### Acceptance Criteria

- Finalized assistant messages render Markdown.
- Streaming messages stay cheap/plain until finalized.
- Markdown rendering is memoized and limited to visible/mounted messages.
- Finalizing one message does not re-render the entire transcript.
- Code blocks are readable and copyable.
- Large messages/code blocks fall back or defer instead of freezing UI.
- Links open safely.

---

## Phase 5 — Minimal Model and Queue UX

### Goals

Expose the pi controls that are useful every day.

### Tasks

- Show current model/provider in status bar.
- Add cycle model control.
- Show current thinking level.
- Add cycle thinking-level control.
- Support sending while streaming by choosing:
  - steer
  - follow-up
- Show queued follow-up/steering count from `queue_update`.
- Add compact usage display using adapted pi-web-ui formatting helpers:
  - `formatUsage`
  - `formatTokenCount`
  - `formatCost`
- Persist draft input per active session if simple.

### Acceptance Criteria

- Model/thinking state is visible.
- User can queue or steer without causing SDK errors.
- Queue state is understandable.

---

## Phase 6 — Focused Performance Hardening

### Goals

Validate and tune the required performance foundation without expanding product scope.

### Tasks

- Profile Agent Host → MessagePort → renderer streaming path.
- Tune batch flush interval: 16ms vs 32ms.
- Profile virtualized transcript with dynamic heights.
- Ensure active streaming + virtualization does not cause layout thrash.
- Profile Markdown/code rendering on long assistant messages.
- Verify Markdown memoization prevents full transcript re-renders.
- Avoid keeping large tool output in React state.
- Add simple synthetic tests/scripts:
  - long streaming answer
  - large tool output
  - session with hundreds of messages
  - Agent Host startup/restart

### Acceptance Criteria

- Daily usage remains responsive.
- No obvious UI freeze during streaming/tool output.
- Memory does not grow unexpectedly after repeated prompts/session switches.

---

## Phase 7 — Persistence, Debuggability, and Polish

### Goals

Make the small product pleasant, reliable, and easy for agents/developers to inspect.

### Tasks

- Add stable `data-testid` attributes for:
  - transcript viewport
  - chat input
  - send/abort buttons
  - sidebar
  - status bar
  - message/tool blocks
- Add or document debug commands for:
  - screenshot
  - accessibility snapshot
  - JS evaluation
  - console errors
- Keep renderer CDP on port `9222` in dev.
- Add optional main-process inspector script on port `9229`.
- Persist window size/position.
- Persist last active project/session.
- Restore draft input if easy.
- Add basic keyboard shortcuts:
  - Cmd+N new session
  - Escape abort
  - Cmd+L focus input
- Add app icon/about later if packaging is needed.
- Add basic logs/diagnostics view only if runtime errors are hard to debug.

### Acceptance Criteria

- Closing/reopening restores useful state.
- Basic keyboard flow feels good.
- Screenshots/snapshots/console checks are repeatable during development.
- App remains simple.

---

## Deferred Backlog

Only pick these up after the lean product is used regularly and a need is clear.

### Advanced Session Features

- Full session tree UI.
- Branch/fork/clone UI.
- Labels/checkpoints.
- Compaction history visualization.
- Session rename/delete/trash.

### Advanced Search/Indexing

- Global session index cache.
- Full-text search.
- Cross-project search.
- Background index worker.

### Advanced Tool UI

- Rich side-by-side diff viewer beyond basic edit preview.
- Full ANSI terminal emulation beyond basic monospace output.
- Advanced file preview with syntax highlighting and line anchors.
- Bespoke renderers for custom/MCP/extension-specific tools.
- Per-tool plugin system.

### Advanced Runtime Architecture

- LRU warm runtime cache per project.
- Separate MessagePort channels for transcript/tool/index streams beyond the initial single stream port.
- More advanced Agent Host supervision/restart policies.

### Advanced Input

- Full command palette.
- Slash command autocomplete.
- File mention autocomplete.
- Image paste/drop.

### Distribution

- macOS notarization.
- Auto-update.
- Diagnostics bundle export.

---

## Testing Strategy

Keep tests focused on stability-critical code.

### Unit Tests

- Transcript controller/reducer.
- Message normalization from `session.messages`.
- Assistant block ordering and `toolCallId`/tool result pairing.
- Tool output truncation.
- Core tool renderer data mapping.
- Markdown/code rendering thresholds.
- Markdown render memoization/cache behavior.
- Input keyboard behavior, including IME composition guard.
- Usage formatting helpers.
- IPC argument validation.

### Manual Smoke Tests

- App starts.
- Runtime ready appears.
- Prompt streams.
- Bash/read/edit/write tool calls render with distinct core renderers.
- Markdown and code blocks render after assistant message finalizes without affecting streaming smoothness.
- Abort works.
- New session works.
- Switch recent session works.
- Build passes.

### Performance Smoke Tests

- Long answer streams smoothly.
- Large tool output remains collapsed and responsive.
- A few hundred messages still scroll smoothly with virtualization.

---

## Immediate Next Steps

1. Fix `package.json` scripts to use `pnpm run` internally.
2. Set up shadcn/ui for Tailwind CSS v4 and add initial primitives: Button, Textarea, Dialog, Tooltip, Badge, Collapsible.
3. Add Zustand and create `src/renderer/src/state/app-store.ts` for app-shell/UI state.
4. Create Agent Host skeleton and move pi SDK runtime behind it.
5. Add `runtime_ready` / `runtime_error` and show initialization state.
6. Create MessagePort stream channel for batched `text_delta`, `thinking_delta`, and tool output.
7. Create `src/renderer/src/state/transcript.ts` with a small local transcript controller/reducer.
8. Move current event handling from `App.tsx` into that centralized transcript state module.
9. Add startup `getMessages()` hydration.
10. Add virtualized transcript viewport with a separate pinned streaming block.
11. Add core tool renderer registry for bash/read/edit/write + generic fallback, following pi-web-ui's registry pattern.
12. Add ThinkingBlock-style collapsible thinking UI.
13. Add Markdown/GFM + code rendering for finalized assistant messages.
14. Add input IME guard and keyboard behavior from pi-web-ui's MessageEditor.
15. Adapt pi-web-ui usage formatting helpers.
16. Implement recent-session sidebar for the current project only.
