export const PIGI_NPM_COMMAND_ENV = 'PIGI_NPM_COMMAND_JSON';

export type NpmCommand = string[];

function isNpmCommand(value: unknown): value is NpmCommand {
  return (
    Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')
  );
}

export function parseNpmCommand(value: string | undefined): NpmCommand | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isNpmCommand(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
