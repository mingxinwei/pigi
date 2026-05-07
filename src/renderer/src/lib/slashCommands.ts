export interface SlashCommand {
  name: string
  description: string
  hasArg?: boolean
  argPlaceholder?: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact session context' },
  { name: 'model', description: 'Cycle to next model' },
  { name: 'thinking', description: 'Cycle thinking level' },
  { name: 'name', description: 'Rename session', hasArg: true, argPlaceholder: 'new name' },
  { name: 'new', description: 'Start a new chat' },
  { name: 'clear', description: 'Start a new chat' },
]

/**
 * Parse a slash command from input text.
 * Returns the command and argument if valid, null otherwise.
 */
export function parseSlashCommand(
  input: string,
): { command: SlashCommand; arg: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const spaceIdx = trimmed.indexOf(' ')
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)
  const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()

  const command = SLASH_COMMANDS.find((c) => c.name === name)
  if (!command) return null

  return { command, arg }
}

/**
 * Filter commands matching partial input (for autocomplete).
 */
export function matchSlashCommands(input: string): SlashCommand[] {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return []

  const partial = trimmed.slice(1).toLowerCase()
  if (partial.includes(' ')) return [] // already typed arg, no autocomplete

  return SLASH_COMMANDS.filter((c) => c.name.startsWith(partial))
}
