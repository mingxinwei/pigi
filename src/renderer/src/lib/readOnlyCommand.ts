/**
 * Determines whether a bash command is read-only (does not mutate the filesystem or system state).
 *
 * Currently uses a simple prefix-based heuristic. This can be extended to a more sophisticated
 * model-based approach in the future.
 */

const READ_ONLY_COMMAND_PREFIXES = [
  'cat ',
  'head ',
  'tail ',
  'less ',
  'more ',
  'grep ',
  'rg ',
  'rg\n',
  'ag ',
  'ack ',
  'find ',
  'fd ',
  'ls ',
  'ls\n',
  'tree ',
  'tree\n',
  'wc ',
  'diff ',
  'file ',
  'stat ',
  'du ',
  'df ',
  'which ',
  'where ',
  'type ',
  'echo ',
  'printf ',
  'pwd',
  'env',
  'printenv',
  'whoami',
  'hostname',
  'date',
  'uname',
  'id ',
  'id\n',
  'realpath ',
  'dirname ',
  'basename ',
  'readlink ',
  'test ',
  'jq ',
  'yq ',
  'xmllint ',
  'sha256sum ',
  'md5sum ',
  'shasum ',
];

/** Commands that are read-only when they appear as the entire command (no arguments needed) */
const READ_ONLY_EXACT_COMMANDS = new Set([
  'cd',
  'ls',
  'tree',
  'pwd',
  'env',
  'printenv',
  'whoami',
  'hostname',
  'date',
  'uname',
  'id',
  'rg',
]);

export function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trimStart();

  // Handle `cd /path && actual_command` patterns — evaluate the last command in the chain
  const effectiveCommand = extractEffectiveCommand(trimmed);

  if (READ_ONLY_EXACT_COMMANDS.has(effectiveCommand)) {
    return true;
  }

  for (const prefix of READ_ONLY_COMMAND_PREFIXES) {
    if (effectiveCommand.startsWith(prefix)) {
      if (hasMutatingPipe(effectiveCommand)) {
        return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Extracts the effective command from chains like `cd /path && rg foo`.
 * If the command starts with `cd ... &&`, we skip the cd and evaluate the rest.
 * Also handles pipes — checks the last segment for read-only-ness of the pipeline end.
 */
function extractEffectiveCommand(command: string): string {
  let effective = command;

  // Strip leading `cd ... &&` segments (can be chained)
  while (/^cd\s+\S+/.test(effective)) {
    const andIndex = effective.indexOf('&&');
    if (andIndex === -1) {
      // `cd` alone is read-only
      return 'cd';
    }
    effective = effective.slice(andIndex + 2).trimStart();
  }

  return effective;
}

/**
 * Simple check for pipes to obviously mutating commands.
 * This is conservative — if unsure, we assume it's not read-only.
 */
function hasMutatingPipe(command: string): boolean {
  const pipeSegments = command.split('|').slice(1);
  const mutatingCommands = ['tee ', 'xargs rm', 'xargs mv', 'dd ', 'sh ', 'bash '];

  for (const segment of pipeSegments) {
    const trimmedSegment = segment.trimStart();
    for (const mutating of mutatingCommands) {
      if (trimmedSegment.startsWith(mutating)) {
        return true;
      }
    }
  }
  return false;
}
