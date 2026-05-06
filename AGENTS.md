# Development Rules

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Code Quality

- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- use context7 when you need the doc of third-party libraries, like react, electron, etc.

## Naming Conventions

- All source file names use camelCase (e.g. `piAgent.ts`, `appStore.ts`, `ipcChannels.ts`)
- IPC channel names use snake_case with `pi:` prefix, defined in `src/shared/ipcChannels.ts` (no magic strings)
- No magic strings anywhere in the codebase; use constants, enums, or registries. If a magic string seems unavoidable, ask the user first.

## Workflow

- Do NOT commit automatically after changes; wait for explicit commit instruction
