// Grading and quote matching are the trust gate, so they get a check. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeRetriever, gradeVerifier, gradeWriter } from '../src/trials.js';
import { quoteIn, htmlToText } from '../src/sources.js';
import { citedIds } from '../src/orchestrator.js';
import { supports, pickSentences, plan, sentences } from '../src/rules.js';

test('sentences do not break at abbreviations or initials', () => {
  const text = 'Some ideas (e.g. homeopathy, vitalism) are incompatible with how vaccines work. Fleming found a crude extract of P. rubens in 1928 at St. Mary\'s Hospital.';
  assert.deepEqual(sentences(text), [
    'Some ideas (e.g. homeopathy, vitalism) are incompatible with how vaccines work.',
    'Fleming found a crude extract of P. rubens in 1928 at St. Mary\'s Hospital.',
  ]);
});

test('rule verifier rejects claims the quote does not carry', () => {
  const quote = 'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France.';
  assert.equal(supports(quote, quote).supported, true);
  assert.equal(supports('The Eiffel Tower is a stone bridge in Berlin.', quote).supported, false);
  assert.equal(supports('The Eiffel Tower was built in 1999.', quote).supported, false);
  const jupiter = 'Jupiter is the fifth planet from the Sun, and the largest in the Solar System.';
  assert.equal(supports('Jupiter is the smallest planet in the Solar System.', jupiter).supported, false);
});

test('rule retriever prefers sentences with numbers for when/what-year questions', () => {
  const text = 'The Eiffel Tower is a famous lattice tower in Paris, France, and a global icon. Construction of the tower was completed in 1889 for the Exposition.';
  const [first] = pickSentences('In what year was the Eiffel Tower completed?', [{ url: 'u', text }], 1);
  assert.match(first.text, /1889/);
  assert.deepEqual(plan('What causes coral bleaching and where has it happened?', 3), ['What causes coral bleaching?', 'where has it happened? (coral bleaching)']);
  assert.deepEqual(plan('How do vaccines work?', 3), ['How do vaccines work?']);
});

test('page text is article prose only, even when attributes contain ">"', () => {
  const html = `<table class="infobox"><tr><td>Coral bleachingPhenomenon</td></tr></table>
    <p data-mw='{"name":{"wt":"A <br /> B"}}'>Corals turn <b>white</b> when stressed.<sup class="mw-ref reference"><a>[1]</a></sup></p>
    <figure><figcaption>Bleached coral</figcaption></figure><p>Warm water &amp; light cause it.</p>`;
  assert.equal(htmlToText(html), 'Corals turn white when stressed.\nWarm water & light cause it.');
});

const page = 'The tower was completed in 1889 as the entrance to the World’s Fair.';
const fetchText = async () => page;
const trial = { expect: '1889' };

test('quoteIn ignores case, spacing and curly quotes, and rejects short or missing quotes', () => {
  assert.ok(quoteIn(page, "the tower was  completed in 1889 as the entrance to the World's Fair"));
  assert.ok(!quoteIn(page, 'in 1889'));
  assert.ok(!quoteIn(page, 'The tower was completed in 1890.'));
  assert.ok(!quoteIn(page, undefined));
});

test('retriever passes only with the right answer and a real quote', async () => {
  const good = { claims: [{ text: 'Completed in 1889', source_url: 'x', quote: 'The tower was completed in 1889' }] };
  const wrong = { claims: [{ text: 'Completed in 1890', source_url: 'x', quote: 'The tower was completed in 1890' }] };
  const fake = { claims: [{ text: 'Completed in 1889', source_url: 'x', quote: 'Everyone agrees it was finished in 1889.' }] };
  assert.equal((await gradeRetriever(trial, good, fetchText)).pass, true);
  assert.equal((await gradeRetriever(trial, wrong, fetchText)).pass, false);
  assert.equal((await gradeRetriever(trial, fake, fetchText)).pass, false);
  assert.equal((await gradeRetriever(trial, { claims: [] }, fetchText)).pass, false);
  assert.equal((await gradeRetriever(trial, null, fetchText)).pass, false);
});

test('verifier must get both the true and the false claim right', () => {
  const cases = [{ expect: 'supported' }, { expect: 'unsupported' }];
  assert.equal(gradeVerifier(cases, [{ verdict: 'supported' }, { verdict: 'unsupported' }]).pass, true);
  assert.equal(gradeVerifier(cases, [{ verdict: 'supported' }, { verdict: 'supported' }]).pass, false);
  assert.equal(gradeVerifier(cases, [{ verdict: 'supported' }]).pass, false);
});

test('writer must cite, and only known claims', () => {
  const t = { claims: [{ id: 'c1' }, { id: 'c2' }] };
  assert.equal(gradeWriter(t, { answer: 'A [c1]. B [c2].' }).pass, true);
  assert.equal(gradeWriter(t, { answer: 'A [c1]. B [c9].' }).pass, false);
  assert.equal(gradeWriter(t, { answer: 'No citations here.' }).pass, false);
  assert.deepEqual(citedIds('x [c1] y [c12]'), ['c1', 'c12']);
});
