import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyMatchingAttempt, getWrongMatchingPairIds } from '../src/lib/ck2MatchingGrade.js';
import { getLmsBannerDetails } from '../src/lib/activityFeedback.js';

const task = readFileSync(new URL('../src/activities/MatchingConnectTask.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/templates/GeneratedPageShell.jsx', import.meta.url), 'utf8');

test('an HTTP 201 / ok:true with isCorrect:false is WRONG, never Correct', () => {
  const response = {
    ok: true,
    result: {
      status: 'incorrect',
      isCorrect: false,
      score: 0,
      maxScore: 4,
      details: { wrongIds: ['left-1', 'left-2', 'left-3', 'left-4'] },
    },
  };
  assert.equal(classifyMatchingAttempt(response), 'wrong');
  assert.deepEqual(getWrongMatchingPairIds(response), ['left-1','left-2','left-3','left-4']);
});

test('only official server result true/correct can complete a matching task', () => {
  assert.equal(classifyMatchingAttempt({ok: true, result: {isCorrect:true,status:'correct'}}), 'correct');
  assert.equal(classifyMatchingAttempt({ok: true, result: {isCorrect:true,status:'incorrect'}}), 'wrong');
  assert.equal(classifyMatchingAttempt({ok: true, result: {isCorrect:false,status:'correct'}}), 'wrong');
  assert.equal(classifyMatchingAttempt({ok: true, result: {isCorrect:null,status:'missing_answer_key'}}), 'missing-answer-key');
  assert.equal(classifyMatchingAttempt({ok: true, result: {isCorrect:null,status:'pending_review'}}), 'grading-unavailable');
  assert.equal(classifyMatchingAttempt({ok: false, result: {isCorrect:true,status:'correct'}}), 'save-error');
  assert.equal(classifyMatchingAttempt(null), 'save-error');
  assert.deepEqual(getWrongMatchingPairIds({ok:true,result:{details:{}}}), []);
});

test('failed official grade renders ERROR, never a green Great job', () => {
  const cases = [
    'Incorrect. Some connections do not match the official answer key. Try again.',
    'Answer saved, but the server marked it incorrect.',
    'Some connections are incorrect.',
    'Your answer could not be saved. Please retry.',
    'Missing answer key',
  ];
  for (const message of cases) {
    const banner = getLmsBannerDetails(message);
    assert.equal(banner.type, 'error', message);
    assert.equal(banner.isSuccess, false, message);
    assert.notEqual(banner.title, 'Great job! 🎉', message);
    assert.ok(banner.description.includes(message));
  }
  assert.equal(getLmsBannerDetails('Incorrect.', 'error').type, 'error');
  assert.equal(getLmsBannerDetails('Correct!', 'success').type, 'success');
  assert.equal(getLmsBannerDetails('Saving your answer...').type, 'checking');
  assert.equal(getLmsBannerDetails('Checking your answer...').type, 'checking');
  assert.equal(getLmsBannerDetails('Correct!').type, 'success');
});

test('matching client never uses the manual GitHub answer key to grade', () => {
  assert.ok(task.includes('classifyMatchingAttempt(saved)'));
  assert.ok(task.includes('getWrongMatchingPairIds(saved)'));
  assert.ok(!task.includes('isCorrect(connections, data.answerKey'));
  assert.ok(!task.includes("extra: { isCorrect: true"));
  assert.ok(task.includes('setResult(officialGrade);'));
  assert.ok(task.includes("if (officialGrade !== 'correct')"));
  assert.ok(task.includes("statusVariant={statusVariant}"));
  assert.ok(task.includes("isCheckDisabled={isSaving}"));
  assert.ok(task.includes("answer: { connections, pairs: connections }"));
});

test('a rejected server grade clears only stale browser task completion', () => {
  assert.ok(task.includes("new CustomEvent('LMS_TASK_GRADED'"));
  assert.ok(shell.includes("window.addEventListener('LMS_TASK_GRADED', handleOfficialGrade)"));
  assert.ok(shell.includes('previous.filter((id) => id !== taskId)'));
  assert.ok(shell.includes('localStorage.setItem(completedTasksStorageKey, JSON.stringify(updated))'));
});

test('only backend-graded correct matching may dispatch completion', () => {
  const gradeIndex=task.indexOf("const officialGrade = classifyMatchingAttempt(saved);");
  const correctIndex=task.indexOf("setResult('correct');",gradeIndex);
  const completionIndex=task.indexOf('onTaskCompleted(completionPayload);',correctIndex);
  assert.ok(gradeIndex>=0 && correctIndex>gradeIndex && completionIndex>correctIndex);
  assert.ok(task.includes("return;\n      }\n\n      setWrongLeftIds([]);\n      setResult('correct');"));
});
