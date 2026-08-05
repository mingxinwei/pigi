import type { ModelInfo, ThinkingLevel } from './ipcContract';

const EXTENDED_THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

/**
 * Convert an SDK model descriptor into the wire ModelInfo shape, deriving the
 * picker-visible thinking levels from the model's thinkingLevelMap. Shared by
 * the pi-agent session process and the session worker (model catalog).
 */
export function toModelInfo(model: {
  name: string;
  provider: string;
  id: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, unknown | null>;
}): ModelInfo {
  const thinkingLevels: ThinkingLevel[] = model.reasoning
    ? EXTENDED_THINKING_LEVELS.filter((level) => {
        const mapped = model.thinkingLevelMap?.[level];
        if (mapped === null) return false;
        if (level === 'xhigh') return mapped !== undefined;
        return true;
      })
    : ['off'];
  return {
    name: model.name,
    provider: model.provider,
    id: model.id,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    thinkingLevels,
  };
}
