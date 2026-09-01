import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSportDataResult } from '../shared/workout-extension-metrics.js';

test('parses duration and calories from defensive sport data responses', () => {
  assert.deepEqual(
    parseSportDataResult({ code: 0, data: '[{"duration":"1:15:15"}]' }, 'duration'),
    { ok: true, value: '1:15:15', error: null },
  );
  assert.deepEqual(
    parseSportDataResult({ code: 0, data: '[{"calories":"120"}]' }, 'calories'),
    { ok: true, value: '120', error: null },
  );
  assert.equal(parseSportDataResult({ code: 1, data: '[]' }, 'duration').ok, false);
  assert.equal(parseSportDataResult({ code: 0, data: 'invalid' }, 'duration').ok, false);
  assert.equal(parseSportDataResult({ code: 0, data: '[]' }, 'duration').ok, false);
});
