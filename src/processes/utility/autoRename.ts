/**
 * Auto-rename: generates a short session title using the cheapest available model.
 *
 * Strategy: try the cheapest models first (by cost). If 2 attempts fail,
 * fall back to the cheapest model from the session's own provider (known to work).
 *
 * Uses ModelRegistry (which knows custom providers + auth state) and pi-ai's
 * completeSimple for a single lightweight LLM call — no agent session, no tools,
 * no extensions loaded.
 */
import { completeSimple } from '@earendil-works/pi-ai';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const SYSTEM_PROMPT = `You are a session title generator. Given conversation messages, output a concise title (max 10 words). Only capitalize the first letter of the title. Output ONLY the title, no quotes, no explanation.`;

/** APIs that only work with tools / coding workflows — not suitable for simple text gen. */
const EXCLUDED_APIS = new Set(['openai-codex-responses']);

const MAX_GLOBAL_ATTEMPTS = 2;

/**
 * Get candidate models sorted by cost (cheapest first).
 * Models with non-zero cost come before zero-cost ones.
 */
function getCandidatesByCost(modelRegistry: ModelRegistry): Model<Api>[] {
  const available = modelRegistry.getAvailable();

  const candidates = available.filter((m) => {
    if (!m.input.includes('text')) return false;
    if (EXCLUDED_APIS.has(m.api)) return false;
    return true;
  });

  candidates.sort((a, b) => {
    const costA = a.cost.input + a.cost.output;
    const costB = b.cost.input + b.cost.output;
    const hasRealCostA = costA > 0 ? 0 : 1;
    const hasRealCostB = costB > 0 ? 0 : 1;
    if (hasRealCostA !== hasRealCostB) return hasRealCostA - hasRealCostB;
    return costA - costB;
  });

  return candidates;
}

/**
 * Get the cheapest model from the session's provider (known-good fallback).
 */
function getCheapestSameProvider(
  candidates: Model<Api>[],
  sessionProvider: string,
): Model<Api> | null {
  return candidates.find((m) => m.provider === sessionProvider) ?? null;
}

/**
 * Try to generate a title with a specific model. Returns the title or null on failure.
 */
async function tryGenerate(
  model: Model<Api>,
  conversationText: string,
  modelRegistry: ModelRegistry,
): Promise<string | null> {
  const resolved = await modelRegistry.getApiKeyAndHeaders(model);
  if (!resolved.ok) return null;

  try {
    const result = await completeSimple(
      model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: conversationText, timestamp: Date.now() }],
      },
      {
        apiKey: resolved.apiKey,
        headers: resolved.headers,
        maxTokens: 30,
        temperature: 0.3,
      },
    );

    if (result.stopReason === 'error') return null;

    const title = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, '');

    return title || null;
  } catch {
    return null;
  }
}

/**
 * Generate a session title from conversation messages.
 *
 * Tries cheapest models first (up to 2 attempts). If both fail, falls back to
 * the cheapest model from the session's own provider.
 */
export async function generateSessionTitle(
  messages: Message[],
  modelRegistry: ModelRegistry,
  sessionProvider?: string,
): Promise<string | null> {
  const candidates = getCandidatesByCost(modelRegistry);
  if (candidates.length === 0) return null;

  const conversationText = messages
    .slice(0, 4)
    .map((m) => `${m.role}: ${m.text.slice(0, 200)}`)
    .join('\n')
    .slice(0, 1000);

  // Try cheapest models in order (up to MAX_GLOBAL_ATTEMPTS)
  const tried = new Set<string>();
  let attempts = 0;
  for (const model of candidates) {
    if (attempts >= MAX_GLOBAL_ATTEMPTS) break;
    const key = model.provider + '/' + model.id;
    if (tried.has(key)) continue;
    tried.add(key);
    attempts++;

    const title = await tryGenerate(model, conversationText, modelRegistry);
    if (title) return title;
  }

  // Fallback: cheapest model from session's provider (known to work)
  if (sessionProvider) {
    const fallback = getCheapestSameProvider(candidates, sessionProvider);
    if (fallback && !tried.has(fallback.provider + '/' + fallback.id)) {
      return tryGenerate(fallback, conversationText, modelRegistry);
    }
  }

  return null;
}
