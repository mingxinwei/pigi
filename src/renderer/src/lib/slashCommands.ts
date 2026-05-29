import type { SkillSlashCommand } from '../../../shared/ipcContract';

export interface SlashCommand {
  name: string;
  description: string;
  source: 'builtin' | 'skill';
  hasArg?: boolean;
  argPlaceholder?: string;
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact session context', source: 'builtin' },
  { name: 'login', description: 'Configure provider authentication', source: 'builtin' },
  {
    name: 'logout',
    description: 'Remove stored credentials',
    source: 'builtin',
    hasArg: true,
    argPlaceholder: 'provider',
  },
  {
    name: 'name',
    description: 'Rename session',
    source: 'builtin',
    hasArg: true,
    argPlaceholder: 'new name',
  },
  { name: 'new', description: 'Start a new chat', source: 'builtin' },
];

function toSkillCommand(skill: SkillSlashCommand): SlashCommand {
  return {
    name: skill.name,
    description: skill.description,
    source: 'skill',
  };
}

export function getAllSlashCommands(skills: SkillSlashCommand[]): SlashCommand[] {
  return [...BUILTIN_COMMANDS, ...skills.map(toSkillCommand)];
}

/**
 * Filter commands matching partial input (for autocomplete).
 */
export function matchSlashCommands(
  input: string,
  allCommands: SlashCommand[],
): { builtin: SlashCommand[]; skill: SlashCommand[] } {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { builtin: [], skill: [] };

  const partial = trimmed.slice(1).toLowerCase();
  if (partial.includes(' ')) return { builtin: [], skill: [] }; // already typed arg, no autocomplete

  const matches = allCommands.filter((c) => {
    if (c.source === 'builtin') return c.name.startsWith(partial);
    return c.name.includes(partial);
  });
  return {
    builtin: matches.filter((c) => c.source === 'builtin'),
    skill: matches.filter((c) => c.source === 'skill'),
  };
}
