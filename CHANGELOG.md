# Changelog

## [Unreleased]

### Added

- Pressing the up arrow in the chat input now recalls your previous messages, one by one back through the whole conversation; the down arrow walks forward again. If you had started typing something, it is remembered and comes back when you press down — so nothing you wrote is lost.

### Fixed

- In the sidebar, collapsing a project's chat list with "Show less" now sticks: the list no longer flickers and springs back open when the selected chat is one of the hidden older chats.
- Clicking a chat in the sidebar no longer makes the list refresh or jump: resuming a chat leaves the list untouched, and the scroll-to-center behavior now applies only to selections made outside the list (session switcher, navigation history), not to your own clicks.

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
