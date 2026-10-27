import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAuthenticatedActivityAttempt } from '../src/lib/ck2BackendAttempt.js';

const manual = JSON.parse(readFileSync(new URL(
  '../public/manual-activity-maps/CK/CK_M3L1/CK-M3L1_1.activity-map.json',
  import.meta.url,
), 'utf8'));
const scenes = manual.tasks['task-43-a6jcur'].sceneClassification.scenes;
const assignments = Object.fromEntries(scenes.map(s => [s.id, s.expectedSprites]));

test('CK2 scene answer preserves every sprite group from course map', () => {
  assert.equal(scenes.length, 4);
  assert.deepEqual(assignments['scene-1'], ['boat','cat']);
  assert.deepEqual(assignments['scene-2'], ['polar-bear','boat','cat']);
  assert.deepEqual(assignments['scene-3'], ['cat','wizard','boat']);
  assert.deepEqual(assignments['scene-4'], ['crab','cat','seahorse','diver','yellow-fish','green-fish']);
});

test('CK asset URL sends an authenticated CK2 scene attempt, no UUID session', () => {
  const { headers, payload } = buildAuthenticatedActivityAttempt({
    accessToken:'header.payload.signature',
    studentEmail:'CK2.TEST.STU@algo.edu.vn',
    courseId:'CK',
    lessonId:'CK_M3L1',
    pageId:'CK-M3L1_1',
    taskId:'task-43-a6jcur',
    activityType:'scene-classification-task',
    answer: { assignments },
  });
  assert.equal(headers.Authorization,'Bearer header.payload.signature');
  assert.equal(payload.courseId,'CK2');
  assert.equal(payload.sessionId,'user:ck2.test.stu@algo.edu.vn');
  assert.equal(payload.userId,'ck2.test.stu@algo.edu.vn');
  assert.deepEqual(payload.answer.assignments,assignments);
});

test('scene UI awaits backend save and grading before completion', () => {
  const s=readFileSync(new URL('../src/activities/SceneClassificationTask.jsx',import.meta.url),'utf8');
  const section=s.slice(s.indexOf('async function checkTask()'));
  assert.ok(s.includes('buildAuthenticatedActivityAttempt({'));
  assert.ok(s.includes('saved?.result?.isCorrect !== true'));
  assert.ok(section.indexOf('await submitAttemptToBackend(assignments);')>=0);
  assert.ok(section.indexOf('triggerSuccess(assignments);')>section.indexOf('await submitAttemptToBackend(assignments);'));
  assert.ok(s.includes('Boolean(isTaskDone || serverConfirmed)'));
  assert.ok(!s.includes('sessionId: getSessionId()'));
});

test('all remaining activity writers use the CK2 auth helper or authorized progress API', () => {
  const files=['SceneClassificationTask.jsx','ProjectChecklistTask.jsx',
    'ScratchEmbedTask.jsx','LinkDownloadTask.jsx','FinishTask.jsx'];
  for(const f of files){
    const s=readFileSync(new URL(`../src/activities/${f}`,import.meta.url),'utf8');
    assert.ok(s.includes('buildAuthenticatedActivityAttempt({'), f);
    assert.ok(!s.includes('sessionId: getSessionId()'), f);
    assert.ok(!s.includes("sessionId: getSessionId(),"),f);
  }
});
