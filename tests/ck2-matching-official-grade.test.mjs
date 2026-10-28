import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/activities/MatchingConnectTask.jsx', import.meta.url), 'utf8');

test('matching-connect must verify official server grade before completion', () => {
  const responseIndex = source.indexOf('const saved = await response.json();');
  const gradeIndex = source.indexOf("saved?.result?.isCorrect !== true || saved?.result?.status !== 'correct'");
  const correctIndex = source.indexOf("setResult('correct');", gradeIndex);
  const completionIndex = source.indexOf('onTaskCompleted(completionPayload);', gradeIndex);

  assert.ok(responseIndex >= 0 && gradeIndex > responseIndex);
  assert.ok(correctIndex > gradeIndex);
  assert.ok(completionIndex > correctIndex);
  assert.ok(source.includes("setResult(\n          saved?.result?.status === 'missing_answer_key'"));
  assert.ok(source.includes("return;\n      }\n\n      setResult('correct');"));
});

test('a failed official grade cannot be mistaken for an HTTP save failure', () => {
  assert.ok(source.includes("'grading-mismatch'"));
  assert.ok(source.includes('Answer saved, but the server marked it incorrect.'));
  assert.ok(source.includes("'missing-answer-key'"));
  assert.ok(source.includes('If the latest official attempt was rejected'));
});

test('old incorrect local result=correct is not trusted after a reload', () => {
  assert.ok(source.includes("return saved?.result === 'correct' ? null : (saved?.result || null);"));
});

test('CK2 matching-connect uses authenticated request and preserves selected pairs', () => {
  assert.ok(source.includes('buildAuthenticatedActivityAttempt({'));
  assert.ok(source.includes("answer: { connections, pairs: connections }"));
  assert.ok(source.includes("Authorization") || source.includes('headers,'));
});
