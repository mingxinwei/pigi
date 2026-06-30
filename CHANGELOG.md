# Changelog

## [Unreleased]

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
