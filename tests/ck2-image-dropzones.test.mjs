import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAuthenticatedActivityAttempt } from '../src/lib/ck2BackendAttempt.js';

const courseId = 'CK';
const lessonId = 'CK_M3L1';
const pageId = 'CK-M3L1_1';
const taskId = 'task-28-1emx1e0';

test('CK2 image dropzones uses separate CK2 course and authenticated identity', () => {
  const placements = {
    'zone-comet': 'comet',
    'zone-cat': 'cat',
    'zone-ship': 'ship',
    'zone-star-2': 'star-2',
    'zone-star-1': 'star-1',
    'zone-flowers': 'flowers',
  };
  const { headers, payload } = buildAuthenticatedActivityAttempt({
    studentEmail: 'CK2.TEST.STU@algo.edu.vn',
    accessToken: 'header.payload.signature',
    courseId, lessonId, pageId, taskId,
    activityType: 'image-dropzones-task',
    answer: { placements },
  });
  assert.equal(headers.Authorization, 'Bearer header.payload.signature');
  assert.equal(payload.courseId, 'CK2');
  assert.equal(payload.sessionId, 'user:ck2.test.stu@algo.edu.vn');
  assert.equal(payload.userId, 'ck2.test.stu@algo.edu.vn');
  assert.equal(payload.taskId, taskId);
  assert.deepEqual(payload.answer.placements, placements);
});

test('CK2 mapped image-dropzones answer is complete and unambiguous', () => {
  const manualMap = JSON.parse(readFileSync(
    new URL('../public/manual-activity-maps/CK/CK_M3L1/CK-M3L1_1.activity-map.json', import.meta.url), 'utf8'));
  const zones = manualMap.tasks[taskId].imageDropzones.dropzones;
  const placements = Object.fromEntries(zones.map(z => [z.id, z.accepts[0]]));
  assert.equal(zones.length, 6);
  assert.deepEqual(placements, {
    'zone-comet': 'comet',
    'zone-cat': 'cat',
    'zone-ship': 'ship',
    'zone-star-2': 'star-2',
    'zone-star-1': 'star-1',
    'zone-flowers': 'flowers',
  });
});

test('image completion waits for official backend save and grading', () => {
  const code = readFileSync(
    new URL('../src/activities/ImageDropzonesTask.jsx', import.meta.url), 'utf8');
  const task = code.slice(code.indexOf('async function checkTask()'));
  assert.ok(code.includes('buildAuthenticatedActivityAttempt({'));
  assert.ok(code.includes('saved?.result?.isCorrect !== true'));
  assert.ok(task.indexOf('await submitAttemptToBackend(placements)') <
            task.indexOf('triggerSuccess(placements)'));
  assert.ok(!code.includes('sessionId: getSessionId()'));
  assert.ok(code.includes("status === 'Correct!' && !hasError"));
});

test('other CK2 activity submitters use authenticated attempt builder', () => {
  const files = [
    'McqCheckboxTask.jsx', 'WindowFillBlankTask.jsx',
    'MatchingDragdropTask.jsx', 'ConnectedBlocksTask.jsx', 'IdeaListTask.jsx',
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/activities/${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes('buildAuthenticatedActivityAttempt({'), file);
    assert.ok(!source.includes('sessionId: getSessionId(),'), file);
    assert.ok(source.includes('Authorization') ||
      source.includes('headers,') || source.includes('headers,'), file);
  }
});
