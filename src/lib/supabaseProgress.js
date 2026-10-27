function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getSupabaseCredentials() {
  const supabaseUrl =
    sessionStorage.getItem('lms_supabase_url') ||
    localStorage.getItem('lms_supabase_url');
  const supabaseKey =
    sessionStorage.getItem('lms_supabase_key') ||
    localStorage.getItem('lms_supabase_key');
  const studentEmail = normalizeEmail(
    sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email'),
  );

  return { supabaseUrl, supabaseKey, studentEmail };
}

function getSupabaseHeaders(supabaseKey) {
  const accessToken =
    sessionStorage.getItem('lms_access_token') ||
    localStorage.getItem('lms_access_token');
  const headers = {
    apikey: supabaseKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=ignore-duplicates,return=minimal',
  };

  if (accessToken && accessToken.split('.').length === 3) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

function getProgressUrl(supabaseUrl) {
  const conflictColumns = [
    'session_id',
    'course_id',
    'lesson_id',
    'page_id',
    'task_id',
  ].join(',');

  return `${supabaseUrl}/rest/v1/activity_progress?on_conflict=${encodeURIComponent(conflictColumns)}`;
}

function buildCompletionRecord({
  studentEmail,
  courseId,
  lessonId,
  pageId,
  taskId,
}) {
  const normalizedEmail = normalizeEmail(studentEmail);
  const timestamp = new Date().toISOString();

  return {
    session_id: `user:${normalizedEmail}`,
    user_id: normalizedEmail,
    course_id: String(courseId || ''),
    lesson_id: String(lessonId || ''),
    page_id: String(pageId || ''),
    task_id: String(taskId || ''),
    activity_type: 'completion-sync',
    status: 'completed',
    is_completed: true,
    completion_type: 'completed',
    completed_at: timestamp,
    updated_at: timestamp,
  };
}

export async function saveTaskCompletionToSupabase({
  courseId,
  lessonId,
  pageId,
  taskId,
}) {
  const { supabaseUrl, supabaseKey, studentEmail } = getSupabaseCredentials();
  if (!supabaseUrl || !supabaseKey || !studentEmail || !taskId) return;

  const record = buildCompletionRecord({
    studentEmail,
    courseId,
    lessonId,
    pageId,
    taskId,
  });

  const headers = getSupabaseHeaders(supabaseKey);

  try {
    let res = await fetch(getProgressUrl(supabaseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(record),
    });

    if (!res.ok && (res.status === 400 || res.status === 409)) {
      // Fallback: POST directly without on_conflict parameter if unique constraint on Supabase differs
      res = await fetch(`${supabaseUrl}/rest/v1/activity_progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify(record),
      });
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn(
          '[SupabaseProgress] Direct Supabase write restricted by RLS (backend service role tracks official progress):',
          res.status,
        );
      } else {
        console.warn(
          '[SupabaseProgress] Failed to save progress:',
          res.status,
          await res.text(),
        );
      }
    }
  } catch (err) {
    console.warn('[SupabaseProgress] Error saving progress to Supabase:', err);
  }
}

/**
 * DEPRECATED & DISABLED: Vô hiệu hóa việc upload hàng loạt từ localStorage cũ
 * để tránh lây nhiễm chéo tiến độ giữa các tài khoản học sinh trên cùng một máy/trình duyệt.
 */
export async function syncLocalStorageToSupabase() {
  // Bỏ toàn bộ vòng lặp duyệt localStorage và lệnh POST lên Supabase.
  return;
}

export async function resetPageProgressInSupabase({ pageId, studentEmail }) {
  const { supabaseUrl, supabaseKey, studentEmail: defaultEmail } = getSupabaseCredentials();
  if (!supabaseUrl || !supabaseKey || !pageId) return;

  const targetEmail = studentEmail || defaultEmail;

  try {
    let url = `${supabaseUrl}/rest/v1/activity_progress?page_id=eq.${encodeURIComponent(pageId)}`;
    if (targetEmail) {
      url += `&user_id=eq.${encodeURIComponent(targetEmail)}`;
    }
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getSupabaseHeaders(supabaseKey),
    });
    if (res.ok) {
      console.log('[SupabaseProgress] Successfully deleted page progress from Supabase:', pageId);
    }
  } catch (err) {
    console.warn('[SupabaseProgress] Error deleting progress from Supabase:', err);
  }
}
