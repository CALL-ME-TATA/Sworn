// Rule-based stand-ins for the LLM steps, used when LLM=off (no API credit needed).
// The trust layer (discovery, trials, verification, failover, feedback) is identical in both modes.
import { normalize } from './sources.js';

const STOP = new Set(('a an the of in on at to for from by with and or is are was were be been it its this that these those ' +
  'what which who whom whose when where why how did does do has have had can could would should will about into than then ' +
  'there their they them as not no also such other more most many much some any each all one first year years').split(' '));

export const words = s => normalize(s).match(/[a-z0-9][a-z0-9'-]*/g)?.filter(w => !STOP.has(w) && w.length > 2) ?? [];
const numbers = s => String(s).match(/\d[\d,.]*\d|\d/g)?.map(n => n.replace(/,/g, '')) ?? [];

// Splits on " and <question word>": "What causes X and where has it happened?" ->
// ["What causes X?", "where has it happened? (X)"]. Later parts carry the first part's keywords so search keeps the subject.
// ponytail: keyword carry-over, not real coreference; an LLM plans better.
export function plan(question, max) {
  const parts = question.replace(/\?+$/, '').split(/\s+and\s+(?=(?:how|why|what|where|when|who|which)\b)/i).map(p => p.trim());
  const subject = words(parts[0]).filter(w => !/^(cause[sd]?|happen(ed|s)?|work[s]?|make[s]?|use[sd]?)$/.test(w)).join(' ');
  return parts.slice(0, max).map((p, i) => (i === 0 || !subject ? `${p}?` : `${p}? (${subject})`));
}

// A full stop after "e.g", "St" or an initial like "P" does not end a sentence.
const ABBREV = /(?:\b(?:e\.g|i\.e|etc|vs|approx|c|ca|Dr|Mr|Mrs|Ms|St|Jr|Sr|No|Fig|U\.S)|\b[A-Z])\.$/;

export function sentences(text) {
  const out = [];
  for (const para of text.split(/\n+/)) {
    let current = '';
    for (const piece of para.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)) {
      current = current ? `${current} ${piece}` : piece;
      if (!ABBREV.test(current)) {
        out.push(current.trim());
        current = '';
      }
    }
    if (current) out.push(current.trim());
  }
  return out.filter(s => s.length >= 40 && s.length <= 320 && /[.!?]["”)]?$/.test(s));
}

// Sentences that share the most content words with the question; each sentence is both claim and quote.
export function pickSentences(question, pages, count) {
  const q = new Set(words(question));
  const wantsNumber = /\b(when|what year|in what year|how many|how much|how long|how far|what temperature)\b/i.test(question);
  const scored = [];
  for (const [rank, p] of pages.entries()) {
    for (const [i, s] of sentences(p.text).entries()) {
      const overlap = new Set(words(s).filter(w => q.has(w))).size;
      const bonus = (wantsNumber && /\d/.test(s) ? 1 : 0) - rank * 0.5; // trust the top search hit more
      if (overlap) scored.push({ s, url: p.url, score: overlap + bonus - i * 0.001 }); // ties go to earlier sentences
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, count).map(x => ({ text: x.s, quote: x.s, source_url: x.url }));
}

// Supported only when the quote carries every number and every content word of the claim.
// Strict on purpose: one swapped word ("smallest" for "largest") flips a claim, and rule-mode claims are their quotes.
export function supports(claim, quote) {
  const q = normalize(quote);
  if (numbers(claim).some(n => !q.includes(n))) return { supported: false, reason: 'a number in the claim is not in the quote' };
  const quoteWords = new Set(words(quote));
  const missing = words(claim).filter(x => !quoteWords.has(x));
  return missing.length
    ? { supported: false, reason: `not in the quote: ${missing.join(', ')}` }
    : { supported: true, reason: 'every key word and number is in the quote' };
}

export function write(claims) {
  return claims.slice(0, 6).map(c => `${c.text.replace(/\s*[.!?]+$/, '')}. [${c.id}]`).join(' ');
}
