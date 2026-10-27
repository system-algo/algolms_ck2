import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAuthenticatedActivityAttempt } from '../src/lib/ck2BackendAttempt.js';

const steps = ['step-1', 'step-2', 'step-3', 'step-4'];
const props = {
  studentEmail: 'CK2.TEST.STU@algo.edu.vn',
  accessToken: 'header.payload.signature',
  courseId: 'CK', // CK is the asset catalog, not CK2 enrollment.
  lessonId: 'CK_M3L1',
  pageId: 'CK-M3L1_1',
  taskId: 'task-15-1lve2lr',
  activityType: 'sequence-order-task',
  answer: { itemOrder: steps, order: steps },
  extra: { isCorrect: true, score: 1, maxScore: 1 },
};

test('CK2 sequence attempt preserves order and authenticates as enrolled CK2 student', () => {
  const { headers, payload } = buildAuthenticatedActivityAttempt(props);
  assert.equal(headers.Authorization, 'Bearer header.payload.signature');
  assert.equal(payload.courseId, 'CK2');
  assert.equal(payload.userId, 'ck2.test.stu@algo.edu.vn');
  assert.equal(payload.sessionId, 'user:ck2.test.stu@algo.edu.vn');
  assert.equal(payload.lessonId, 'CK_M3L1');
  assert.equal(payload.pageId, 'CK-M3L1_1');
  assert.equal(payload.taskId, 'task-15-1lve2lr');
  assert.deepEqual(payload.answer.itemOrder, steps);
  assert.deepEqual(payload.answer.order, steps);
});

test('forged course and session in extra payload cannot bypass CK2 scope', () => {
  const { payload } = buildAuthenticatedActivityAttempt({
    ...props,
    extra: { courseId: 'CK', userId: 'someone-else', sessionId: 'session-default' },
  });
  assert.equal(payload.courseId, 'CK2');
  assert.equal(payload.userId, 'ck2.test.stu@algo.edu.vn');
  assert.equal(payload.sessionId, 'user:ck2.test.stu@algo.edu.vn');
});

test('sequence does not mark completion before backend success and grading', () => {
  const source = readFileSync(new URL('../src/activities/SequenceOrderTask.jsx', import.meta.url), 'utf8');
  const saver = source.slice(source.indexOf('async function saveAndMarkCompleted('));
  const verifyIndex = source.indexOf("if (saved?.result?.isCorrect !== true)");
  const remoteSaveIndex = saver.indexOf('await submitAttemptToBackend(submittedOrder);');
  const completionIndex = saver.indexOf('triggerSuccess(submittedOrder);');
  assert.ok(verifyIndex > 0, 'must verify official grading');
  assert.ok(remoteSaveIndex >= 0 && completionIndex > remoteSaveIndex, 'must persist before completion');
  assert.ok(source.includes('setStatus(\'Could not save or verify your answer. Please try again.\')'));
  assert.ok(!source.includes('session-default'), 'must not use placeholder session');
  assert.ok(!source.includes('courseId: effectiveCourseId'), 'must not submit CK asset course ID');
});
