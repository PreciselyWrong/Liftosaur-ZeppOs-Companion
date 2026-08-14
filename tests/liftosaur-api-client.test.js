import test from 'node:test';
import assert from 'node:assert/strict';

import { createLiftosaurApiClient, redactSecret } from '../app-side/liftosaur-api-client.js';

test('redactSecret masks apiKey and Authorization headers reliably', () => {
  assert.equal(redactSecret('lftsk_1234567890abcdef'), 'lftsk_***cdef');
  assert.equal(redactSecret('Bearer lftsk_1234567890abcdef'), 'Bearer lftsk_***cdef');
  assert.equal(redactSecret('short'), '***');
  assert.equal(redactSecret(null), '<empty>');
});

test('client handles fetching current program with redacted logging', async () => {
  const mockFetcher = async (url, options) => {
    assert.equal(url, 'https://www.liftosaur.com/api/program');
    assert.equal(options.headers['Authorization'], 'Bearer lftsk_secret_12345');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'prog-1',
        name: 'GZCLP 4-Day',
        routine: 'Basic Beginner Routine',
        currentDayIndex: 0,
        days: [
          {
            name: 'Day 1 - Squat T1',
            text: 'Squat / 5x3+ @ 100kg / rest 180s\nBench Press / 3x10 @ 60kg / rest 90s',
          },
        ],
      }),
    };
  };

  const client = createLiftosaurApiClient({
    apiKey: 'lftsk_secret_12345',
    fetcher: mockFetcher,
  });

  const program = await client.getCurrentProgram();
  assert.equal(program.name, 'GZCLP 4-Day');
  assert.equal(program.days.length, 1);
});

test('client throws structured redacted error on HTTP failure without leaking secret', async () => {
  const mockFetcher = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'Invalid API key lftsk_secret_12345',
  });

  const client = createLiftosaurApiClient({
    apiKey: 'lftsk_secret_12345',
    fetcher: mockFetcher,
  });

  await assert.rejects(
    async () => {
      await client.getCurrentProgram();
    },
    (err) => {
      assert.equal(err.name, 'LiftosaurApiError');
      assert.equal(err.status, 401);
      assert.ok(!err.message.includes('lftsk_secret_12345'));
      return true;
    }
  );
});
