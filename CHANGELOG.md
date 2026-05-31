# Changelog

## [Unreleased]

### Fixed

- System accent color now correctly reads via `systemPreferences.getAccentColor()` (was using invalid `getColor('accent')` which always failed).

### Changed

- Slash command popover: hover now updates selection, selected item uses solid accent background with white text.
- Slash command popover background opacity adjusted to 50%.
- Working indicator star color changed from green to pink (#E86F8F), star-text gap reduced.
- Global overlay background opacity adjusted from 90% to 88%.
- New sessions now inherit the last-used model and thinking level from the previous session.
- Model settings picker scrolls to selected item on open, and divider refined.

### Added

- Slash command autocomplete now shows available skills alongside builtin commands, with fuzzy search (fuzzysort) for both builtin and skill names.
- Skill blocks in chat are rendered as compact inline links with a popover to view full skill content.
- Global link styling: system accent color, no underline.

### Changed

- Icon sizing and spacing unified across all sidebar, popover, and context menu items (16px icons, 6px gaps).
- Global tabler icon stroke-width set to 1.25 via base CSS layer.
- Context menu updated to latest shadcn style with `OVERLAY_CONTENT` shared styles; project and session right-click menus now use `ContextMenuItem`.
- Write tool block preview simplified: removed internal truncation and expand button, relies on outer show-more/less mask.
- DiffView borders removed for cleaner look.
- Tool block footer (took/elapsed) spacing tightened.
- Error messages in assistant bubbles now fit content width instead of full width.
- Sidebar-main divider border opacity adjusted to 27%.
- Chat input focus ring removed; border stays inherited on focus.
- Thinking block background opacity increased to 70%.
- Overlay panel ring opacity increased to 25% for more visible borders.
- Tool block borders adjusted to 1px with 65% opacity.

### Added

- Write tool last trailing newline stripped to avoid rendering empty line.

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
