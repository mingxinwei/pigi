# Changelog

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

## [Unreleased]

### Added

### Changed

- Font weight adjusted for native macOS feel: baseline 350, UI controls use `font-normal` (350), dialog/sheet/popover/empty titles use `font-semibold` (600), markdown bold and tool block command titles use `font-medium` (500).
- Toast notifications repositioned to bottom-right with transparent borders.

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
