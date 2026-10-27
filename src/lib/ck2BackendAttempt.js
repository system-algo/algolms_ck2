import { getProgressCourseId } from './supabaseProgress.js';

// Only a signed-in student may submit an activity attempt.
// CK2 hosts lesson assets using /courses/CK, but authorization and storage
// use the independent CK2 course identifier.
export function buildAuthenticatedActivityAttempt({
  accessToken,
  studentEmail,
  courseId,
  lessonId,
  pageId,
  taskId,
  activityType,
  answer,
  extra = {},
}) {
  const email = String(studentEmail || '').trim().toLowerCase();
  const token = String(accessToken || '').trim();
  const dataCourseId = getProgressCourseId(courseId);

  if (!email || !token || token.split('.').length !== 3) {
    throw new Error('An authenticated student session is required to submit this activity.');
  }
  if (!dataCourseId || !lessonId || !pageId || !taskId || !activityType) {
    throw new Error('Missing course, lesson, page, task or activity identifier.');
  }

  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    payload: {
      ...extra,
      sessionId: `user:${email}`,
      userId: email,
      courseId: dataCourseId,
      lessonId: String(lessonId),
      pageId: String(pageId),
      taskId: String(taskId),
      activityType: String(activityType),
      answer,
    },
  };
}
