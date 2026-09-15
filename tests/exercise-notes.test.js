import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseDisplayImageUrl, formatExerciseDetails, paginateNotes } from '../shared/exercise-notes.js';

const linkedGif = '[![](https://www.docteur-fitness.com/wp-content/uploads/2021/12/oiseau-assis-sur-banc.gif)](https://www.youtube.com/watch?v=9BfxdGmekv4)';

test('exercise details label each source and preserve authored lines', () => {
  assert.equal(formatExerciseDetails({ historyNotes: 'Past sessions\nYesterday: good', notes: 'Today\nGo easy', exerciseNotes: 'Brace', description: 'Three rounds' }),
    '## Recent sessions\nYesterday: good\n\n## This session\nToday\nGo easy\n\n## Exercise\nBrace\n\n## Program\nThree rounds');
});

test('details omit empty sources and prefer Exercise for duplicate live notes', () => {
  assert.equal(formatExerciseDetails({ notes: ' Brace ', exerciseNotes: 'Brace', description: ' ' }), '## Exercise\nBrace');
  assert.equal(formatExerciseDetails({ historyNotes: 'Past sessions\n' }), null);
  assert.equal(formatExerciseDetails(null), null);
});

test('pagination preserves explicit lines, bullets and blank paragraphs', () => {
  assert.deepEqual(paginateNotes('**Brace**\n- Feet flat\n\n[Slow](https://example.com)'), ['Brace\n- Feet flat\n\nSlow']);
  assert.deepEqual(paginateNotes(''), ['No notes for this exercise.']);
});

test('linked Markdown images become the display image without leaving markup in notes', () => {
  const details = `${linkedGif}\nKeep the chest against the bench.`;
  assert.equal(exerciseDisplayImageUrl(details, '/externalimages/exercises/single/small/fallback.png'),
    'https://www.docteur-fitness.com/wp-content/uploads/2021/12/oiseau-assis-sur-banc.gif');
  assert.deepEqual(paginateNotes(details), ['Keep the chest against\nthe bench.']);
  assert.equal(exerciseDisplayImageUrl('No image', '/externalimages/exercises/single/small/fallback.png'),
    'https://www.liftosaur.com/externalimages/exercises/single/small/fallback.png');
});

test('sections start fresh pages and repeat their heading on continuations', () => {
  const pages = paginateNotes('## Exercise\n' + 'Keep steady. '.repeat(18) + '\n\n## Program\nThree rounds');
  assert.equal(pages.at(-1), 'Program\nThree rounds');
  assert.ok(pages.slice(0, -1).every((page) => page.startsWith('Exercise\n')));
  assert.equal(pages.slice(0, -1).map((page) => page.slice(9)).join(' ').replace(/\s+/g, ' ').trim(), 'Keep steady. '.repeat(18).trim());
});

test('pagination respects character and visual line budgets without losing text', () => {
  const text = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n' + 'x'.repeat(115);
  const pages = paginateNotes(text, 70, 5, 23);
  for (const page of pages) {
    assert.ok(page.length <= 70);
    assert.ok(page.split('\n').length <= 5);
    assert.ok(page.split('\n').every((line) => line.length <= 23));
  }
  assert.equal(pages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('oversized authored headings paginate without crashing or dropping text', () => {
  const title = 'Long exercise instruction '.repeat(5).trim();
  const details = formatExerciseDetails({ notes: `## ${title}\nKeep elbows tucked` });
  const pages = paginateNotes(details);
  assert.equal(pages.join('').replace(/\s/g, ''), `${title}Keep elbows tucked`.replace(/\s/g, ''));
  for (const page of pages) {
    assert.ok(page.length <= 90);
    assert.ok(page.split('\n').length <= 6);
    assert.ok(page.split('\n').every(line => line.length <= 23));
  }
  assert.equal(paginateNotes(`## ${title}`).join('').replace(/\s/g, ''), title.replace(/\s/g, ''));
});
