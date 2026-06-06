# Session Switcher Plan

## Summary

Keyboard-driven session navigation using shadcn Command component.

- **Ctrl+R**: Open session switcher popup with search
- **Cmd+[**: Navigate to previous session in history
- **Cmd+]**: Navigate to next session in history

---

## Data Model — Navigation History

Two-stack model stored in zustand `appStore`:

```typescript
navigationBackStack: string[]     // sessionPaths ordered oldest → newest
navigationForwardStack: string[]  // sessionPaths ordered nearest → farthest
navigationCurrent: string | null  // active sessionPath
```

**Operations:**

| Action                                                          | Behavior                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Switch to session S (sidebar click, Ctrl+R select, new session) | Push current onto backStack, clear forwardStack, set current = S      |
| Cmd+[                                                           | Push current onto forwardStack, pop backStack → current, switch to it |
| Cmd+]                                                           | Push current onto backStack, pop forwardStack → current, switch to it |
| Duplicate switch (S → S)                                        | No-op, history unchanged                                              |
| Current session deleted                                         | Auto-switch to backStack top; if backStack empty, clear current       |

All stack operations are O(1).

---

## Session Switcher (Ctrl+R)

### Data Source

- `projectSessions` from `appStore`: `Record<string, PiSessionInfo[]>` (keyed by project cwd)
- Merged with currently running `sessions` that aren't yet in `projectSessions` (future: refresh is a separate concern)

### Sort Order

Combined list sorted as:

1. Sessions in `navigationBackStack` + `navigationCurrent` + `navigationForwardStack` (reversely ordered by position in history, most recent first)
2. Remaining sessions not in history, sorted by `modified` time descending

### List Item Layout

```
┌─────────────────────────────────────────────────────────┐
│ Session title (truncated ~50%)   project/name  HH:MM  │
└─────────────────────────────────────────────────────────┘
```

- Session title: `firstMessage`, truncated with ellipsis, ~50% width
- Project name: directory basename from `cwd`, grey (`text-muted-foreground`)
- Time: `modified` formatted as `HH:MM`, grey, right-aligned
- Active session: highlighted (bg-muted) and default-selected on open

### Search

- Library: `fuzzysort` (already in project, used in `slashCommands.ts`)
- Search fields: `firstMessage` + project name simultaneously
- Results: fuzzy-matched characters highlighted inline
- No results: show empty state text

### Empty / Edge Cases

| Case                                       | Behavior                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| No sessions at all (empty projectSessions) | Show `CommandEmpty` with text: "No sessions yet, create a session first."                  |
| Draft chat mode (no active session)        | Session switcher opens normally; no item highlighted (no active session to default-select) |
| Search has no matches                      | cmdk's built-in `CommandEmpty` handles this naturally (empty list)                         |

- Opens on Ctrl+R, closes on Escape or after selecting a session
- Pressing Enter selects the highlighted session and closes
- Arrow keys navigate the list (default cmdk behavior)
- All sessions from all projects shown (flat list), no grouping

---

## Component Structure

New component: `src/renderer/src/components/SessionSwitcher.tsx`

```
SessionSwitcher
├── Uses CommandDialog (existing shadcn wrapper)
│   ├── CommandInput (search input)
│   ├── CommandList
│   │   ├── CommandEmpty (no results / no sessions)
│   │   └── CommandGroup
│   │       └── CommandItem[] (each session)
└── Props:
    - projectSessions: Record<string, PiSessionInfo[]>
    - navigationBackStack / forwardStack / current
    - activeSessionPath
    - onSwitch: (sessionPath: string) => void
    - open / onOpenChange
```

Placed in `App.tsx` at the same level as `LoginDialog`.

---

## Shortcut Registration

Add three entries to `src/shared/shortcutDefaults.ts`:

```typescript
{ id: 'navigation.openSwitcher', label: 'Session switcher',  defaultBinding: { key: 'r', ctrl: true } },
{ id: 'navigation.prev',         label: 'Previous session',  defaultBinding: { key: '[', meta: true } },
{ id: 'navigation.next',         label: 'Next session',      defaultBinding: { key: ']', meta: true } },
```

Registered in `App.tsx` via `useKeyboardShortcuts`.

---

## Implementation Order

1. Add `navigationBackStack`, `navigationForwardStack`, `navigationCurrent` to `appStore` with actions
2. Add shortcut definitions to `SHORTCUT_DEFAULTS`
3. Wire navigation actions in `App.tsx` — hook into existing session switch flow
4. Create `SessionSwitcher.tsx` component
5. Wire Ctrl+R shortcut to open `SessionSwitcher`
6. Handle edge cases (delete, draft, empty)

---

## Out of Scope

- Refreshing `projectSessions` data (separate concern)
- Session list item actions (rename, delete) — Ctrl+R is selection only
- Cross-project navigation (stays within current project set)
