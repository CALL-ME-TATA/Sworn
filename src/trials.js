// Trial pool per role and the code that grades each answer. No LLM grading: a trial is a known-answer test.
import { sourceText, wikiText, wikiUrl, normalize, quoteIn } from './sources.js';

const RETRIEVER_TRIALS = [
  { q: 'In what year was the Eiffel Tower completed?', expect: '1889' },
  { q: 'What is the chemical symbol for gold?', expect: 'Au' },
  { q: 'How many bones are in the adult human body?', expect: '206' },
  { q: 'At what temperature in Celsius does water boil at sea level?', expect: '100' },
  { q: 'Who wrote the novel Pride and Prejudice?', expect: 'Austen' },
  { q: 'What is the national capital of Australia?', expect: 'Canberra' },
  { q: 'In what year did Apollo 11 land on the Moon?', expect: '1969' },
  { q: 'Who painted the Mona Lisa?', expect: 'Leonardo' },
  { q: 'Who developed the theory of general relativity?', expect: 'Einstein' },
  { q: 'What is the longest river in Africa?', expect: 'Nile' },
];

// The true claim is the page's own first sentence, fetched live, so the trial never goes stale.
const VERIFIER_TRIALS = [
  { title: 'Eiffel Tower', falseClaim: 'The Eiffel Tower is a stone bridge in Berlin.' },
  { title: 'Jupiter', falseClaim: 'Jupiter is the smallest planet in the Solar System.' },
  { title: 'Nile', falseClaim: 'The Nile is a mountain range in South America.' },
  { title: 'Canberra', falseClaim: 'Canberra is the largest city in Brazil.' },
  { title: 'Penicillin', falseClaim: 'Penicillin is a type of volcanic rock.' },
];

const WRITER_TRIALS = [
  { question: 'What is Mount Everest?', claims: [
    { id: 'c1', text: 'Mount Everest is the highest mountain above sea level.' },
    { id: 'c2', text: 'Mount Everest is in the Himalayas.' },
    { id: 'c3', text: 'Mount Everest lies on the border of Nepal and China.' },
  ] },
  { question: 'What is the Pacific Ocean?', claims: [
    { id: 'c1', text: 'The Pacific Ocean is the largest ocean on Earth.' },
    { id: 'c2', text: 'The Pacific lies between Asia and Australia and the Americas.' },
  ] },
];

const pick = list => list[Math.floor(Math.random() * list.length)];
const firstSentence = text => (text.match(/^[\s\S]*?[.!?](\s|$)/)?.[0] ?? text.slice(0, 200)).trim();

// Returns { input, grade(output) -> Promise<{ pass, reason }> } for one random trial.
export async function makeTrial(role) {
  if (role === 'retriever') {
    const t = pick(RETRIEVER_TRIALS);
    return { input: { sub_question: t.q }, grade: out => gradeRetriever(t, out, sourceText) };
  }
  if (role === 'verifier') {
    const t = pick(VERIFIER_TRIALS);
    const quote = firstSentence(await wikiText(t.title));
    const cases = [
      { claim: quote, expect: 'supported' },
      { claim: t.falseClaim, expect: 'unsupported' },
    ].map(c => ({ ...c, input: { claim: c.claim, source_url: wikiUrl(t.title), quote } }));
    return { inputs: cases.map(c => c.input), grade: outs => gradeVerifier(cases, outs) };
  }
  const t = pick(WRITER_TRIALS);
  return { input: t, grade: out => gradeWriter(t, out) };
}

export async function gradeRetriever(trial, output, fetchText) {
  const claims = output?.claims;
  if (!Array.isArray(claims) || !claims.length) return { pass: false, reason: 'no claims returned' };
  const hits = claims.filter(c => normalize(`${c.text} ${c.quote}`).includes(normalize(trial.expect)));
  if (!hits.length) return { pass: false, reason: `wrong answer (expected ${trial.expect})` };
  for (const c of hits) {
    const text = await fetchText(c.source_url).catch(() => '');
    if (quoteIn(text, c.quote)) return { pass: true };
  }
  return { pass: false, reason: 'quote not found on its source page' };
}

export function gradeVerifier(cases, outputs) {
  for (let i = 0; i < cases.length; i++) {
    const verdict = outputs[i]?.verdict;
    if (verdict !== cases[i].expect) return { pass: false, reason: `said ${verdict ?? 'nothing'} for a ${cases[i].expect} claim` };
  }
  return { pass: true };
}

export function gradeWriter(trial, output) {
  const answer = output?.answer;
  if (typeof answer !== 'string' || !answer.trim()) return { pass: false, reason: 'empty answer' };
  const cited = [...answer.matchAll(/\[(c\d+)\]/g)].map(m => m[1]);
  if (!cited.length) return { pass: false, reason: 'no citations' };
  const allowed = trial.claims.map(c => c.id);
  const bad = cited.find(id => !allowed.includes(id));
  return bad ? { pass: false, reason: `cited unknown claim ${bad}` } : { pass: true };
}
