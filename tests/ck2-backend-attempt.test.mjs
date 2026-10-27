import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthenticatedActivityAttempt } from '../src/lib/ck2BackendAttempt.js';

const base = {
  accessToken: 'header.payload.signature',
  studentEmail: ' CK2.TEST.STU@algo.edu.vn ',
  courseId: 'CK',
  lessonId: 'CK_M3L1',
  pageId: 'CK-M3L1_1',
  taskId: 'task-1-1hgbgc3',
  activityType: 'matching-connect',
  answer: {
    connections: { 'left-1': 'right-2', 'left-2': 'right-1' },
    pairs: { 'left-1': 'right-2', 'left-2': 'right-1' },
  },
};

test('CK asset routes submit matching answers with CK2 enrollment and Bearer JWT', () => {
  const { headers, payload } = buildAuthenticatedActivityAttempt(base);
  assert.equal(headers.Authorization, 'Bearer header.payload.signature');
  assert.equal(payload.courseId, 'CK2');
  assert.equal(payload.sessionId, 'user:ck2.test.stu@algo.edu.vn');
  assert.equal(payload.userId, 'ck2.test.stu@algo.edu.vn');
  assert.equal(payload.lessonId, 'CK_M3L1');
  assert.equal(payload.pageId, 'CK-M3L1_1');
  assert.deepEqual(payload.answer.connections, base.answer.connections);
});

test('an extension payload cannot override authorized course or student identity', () => {
  const { payload } = buildAuthenticatedActivityAttempt({
    ...base,
    extra: {
      courseId: 'CK',
      userId: 'someone-else@algo.edu.vn',
      sessionId: 'session-default',
      isCorrect: true,
    },
  });
  assert.equal(payload.courseId, 'CK2');
  assert.equal(payload.userId, 'ck2.test.stu@algo.edu.vn');
  assert.equal(payload.sessionId, 'user:ck2.test.stu@algo.edu.vn');
  assert.equal(payload.isCorrect, true);
});

test('missing or invalid login tokens reject submissions instead of claiming completion', () => {
  for (const accessToken of ['', 'anon-key', null]) {
    assert.throws(
      () => buildAuthenticatedActivityAttempt({ ...base, accessToken }),
      /authenticated student session/,
    );
  }
});

test('non-CK course IDs are not remapped', () => {
  assert.equal(
    buildAuthenticatedActivityAttempt({ ...base, courseId: 'CK2' }).payload.courseId,
    'CK2',
  );
  assert.equal(
    buildAuthenticatedActivityAttempt({ ...base, courseId: 'GD' }).payload.courseId,
    'GD',
  );
});
