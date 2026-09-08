import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingLabel } from '../shared/recording-status.js';
test('recording label follows acknowledged writes, including restored pending writes', () => {
 assert.equal(recordingLabel({mode:'DIRECT',startConfirmed:true,acknowledgedSetCount:1},0), '');
 assert.equal(recordingLabel({mode:'DIRECT',startConfirmed:true,acknowledgedSetCount:0},1), 'On watch');
 assert.equal(recordingLabel({mode:'DIRECT',startConfirmed:true,acknowledgedSetCount:1},1), 'Synced');
 for (const flag of ['conflict','remoteMissing']) assert.equal(recordingLabel({mode:'DIRECT',startConfirmed:true,acknowledgedSetCount:1,[flag]:true},1), 'On watch');
 assert.equal(recordingLabel({mode:'LEGACY'},1), 'On watch');
 assert.equal(recordingLabel({mode:'DIRECT',acknowledgedSetCount:1},1), 'On watch');
});
