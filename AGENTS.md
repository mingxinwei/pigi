# Development Rules

For DeepSeek model: do not overthink, think less and act more.

## Workflow

- Do NOT commit automatically after changes; wait for explicit commit instruction. Commit and release workflow is in `pigi-release` skill.
- Never use `sed` for code edits; always use `read` + `edit` tools so you understand the semantic context around the change
- Never use `sed`/`cat`/`head`/`tail` to read files; use the `read` tool (supports offset/limit for specific lines)
- Run `npm run check` after any significant code change to catch type errors, lint issues, and formatting problems before committing. Read the full output — do not pipe through `rg` or `grep`.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Code Quality

- **NEVER add eslint-disable comments** — restructure code to satisfy lint rules instead. The only exception is when there is a genuine false positive with no architectural workaround, and must be approved by the user first.
- No `any` types unless absolutely necessary
- No `as` type assertions unless absolutely necessary (use type guards, typed variables, or discriminated unions). When `as` is unavoidable (e.g. untyped SDK data, TS `Array.includes` limitation, `React.CSSProperties` for custom CSS vars), add a comment explaining why.
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Always look up official documentation (via context7) before using any third-party library API and knowledge. Do not rely on training data for API signatures, options, or behavior.

## Naming Conventions

- All source file names use camelCase (e.g. `piAgent.ts`, `appStore.ts`, `ipcChannels.ts`)
- No abbreviated variable/function names — use full descriptive names for readability (e.g. `message` not `msg`, `command` not `cmd`, `callback` not `cb`, `sessionPort` not `sp`, `index` not `idx`). Common terms like `id`, `url`, `api` are fine.
- IPC channel names use snake_case with `pi:` prefix, defined in `src/shared/ipcChannels.ts` (no magic strings)
- No magic strings anywhere in the codebase; use constants, enums, or registries. If a magic string seems unavoidable, ask the user first.
