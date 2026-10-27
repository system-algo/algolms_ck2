import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProgressCourseId,
  saveTaskCompletionToSupabase,
} from '../src/lib/supabaseProgress.js';

test('CK2 uses CK lesson assets but its own Supabase progress course code', () => {
  assert.equal(getProgressCourseId('CK'), 'CK2');
  assert.equal(getProgressCourseId(' ck '), 'CK2');
  assert.equal(getProgressCourseId('CK2'), 'CK2');
  assert.equal(getProgressCourseId('GD'), 'GD');
});

test('completion insert carries the authenticated CK2 student identity', async () => {
  const previous = {
    sessionStorage: globalThis.sessionStorage,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
  };
  const values = {
    lms_supabase_url: 'https://example.supabase.co',
    lms_supabase_key: 'public-test-key',
    lms_student_email: 'CK2.TEST.STU@example.com',
    lms_access_token: 'header.payload.signature',
  };
  const posted = [];
  try {
    globalThis.sessionStorage = {
      getItem: (key) => values[key] ?? null,
    };
    globalThis.localStorage = {
      getItem: () => null,
    };
    globalThis.fetch = async (url, options) => {
      posted.push({ url, options });
      return { ok: true, status: 201, text: async () => '' };
    };

    await saveTaskCompletionToSupabase({
      courseId: 'CK',
      lessonId: 'CK_M3L1',
      pageId: 'CK-M3L1_1',
      taskId: 'task-2',
    });

    assert.equal(posted.length, 1);
    assert.match(posted[0].url, /\/rest\/v1\/activity_progress/);
    assert.equal(posted[0].options.headers.Authorization, 'Bearer header.payload.signature');

    const record = JSON.parse(posted[0].options.body);
    assert.equal(record.course_id, 'CK2');
    assert.equal(record.user_id, 'ck2.test.stu@example.com');
    assert.equal(record.session_id, 'user:ck2.test.stu@example.com');
    assert.equal(record.lesson_id, 'CK_M3L1');
    assert.equal(record.is_completed, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
