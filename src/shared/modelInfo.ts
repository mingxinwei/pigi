import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai';
import type { ModelInfo } from './ipcContract';

/**
 * Convert an SDK model descriptor into the wire ModelInfo shape. Thinking
 * levels come from the SDK's canonical getSupportedThinkingLevels (which knows
 * about xhigh/max and the thinkingLevelMap), shared by the pi-agent session
 * process and the session worker (model catalog).
 */
export function toModelInfo(model: Model<Api>): ModelInfo {
  return {
    name: model.name,
    provider: model.provider,
    id: model.id,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    thinkingLevels: getSupportedThinkingLevels(model),
  };
}
