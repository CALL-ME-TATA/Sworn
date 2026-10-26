// One function: ask(prompt, { json }) -> model reply. Used by our agents and the planner.
import Anthropic from '@anthropic-ai/sdk';
import { CONFIG } from './config.js';

const client = new Anthropic();

export async function ask(prompt, { json = false, system } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await client.beta.messages.create({
      model: CONFIG.MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // a safety decline is retried on a fallback model in the same call
      output_config: { effort: 'low' }, // short, well-specified tasks
      ...(system && { system }),
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') throw new Error('model declined the request');
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!json) return text;
    try {
      return parseJson(text);
    } catch (err) {
      if (attempt >= 2) throw new Error(`model did not return JSON: ${err.message}`);
    }
  }
}

export function parseJson(text) {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return JSON.parse(text.slice(start, end + 1));
}
