export interface ParsedSkillBlock {
  name: string;
  body: string;
  userMessage: string | undefined;
}

const SKILL_BLOCK_PATTERN =
  /^<skill name="([^"]+)" location="[^"]+">\r?\n([\s\S]*?)\r?\n<\/skill>(?:\r?\n\r?\n([\s\S]+))?$/;

export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(SKILL_BLOCK_PATTERN);
  if (!match) return null;
  return {
    name: match[1],
    body: match[2],
    userMessage: match[3] || undefined,
  };
}
