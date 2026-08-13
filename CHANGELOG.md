# Changelog

## [Unreleased]

### Added

- Expanded Minimal-view details now reveal copy controls for assistant messages and tools; collapsed turns expose the control only for their final summary.

### Fixed

- Minimal-view summaries no longer retain a stale “Thinking...” activity row after text output begins.
- Prompt and session startup failures now return the chat input to its send state instead of leaving the session permanently showing Abort.
- Minimal-view turn-end scrolling now removes its spacer and terminal pin state when interrupted by the mouse wheel.
- Returning to a session after `MessageList` remounts now restores its saved scroll position.
- Switching to Minimal view during an active run now establishes the active turn's top pin.
- Context compaction markers no longer split an active Minimal-view turn or capture its subsequent assistant and tool output.
- Long Minimal-view intro or summary output now keeps following downward after it exceeds the viewport, even when the user message and first agent events arrive in the same render batch.
- Switching away from a session and back while a Minimal-view turn is running now restores its pin even when a tool or assistant response is the latest transcript entry.
- Expanding a running Minimal-view turn now fills the available space before following new tool cards downward, instead of scrolling partly past the newest card.
- Expanding and collapsing a finished Minimal-view turn now keeps the same spacing below its “Worked for” header, eliminating the small vertical jump.
- A running Minimal-view turn can no longer be scrolled below its pinned header; scrolling upward still releases the pin so earlier history remains accessible.
- Expanded Minimal-view working headers now stay above sticky “Show more” controls instead of being partially covered.
- Collapsing a finished turn while its header is sticky at the top now scrolls back to the turn's natural position, so you can see the collapsed state instead of being stranded below it.
- The one-frame blank flash when a turn ends (the viewport briefly jumped to the spacer area before it was removed) is gone.
- Error messages (e.g. 401 responses) now show correctly in the collapsed turn view instead of rendering as empty space.

### Changed

- User message bubbles now use tighter vertical padding and clamp long messages to half their previous maximum height.
- Minimal view now keeps the previous thinking or tool activity visible until the next activity replaces it; assistant output hides only older activity, so a later tool or thinking event can appear normally while summaries never retain a stale feed underneath.
- Collapsing an expanded turn in the Minimal view is now instant: the turn's summary appears in its slot immediately and the view settles to its rest position in one step — no fold, fade-in, or roll animation in between, so there is nothing left to flicker.
- Minimal view scroll pin refactored to an explicit state machine (`idle` / `pinned` / `following` / `scrolled` / `ending`), replacing three scattered boolean refs. Net reduction of ~200 lines; same behavior, no invalid state combinations.

## [0.4.3] - 2026-08-09

### Added

- New "Minimal" view mode in the message toolbar's view dropdown: each of your messages opens a turn with a live "Working for Xm Ys" timer (click it to expand the full tool cards and thinking), a shimmer line shows what the agent is doing right now, a finished command stays until the next activity replaces it, and the turn closes with the agent's final summary. Scrolling behaves exactly like the other views — auto-follow on new messages, saved positions, and the user-message minimap all work.
- In the Minimal view's activity area, each activity (thinking, command, narration) stays on screen at least a second: when commands fly by faster than that, the intermediate ones are skipped and the latest one takes the line as soon as it is readable — the area never queues up and never lags behind what the agent is actually doing. The activity line keeps a fixed height, so nothing jumps as it switches between thinking, commands, and narration.
- In the Minimal view, sending a new message pins the turn's working area to the top of the message list with open space below it — the work has the whole window to grow into instead of being squeezed at the bottom of a long history. When the turn finishes, the list settles back to a normal layout automatically.
- When a turn in the Minimal view finishes, its final summary now streams in word by word right below the working area, while the open space under it shrinks by the same amount — the text visibly takes the place of the blank padding, so nothing jumps and the working header stays exactly where it was. When the stream completes, the view glides back to the bottom of the list to show the full summary; a summary longer than the window keeps following its own end as it grows (like normal output), and scrolling away during the stream locks your position — no re-pin, no glide, no pulling back.

### Changed

- While a turn in the Minimal view is running, its working area now stays pinned at the top for the whole run — scrolling with the mouse no longer releases it, so the live activity keeps its place and the open space below until the summary appears.
- In the Minimal view's activity line, the shimmer sweep now covers the whole row (starting from the command prefix) instead of only the text after it, always starts from the left edge when a command appears, and keeps sweeping until the row is actually replaced by the next activity — a finished command no longer goes quiet before it is swapped out.
- In the Minimal view's activity line, an over-long command now ellipsizes in the middle and keeps its ending visible (the useful part — filenames, flags, final arguments) instead of cutting the end off.
- Collapsing an expanded turn in the Minimal view now feels like the terminal panel: the fold and the settle are two separate motions (a short beat between them when the header is pinned), unpinned turns fold in place instead of rolling back to the bottom, and canceling a fold mid-way springs the details smoothly back open instead of jumping.
- The settle-back animations in the Minimal view (when a turn finishes, when details collapse) now follow the same motion curve as the rest of the app instead of their own — nothing feels linear next to the terminal's open/close anymore.

### Fixed

- In the Minimal view, switching away from a session and back while a turn is still running no longer drops the working area's pin: the turn is re-pinned (viewport-height padding and all) once the session resumes, even when the transcript is still replaying.
- In the Minimal view, expanding a running turn's details keeps the working header exactly where it was — the details open in place, and the viewport rolls only as far as the details bottom (the newest activity); a short expansion does not move the viewport at all. Collapsing the details while the turn is still running restores the top pin and its padding instead of leaving the layout unpinned.
- In the Minimal view, collapsing a running turn's expanded details no longer fights itself: the fold grows the padding by exactly the folded-away height (so the list bottom never rises into the viewport and clamps the scroll, whatever the details height), then the viewport glides once to the pinned position — the working header stays glued in place through the fold and the re-pin is a zero delta.
- In the Minimal view, collapsing details with reduced motion (and collapsing while switching views mid-animation) no longer leaves the running turn unpinned: the pin is restored instantly instead of the viewport jumping to the list bottom, and the auto-scroll observers are re-armed on every exit path.
- In the Minimal view, collapsing expanded details no longer lags behind its own animation: the fold's per-frame height now overrides the CSS height transition (only opacity stays on the transition), so the details shrink at the intended pace and the leftover sliver at the end no longer pops away.
- Closing the terminal panel no longer leaves the chat suspended above it: the chat now slides down in sync with the panel again (the transform is dropped only after the close animation settles, so sticky headers still keep working).
- In the Minimal view, scrolling with the mouse while a turn is pinned no longer results in the view being pulled to the bottom when the turn ends — the pin and padding are dropped in place instead of gliding.
- Switching sessions or view modes mid-restore-animation no longer lets the animation's tail end override the restored scroll position.
- In the Minimal view, the opening text of a turn no longer appears twice (once in its fixed spot, once as a scrolling activity line) while it is still streaming.
- Subagents no longer start a second copy of the app to run in; they use the standalone pi CLI from your shell environment instead, which is lighter and does not crash on startup.
- In the Minimal view, the sticky working header no longer loses its pin after the terminal panel is opened and closed — previously the panel's animation left a lingering transform that silently disabled every sticky header behind it.
- Collapsing an unpinned turn in the Minimal view no longer waits half a second after the fold finishes before showing the collapsed content.

## [0.4.2] - 2026-08-07

### Added

- Pressing the up arrow in the chat input now recalls your previous messages, one by one back through the whole conversation; the down arrow walks forward again. If you had started typing something, it is remembered and comes back when you press down — so nothing you wrote is lost.

### Fixed

- In the sidebar, collapsing a project's chat list with "Show less" now sticks: the list no longer flickers and springs back open when the selected chat is one of the hidden older chats.
- Clicking a chat in the sidebar no longer makes the list refresh or jump: resuming a chat leaves the list untouched, and the scroll-to-center behavior now applies only to selections made outside the list (session switcher, navigation history), not to your own clicks.
- Thinking levels in a new chat now match the model you are on: models that support the strongest level (like Kimi K3's "max") offer it again, and the last-used level is clamped to what the current model actually supports instead of carrying over a level from another model.

## [0.4.1] - 2026-08-05

### Changed

- The view mode dropdown in the message toolbar now highlights the selected option (Compact / Show All) with the app's accent color and a matching check mark; the menu and its options have more breathing room.

### Fixed

- The model picker now reliably shows the full model list, including gateway models that load over the network: the model list is loaded once at startup, pushed to the app when ready, and refreshed when you log in or out — instead of being re-fetched and repeatedly polled by each chat, which could leave the picker stuck on a partial list.
- A new chat's thinking-level options now follow your most recently used model instead of the first model in the list when the app has just started.

## [0.4.0] - 2026-07-31

### Fixed

- The message list no longer visibly bounces while pinned to the bottom during fast streaming (most noticeable with quick models): the bottom pin now runs inside a ResizeObserver callback, so it applies in the same frame the content grows instead of one frame later.

## [0.3.20] - 2026-07-29

### Fixed

- The message list no longer occasionally vibrates when it's scrolled to the bottom, which could happen shortly after opening a conversation.
- The "Working..." indicator and the sidebar's running-session spinner stay smooth instead of stuttering while the app is busy rendering.
- Syntax-highlighted code in write previews and command output no longer flickers between plain and colored text as it streams in.

### Changed

- Tool blocks have a cleaner look: removed internal border lines, tightened spacing, and the status bar now uses colored text without a background fill.
- The conversation header is slightly taller and shows a notebook icon before the (now medium-weight) title; its width is capped and horizontal padding tightened.
- Tool block status bars now show a success/failure icon and just the elapsed time (dropped the "Elapsed"/"Took" labels), and status/thinking icons are a touch bolder.
- Links, search highlights, the message mini-map, focus rings, and the "Working..." indicator now use a refined indigo accent color instead of following the (often muted) system accent. More accent colors are built in, ready for an upcoming picker in settings.
- Large edit diffs render noticeably faster and are less likely to cause a hitch when they first appear, since off-screen diff lines are no longer laid out until scrolled into view.
- Large highlighted output (writes, command results, code blocks) renders faster: off-screen lines are no longer laid out until scrolled into view.

## [0.3.19] - 2026-07-27

### Added

- Built-in terminal panel that slides up from the bottom of the main area. Toggle it with the title-bar terminal icon or Cmd+J (the icon's tooltip shows the shortcut), and drag its top edge to resize. Its colors follow the app's light/dark theme, and it opens and closes with a smooth animation that stays fluid even on long conversations.
- Terminal tabs, one strip per project. The "+" button opens a new terminal in the current project's directory; each tab shows the shell's title and has a close button. Tabs are grouped per project: switching projects shows that project's own tabs, and switching back restores them exactly (shells and scrollback intact). The 5 most-recently-used projects are kept alive, and a project's tabs are released after an hour of inactivity. macOS line-editing shortcuts work inside the terminal (Cmd/Option with arrows and delete), clicking a tab focuses its terminal, and closing the last tab (or the panel) returns focus to the chat input.

### Changed

- In collapsed read groups, an over-long command now ellipsizes in the middle instead of the end, so the useful tail (filename, line range, final arguments) stays visible.

### Fixed

- Sessions are auto-named again after the first exchange. The automatic title generation had silently stopped working after a recent model-system update.

## [0.3.18] - 2026-07-23

### Added

- Edit, write, and bash tool cards now show a placeholder skeleton while they run, instead of a blank card, so it's clear content is still loading.

### Changed

- The title bar's bottom border is now a hairline that matches the sidebar divider, instead of the thicker, heavier line it used before.
- A successful edit no longer fills its status footer with green, so it no longer blends into the green of the diff above it. The footer bar and timing stay; only the background is dropped.

## [0.3.17] - 2026-07-23

### Changed

- Tightened spacing in rendered messages: paragraphs and lists now share a single, more compact line-height, so bullet and numbered lists no longer feel loosely spaced.
- Thinking blocks and long tool output now stay anchored to their latest lines when collapsed, with the Show more button above the content. Edit diffs still show from the top.

### Fixed

- New sessions sometimes opened with an incomplete model list (notably missing Booking-Gateway models) when a provider was slow to load. The model picker now keeps refreshing until the full list is available, and it updates on its own right after you log in or out.
- The message list and the scroll-to-bottom button sometimes stopped just short of the real bottom. Auto-scroll now lands exactly at the bottom.

## [0.3.16] - 2026-07-22

### Added

- Long block content (tool outputs, thinking text, user messages) now auto-collapses at 300px with a "Show more" / "Show less" button. For streaming tool output, the button floats above the content with a frosted-glass background while scrolling. For static content like user messages, the button sits below the clamped area.
- Consecutive read-only tool calls (read, grep, ls) now auto-group into a compact collapsed row like "Looked into 3 files". Expanding the group shows full tool outputs with search highlight support. The "Working..." shimmer row now appears at the end of expanded content inside the group.
- Thinking blocks inside read groups are shown as compact rows with a brain icon, duration, and chevron to expand the full block inline. Thinking blocks stay inside the group even after the thinking message finishes.
- Thinking blocks now display the thinking duration in the header, with live ticking during streaming.
- Tool block title rows now have a gray background for visual separation from the output body.

### Changed

- Tool block command timeout is now shown in the status bar (next to "Took Xs") instead of the title row.
- Show more/less chevron direction adapts to whether the button is above or below content.
- User message bubble spacing is now managed by a single container padding instead of individual margins.
- Thinking block collapsed max height reduced to 120px.
- Thinking duration format: sub-second durations show as `0.xs` instead of `<1s`.
- Live streaming thinking duration anchors to message start time rather than first delta, avoiding zero durations when deltas are batched.
- Tool block command truncation button no longer disappears after expanding.
- Expanding a read group no longer auto-scrolls to the bottom of the conversation.

### Fixed

- History thinking duration was missing when opening a previous session. Messages now carry the outer persistence timestamp for accurate duration calculation.
- Thinking blocks between read tools are transparent to grouping and appear inside the group instead of breaking it apart.
- Thinking deltas arriving in bursts no longer produce zero or missing durations during live streaming.

### Fixed

- Search matches hidden behind clamped content now auto-expand the block to reveal the match.

### Added

- Message search via Cmd+F / Ctrl+F: fuzzy-search across all messages and tool outputs, with keyboard-driven match navigation (Enter/arrows), per-occurrence active highlight like Chrome's find-in-page, and auto-expand for grouped read blocks and overflow-hidden tool content.

### Changed

- Upgraded pi SDK from v0.80.6 to v0.80.10, adding Kimi K3 model support and improving credential persistence for API key and OAuth providers.
- Improved markdown typography in assistant messages: more comfortable line height for reading, headings now visually group with their content, and code blocks have better spacing.

### Fixed

- Search highlights no longer disappear when navigating between matches — the active highlight now stays visible throughout paging.
- Tool output blocks with overflow-hidden content now auto-expand when jumping to a search match below the fold.
- Scroll-to-bottom button now scrolls all the way to the last message.

## [0.3.14] - 2026-07-10

### Added

- Message minimap now highlights the bar closest to your current scroll position with a blue indicator.
- Hovering the minimap popover highlights and scrolls the active item into view.
- OAuth device code flow support: when a provider requires a device code, a persistent toast shows the code with a "Copy & Open" button that copies to clipboard and opens the verification page.

### Changed

- Upgraded pi SDK from v0.74.0 to v0.80.6, bringing 30+ new LLM providers and models.
- Assistant messages now use the app's default line height instead of a fixed 24px, for a tighter and more natural reading rhythm.
- Message toolbar spacing shifted from above to below buttons, reducing visual gap between message text and action bar.
- Bottom gradient fade shortened to avoid overlapping the chat input area.
- Last message in the list has slightly more breathing room at the bottom.

### Fixed

- Scroll-to-bottom button now scrolls all the way to the last message instead of stopping a few pixels short.
- Restored bottom spacing between message list and chat input that was lost when switching to block translation layout.
- Reduced visual jitter when long content streams in during AI responses, especially noticeable in long thinking blocks.
- Sidebar now automatically scrolls to the selected session when switching, expanding the project and show-more list as needed

## [0.3.13] - 2026-07-01

### Fixed

- Switching sessions no longer triggers typewriter animation on the toolbar title.

## [0.3.12] - 2026-07-01

### Added

- Double-click the session name in the toolbar to rename it inline, matching the sidebar behavior.
- Toolbar session title now animates with the same typewriter effect as the sidebar when the title updates.

### Changed

- Expanded compact read group now shows tool cards inside the same bordered container.

## [0.3.11] - 2026-06-30

### Added

- Session toolbar at the top of the message list showing session title and a view mode toggle to switch between compact and full tool block display.

## [0.3.10] - 2026-06-30

### Added

- Compact read view mode: consecutive read-only tool calls (read, grep, rg, ls, fd, etc.) are collapsed into a single "Looked into N files" line with a list of commands underneath. Click to expand and see the full cards. Active groups show a shimmer animation on the current command.

### Fixed

- Pressing Enter while selecting text with an input method no longer saves a session rename.
- Pressing Esc now only aborts a running session when the chat input or message list is focused.
- New chats now recover better from failed startup attempts and retry without resending old failed messages.
- Session switcher now shows accurate relative times (e.g. "2m", "5h") instead of "now" for all sessions.
- Clicking a session or project in the sidebar now refreshes the session list

## [0.3.9] - 2026-06-28

### Fixed

- New sessions now appear in session switcher and sidebar after the first response completes
- Navigation forward/back no longer skips sessions that are being loaded from disk
- Session titles no longer get truncated to 48 characters on first message
- Switching sessions now correctly restores scroll-to-bottom position when user was already scrolled to the bottom

## [0.3.8] - 2026-06-14

### Fixed

- Clicking a session now properly switches the active project to that session's project
- Opening a new session no longer loses the previously active session from navigation history

## [0.3.7] - 2026-06-14

### Added

- New session view with centered "Here we go" heading, center-aligned input box, and clean footer
- `#project-name` dropdown in top-left of input for project selection with fuzzy search
- `#` hash autocomplete in textarea for switching projects

### Changed

- Thinking level options are now per-model: switching models filters available thinking levels automatically
- Model selection no longer available in new session toolbar; model/thinking set on first send

### Fixed

- Switching to a model that doesn't support the current thinking level now properly resets to `off` on the backend

### Changed

- Reduced spacing between messages in the transcript for a more compact layout.
- Markdown tables now have rounded corners.
- Increased the maximum number of recent projects from 12 to 64.

### Fixed

- The copy button now sits flush below thinking blocks instead of having extra space.
- The copy button now sits flush below thinking blocks instead of having extra space.
- Session switcher now shows accurate relative times (e.g. "2m", "5h") instead of "now" for all sessions.

## [0.3.6] - 2026-06-08

### Changed

- Auto-rename now triggers after 3 text messages instead of waiting for the first full agent turn to complete.

## [0.3.5] - 2026-06-08

### Added

- Auto-rename sessions: after 3 text messages (user + assistant, excluding tool calls), a lightweight LLM call generates a concise title using the cheapest available model. Triggers mid-turn without waiting for the full agent response.
- Typewriter animation when auto-rename updates the session title in the sidebar.

### Fixed

- Session switcher no longer lags when searching with many sessions (1000+).
- Session switcher now always selects the first item when opened or when search results change.
- Manual rename now refreshes the correct project's session list (uses session cwd instead of active project).

## [0.3.4] - 2026-06-07

### Fixed

- Ctrl+R session switcher shortcut now works in production builds, not just in dev mode.

## [0.3.3] - 2026-06-07

### Added

- Session session message lists remember scroll position — switching between sessions restores where you left off. New sessions open scrolled to the latest message.
- User message minimap on the right side of the chat — hover to see a list of your messages, click to jump to any one.
- Session switcher (Ctrl+R): search and switch to any session across all projects.
- Ctrl+Tab opens the session switcher and auto-focuses the previous session for quick toggling.
- Navigate session history with Cmd+[ (back) and Cmd+] (forward), browser-style.
- Switching sessions now auto-expands the project and scrolls to the session in the sidebar.

### Changed

- Dialog and command palette now use 550px width by default.

### Fixed

- Refreshing the app (Cmd+R) no longer breaks session resume — the session reconnects seamlessly.
- Opening a session no longer briefly logs errors about missing ports.
- Renamed sessions now show their updated name in the session switcher.

## [0.3.2] - 2026-06-03

### Changed

- Edit tool diffs now render using the server-computed diff from tool result details, instead of recomputing client-side from tool arguments. This enables diff display for custom edit tools (e.g. tagged-edit) that don't use oldText/newText arguments.

### Fixed

- Compaction errors now display as a separate error message below the "Compaction failed" marker, instead of cramming the full error into the marker line.
- Clicking a recently created session in the sidebar no longer switches to a different session.

## [0.3.1] - 2026-06-03

### Fixed

- New chat no longer appears twice in the sidebar.

## [0.3.0] - 2026-06-03

### Added

- New chat opens instantly with no delay — a warm background process is pre-spawned so model info and settings are available immediately.

### Changed

- Switching to a previous session is now near-instant — messages appear immediately without waiting for the background process.
- New chat shows the last-used model and thinking level by default (seeded from the most recent session on first launch).

### Fixed

- Alt+Enter follow-up message now works correctly during streaming.

## [0.2.8] - 2026-05-31

### Added

- Slash command autocomplete now includes available skills alongside built-in commands.

### Changed

- Send shortcut changed from Cmd+Enter to Enter (Shift+Enter still inserts newline).
- New sessions now inherit the last-used model and thinking level from the previous session.
- Long messages now fade out at the edge instead of being cut off.
- Refined visual polish across tool blocks, icons, menus, and dialogs.

### Fixed

- System accent color now correctly matches the macOS accent color setting.
- Tool block footer spacing restored between content and status bar.

## [0.2.7] - 2026-05-29

### Changed

- macOS window: refined border to hairline-thin by aligning `vibrancy`/`backgroundColor` with native Codex approach, removing redundant `transparent: true` and `visualEffectState: 'active'`.

### Fixed

- Disable Electron cookie encryption fuse to prevent macOS Keychain password prompt on launch.
- ESC/send button now correctly aborts in-progress compaction via `abortCompaction()`.
- Steer/followUp messages sent during compaction are preserved and replayed when compaction finishes.

### Changed

- Tool block: bash execution output no longer has syntax highlighting (plain text).
- Tool block: use shiki full bundle for syntax highlighting, supporting all languages (rust, go, etc.).
- Tool block: file extension resolved directly as shiki language key at runtime; only a small override map for ambiguous extensions.
- Sidebar: session labels slightly darker than folder labels for better visual hierarchy.
- Compaction: show abort button during compaction, correct end-of-compaction text (aborted/failed/success), position marker at chronological boundary instead of scroll-out-of-view top, and display "Compacted N times" at the bottom of reopened compacted sessions.

## [0.2.6] - 2026-05-26

### Changed

- Markdown links now use system accent color with improved underline styling for better visibility.

- Code syntax highlighting theme switched from `github-light` to `one-light`.
- Thinking block: tighter title-content spacing and increased background opacity for better visibility.
- Enable font smoothing (antialiased) for crisper text on macOS.
- Body font-weight now uses `--font-weight-normal` variable instead of hardcoded value.
- Thinking block: 13px medium title, 14px content with tighter line-height.
- Markdown headings resized (h1: 26px, h2: 19px, h3: 17px).
- Font weight scale aligned with standard values (400/500/600/700) for lighter text rendering.
- Light mode foreground color aligned with Codex (#1a1c1f) for less aggressive contrast.
- Settings popover and context menus now use frosted glass with 80% opacity instead of solid backgrounds.
- macOS sidebar now uses `menu` vibrancy with semi-transparent background for a more refined frosted glass appearance.

### Fixed

- Bash toolblock: fix "more" button position when timeout indicator is also present, now right-aligned below timeout instead of stranded mid-line after the command text.

## [0.2.5] - 2026-05-23

### Added

- Double-click session name in sidebar to rename it inline.

### Changed

- Projects group action button (+ icon) now only appears on hover, reducing visual clutter.

### Fixed

- Prevent duplicate empty sessions when quickly creating new chats in succession.

## [0.2.4] - 2026-05-23

### Changed

- Font weight scale adjusted: `font-normal` 350, `font-medium` 550, `font-semibold` 650, `font-bold` 750.

## [0.2.3] - 2026-05-23

### Changed

- Font weight adjusted for native macOS feel: baseline 350, UI controls use `font-normal` (350), dialog/sheet/popover/empty titles use `font-semibold` (600), markdown bold and tool block command titles use `font-medium` (500).
- Toast notifications repositioned to bottom-right with transparent borders.

## [0.2.2]

### Added

- Settings button in sidebar footer with frosted-glass popover containing Login and Settings items.
- `MenuItem` component and `.menu-content` CSS utility for reusable frosted-glass menu styling.
- Chat input textarea now auto-grows up to 35vh with scrollbar at max height.
- System accent color used for focus rings and sidebar highlights instead of gray.
- Centralized keyboard shortcut system with persistent keybinding store and customizable shortcuts.

### Changed

- Sidebar and main content divider refined to 0.5px hairline border for native-feel precision.
- Project right-click context menu uses frosted-glass styling matching the Settings popover.
- Unify empty-state branding: session-empty screen now shows "Welcome to pigi" instead of "No session open", matching the project-empty screen.
- Switch from Geist web font to system font stack for more native text rendering on each OS.
- Disable text selection on UI chrome (labels, buttons, headings); message content remains selectable.
- Dialog overlay backdrop lightened and auto-focus on open removed for more native dialog behavior.

## [0.2.1] - 2026-05-15

### Added

- Empty state screen when no session is active, replacing the chat input. First-time users see "Welcome to pigi" with a shortcut hint (Cmd+O) to open a project. Returning users see "No session open" with a prompt to select from the sidebar.
- Global Cmd+O keyboard shortcut to open a project directory.

### Changed

- Chat input, message list, and streaming queue are now hidden when no session is open.

## [0.2.0] - 2026-05-11

### Added

- App icon.

### Fixed

- Running sessions remain visible when a project is collapsed, even after they finish running. The collapsed view now snapshots running session IDs at collapse time and filters the session list to show only those sessions.

## [0.1.0] - 2026-05-10

### Added

- Initial release. Desktop GUI for pi with project management, session sidebar, and high-performance rendering.
