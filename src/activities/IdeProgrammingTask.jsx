import { useEffect, useMemo, useRef, useState } from 'react';
import { runPythonCode } from '../lib/pythonRuntime.js';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';
import { getProgressCourseId, saveTaskCompletionToSupabase } from '../lib/supabaseProgress.js';

function getApiBaseUrl() {
  const envUrl = String(
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    ''
  ).trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');

  if (typeof window !== 'undefined') {
    const storageUrl =
      sessionStorage.getItem('lms_backend_url') ||
      localStorage.getItem('lms_backend_url') ||
      '';
    if (storageUrl) return storageUrl.trim().replace(/\/+$/, '');
  }

  return '';
}

const API_BASE_URL = getApiBaseUrl();
const SESSION_STORAGE_KEY = 'algolms_session_id';

const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const PYTHON_BUILTINS = new Set([
  'abs',
  'all',
  'any',
  'bin',
  'bool',
  'chr',
  'dict',
  'dir',
  'enumerate',
  'filter',
  'float',
  'format',
  'input',
  'int',
  'len',
  'list',
  'map',
  'max',
  'min',
  'open',
  'print',
  'range',
  'randint',
  'round',
  'set',
  'sorted',
  'str',
  'sum',
  'tuple',
  'type',
]);

const EMBEDDED_STYLES = `
.ide-programming-task {
  width: min(1560px, calc(100vw - 80px));
  min-height: 620px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(520px, 1fr) 24px 520px;
  background: #eef2f7;
  border-radius: 12px;
  overflow: hidden;
  transition: grid-template-columns 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ide-programming-task.is-right-collapsed {
  grid-template-columns: minmax(520px, 1fr) 24px 0;
}

.ide-programming-task.is-fullscreen {
  width: calc(100vw - 24px);
  min-height: calc(100vh - 170px);
}

.ide-programming-left {
  min-width: 0;
  background: #e9edf3;
  display: flex;
  flex-direction: column;
}

.ide-programming-splitter {
  position: relative;
  background: #8d3ff2;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 100%;
  z-index: 5;
}

.ide-splitter-button {
  width: 16px;
  height: 64px;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #8d3ff2;
  cursor: pointer;
  font-size: 15px;
  font-weight: 900;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  box-shadow: 0 1px 4px rgba(16, 24, 40, 0.25);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ide-splitter-button:hover {
  background: #f5efff;
  transform: scale(1.15);
}

.ide-programming-task.is-right-collapsed .ide-splitter-button {
  transform: rotate(180deg);
}

.ide-programming-task.is-right-collapsed .ide-splitter-button:hover {
  transform: rotate(180deg) scale(1.15);
}

.ide-programming-toolbar {
  height: 54px;
  background: #eef2f7;
  border-bottom: 1px solid #d5dae2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  padding: 0 24px;
}

.ide-toolbar-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: #8d3ff2;
  color: white;
  font-weight: 800;
  font-size: 15px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ide-toolbar-button:hover {
  filter: brightness(1.05);
}

.ide-toolbar-button:active {
  transform: translateY(1px);
}

.ide-toolbar-button.is-soft {
  background: #c8b6f4;
}

.ide-programming-editor-wrap {
  flex: 1;
  min-height: 540px;
  background: #eef2f7;
  display: flex;
  align-items: stretch;
  padding: 0;
  overflow: hidden;
}

.ide-line-numbers {
  width: 72px;
  padding-top: 12px;
  color: #35658f;
  font-family: "Nunito", sans-serif;
  font-size: 14px;
  line-height: 24px;
  text-align: right;
  user-select: none;
  overflow: hidden;
  flex: 0 0 72px;
}

.ide-line-number {
  display: block;
  height: 24px;
  padding-right: 18px;
}

.ide-code-layer {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 540px;
}

.ide-code-highlight,
.ide-code-textarea {
  position: absolute;
  inset: 0;
  width: 100%;
  min-height: 540px;
  margin: 0;
  padding: 12px 18px 40px 0;
  border: 0;
  outline: 0;
  font-family: "Nunito", sans-serif;
  font-size: 14px;
  line-height: 24px;
  tab-size: 4;
  white-space: pre;
  box-sizing: border-box;
}

.ide-code-highlight {
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
  background: transparent;
}

.ide-code-textarea {
  z-index: 2;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: #172554;
  overflow: auto;
  -webkit-text-fill-color: transparent;
}

.ide-code-textarea::selection {
  background: rgba(141, 63, 242, 0.28);
}

.ide-code-textarea::placeholder {
  color: rgba(21, 32, 51, 0.35);
  -webkit-text-fill-color: rgba(21, 32, 51, 0.35);
}

.ide-code-line {
  height: 24px;
  min-height: 24px;
}

.ide-token {
  color: #172033;
}

.ide-token.keyword {
  color: #2459ff;
}

.ide-token.builtin {
  color: #0094ff;
}

.ide-token.string {
  color: #c0392b;
}

.ide-token.number {
  color: #00a86b;
}

.ide-token.comment {
  color: #138a25;
}

.ide-token.operator {
  color: #172033;
}

.ide-token.punctuation {
  color: #7c3aed;
}

.ide-token.variable {
  color: #172033;
}

.ide-output-panel {
  border-top: 1px solid #d5dae2;
  background: #f8fafc;
  padding: 10px 18px 14px 72px;
  color: #334155;
  font-size: 13px;
  line-height: 1.45;
}

.ide-output-panel strong {
  display: block;
  margin-bottom: 4px;
}

.ide-output-panel pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: "Nunito", sans-serif;
}

.ide-programming-right {
  background: #eef2f7;
  padding: 18px 20px 24px 20px;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 520px;
  box-sizing: border-box;
}

.ide-side-title {
  margin: 0 0 16px;
  padding: 20px 18px;
  background: white;
  border-radius: 10px;
  color: #101828;
  font-size: 24px;
  font-weight: 800;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}

.ide-side-divider {
  height: 4px;
  background: #c8ccd4;
  border-radius: 999px;
  margin: 0 0 16px;
}

.ide-side-section-label {
  margin: 0 0 12px;
  color: #7a8494;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ide-instruction-card,
.ide-tip-card,
.ide-answer-key-card {
  background: white;
  border-radius: 10px;
  margin-bottom: 14px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}

.ide-card-header {
  width: 100%;
  border: 0;
  background: transparent;
  color: #101828;
  padding: 16px 18px;
  text-align: left;
  cursor: pointer;
  font: inherit;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ide-card-header strong {
  font-size: 15px;
  line-height: 1.35;
}

.ide-card-chevron {
  flex: 0 0 auto;
  color: #475467;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ide-card-body {
  padding: 0 18px 16px;
  color: #101828;
  font-size: 15px;
  line-height: 1.45;
}

.ide-card-body p {
  margin: 0 0 12px;
}

.ide-card-body p:last-child {
  margin-bottom: 0;
}

.ide-task-preview-image {
  margin: 0 0 14px;
  border: 1px solid #d7dbe3;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.ide-task-preview-image img {
  display: block;
  width: 100%;
  height: auto;
  cursor: zoom-in;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.ide-task-preview-image img:hover {
  transform: scale(1.015);
  box-shadow: 0 4px 14px rgba(141, 63, 242, 0.2);
}

.ide-tip-card {
  border: 1px solid #c5cbd5;
}

.ide-tip-card .ide-card-header {
  padding: 14px 16px;
}

.ide-tip-card .ide-card-body {
  padding: 0 16px 14px;
  color: #273244;
  font-size: 14px;
}

.ide-status-note {
  margin-top: 12px;
  color: #6b7280;
  font-size: 13px;
}

.ide-answer-key-code {
  margin: 0;
  border: 1px solid #d7dbe3;
  border-radius: 8px;
  background: #f8fafc;
  overflow: auto;
  max-height: 420px;
  font-family: "Nunito", sans-serif;
  font-size: 13px;
  line-height: 22px;
}

.ide-answer-key-line {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  min-height: 22px;
}

.ide-answer-key-line-number {
  padding: 0 10px;
  color: #64748b;
  text-align: right;
  user-select: none;
  border-right: 1px solid #e2e8f0;
  background: #eef2f7;
}

.ide-answer-key-line-code {
  padding: 0 12px;
  white-space: pre;
}

.ide-answer-key-empty,
.ide-answer-key-error {
  margin: 0;
  color: #b42318;
  font-size: 14px;
  line-height: 1.45;
}

.ide-programming-task.is-dark .ide-programming-left,
.ide-programming-task.is-dark .ide-programming-editor-wrap {
  background: #20262b;
}

.ide-programming-task.is-dark .ide-programming-toolbar {
  background: #20262b;
  border-bottom-color: #111827;
}

.ide-programming-task.is-dark .ide-line-numbers {
  color: rgba(210, 215, 225, 0.58);
}

.ide-programming-task.is-dark .ide-code-textarea {
  caret-color: #5ee7ff;
}

.ide-programming-task.is-dark .ide-token {
  color: #d4d7df;
}

.ide-programming-task.is-dark .ide-token.keyword {
  color: #56a8ff;
}

.ide-programming-task.is-dark .ide-token.builtin {
  color: #27b7ff;
}

.ide-programming-task.is-dark .ide-token.string {
  color: #ffae33;
}

.ide-programming-task.is-dark .ide-token.number {
  color: #4fe28a;
}

.ide-programming-task.is-dark .ide-token.comment {
  color: #59b85a;
}

.ide-programming-task.is-dark .ide-token.operator {
  color: #d4d7df;
}

.ide-programming-task.is-dark .ide-token.punctuation {
  color: #c77dff;
}

.ide-programming-task.is-dark .ide-output-panel {
  background: #151a1f;
  color: #d4d7df;
  border-top-color: #0f172a;
}

.ide-programming-task.is-dark .ide-answer-key-code {
  background: #151a1f;
  border-color: #0f172a;
}

.ide-programming-task.is-dark .ide-answer-key-line-number {
  background: #20262b;
  color: rgba(210, 215, 225, 0.58);
  border-right-color: #0f172a;
}

.ide-output-terminal {
  display: block;
  margin: 0;
  white-space: pre-wrap;
  font-family: "Nunito", sans-serif;
}

.ide-stdin-input {
  display: inline-block;
  width: min(320px, 70%);
  min-width: 90px;
  margin: 0;
  padding: 0 0 0 2px;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: inherit;
  caret-color: currentColor;
}

.ide-stdin-input::selection {
  background: rgba(141, 63, 242, 0.28);
}

.ide-programming-task.is-dark .ide-stdin-input {
  color: #d4d7df;
}

@media (max-width: 1100px) {
  .ide-programming-task {
    width: calc(100vw - 48px);
    grid-template-columns: 1fr;
  }

  .ide-programming-task.is-right-collapsed {
    grid-template-columns: 1fr;
  }

  .ide-programming-left {
    border-right: 0;
    border-bottom: 0;
  }

  .ide-programming-splitter {
    display: none;
  }
}
`;

function getTaskId(task) {
  return String(task?.id || task?.taskId || 'ide-programming-task').trim();
}

function getStateId(state) {
  return String(state?.id || state?.stateId || '').trim();
}

function cleanString(value) {
  return String(value || '').trim();
}

function getSessionId() {
  try {
    // Prefer the student's email (provided by the classroom platform)
    const studentEmail = localStorage.getItem('lms_student_email');
    if (studentEmail) return studentEmail;

    const existing = localStorage.getItem(SESSION_STORAGE_KEY);

    if (existing) return existing;

    const next =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function getStudentUserId(pageInstance, task) {
  if (task?.userId) return String(task.userId).trim().toLowerCase();
  if (pageInstance?.userId) return String(pageInstance.userId).trim().toLowerCase();
  if (typeof window !== 'undefined') {
    const email =
      sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email') ||
      sessionStorage.getItem('lms_user_email') ||
      localStorage.getItem('lms_user_email');
    if (email && email.trim()) return email.trim().toLowerCase();
  }
  return 'guest@algo.edu.vn';
}

function getRuntimeIds(pageInstance, task, state) {
  let courseId = '';
  let lessonId = '';
  let pageId = '';

  try {
    const params = new URLSearchParams(window.location.search);

    courseId = params.get('course') || params.get('courseId') || '';
    lessonId = params.get('lesson') || params.get('lessonId') || '';
    pageId = params.get('page') || params.get('pageId') || '';
  } catch {
    // Ignore and use fallback below.
  }

  const ideConfig = task?.ideProgramming || state?.ideProgramming || {};

  return {
    courseId:
      courseId ||
      task?.courseId ||
      ideConfig?.courseId ||
      pageInstance?.courseId ||
      pageInstance?.course?.id ||
      pageInstance?.course ||
      (typeof window !== 'undefined'
        ? sessionStorage.getItem('lms_course_id') || localStorage.getItem('lms_course_id')
        : '') ||
      'GD',
    lessonId:
      lessonId ||
      task?.lessonId ||
      ideConfig?.lessonId ||
      pageInstance?.lessonId ||
      pageInstance?.lesson?.id ||
      pageInstance?.lesson ||
      (typeof window !== 'undefined'
        ? sessionStorage.getItem('lms_current_lesson_id') || localStorage.getItem('lms_current_lesson_id')
        : '') ||
      '',
    pageId:
      pageId ||
      task?.pageId ||
      ideConfig?.pageId ||
      pageInstance?.pageId ||
      pageInstance?.page?.id ||
      pageInstance?.id ||
      (typeof window !== 'undefined'
        ? sessionStorage.getItem('lms_current_page_id') || localStorage.getItem('lms_current_page_id')
        : '') ||
      '',
  };
}

function getInputValues(task, state) {
  const sources = [
    state?.ideProgramming,
    task?.ideProgramming,
    state,
    task,
  ];

  for (const source of sources) {
    const value =
      source?.inputValues ??
      source?.inputs ??
      source?.testInputs ??
      source?.testInput ??
      source?.stdin;

    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }

    if (typeof value === 'string') {
      return value
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n');
    }
  }

  return [];
}

function getPythonTimeoutMs(task, state) {
  return Number(
    state?.ideProgramming?.pythonTimeoutMs ||
      task?.ideProgramming?.pythonTimeoutMs ||
      state?.pythonTimeoutMs ||
      task?.pythonTimeoutMs ||
      state?.timeoutMs ||
      task?.timeoutMs ||
      5000
  );
}

function getSubmitEndpoint(task, state) {
  return cleanString(
    state?.ideProgramming?.submitEndpoint ||
      task?.ideProgramming?.submitEndpoint ||
      state?.submitEndpoint ||
      task?.submitEndpoint ||
      '/api/activity-attempts'
  );
}

function getAnswerKeyEndpoint(task, state) {
  return cleanString(
    state?.ideProgramming?.answerKeyEndpoint ||
      task?.ideProgramming?.answerKeyEndpoint ||
      state?.answerKeyEndpoint ||
      task?.answerKeyEndpoint ||
      '/api/admin/answer-keys'
  );
}

function unwrapBackendPayload(payload) {
  if (!payload) return null;

  if (payload.ok === true && payload.data) return payload.data;
  if (payload.data?.attempt || payload.data?.progress || payload.data?.result) return payload.data;

  return payload;
}

function getBackendError(payload) {
  return (
    payload?.error?.message ||
    payload?.message ||
    payload?.error ||
    'Request failed.'
  );
}

function normalizeCode(value) {
  return String(value ?? '').replace(/\r/g, '').replace(/\t/g, '    ');
}

function normalizeAnswerKeySource(value) {
  return normalizeCode(value).trimEnd();
}

function getAnswerKeySourceFromObject(source) {
  if (!source || typeof source !== 'object') return '';

  const answerKeyJson =
    source.answer_key ||
    source.answerKey ||
    source.answer_key_json ||
    source.answerKeyJson ||
    source;

  let parsedJson = null;
  if (typeof answerKeyJson === 'string') {
    try {
      parsedJson = JSON.parse(answerKeyJson);
    } catch {
      // Ignore
    }
  } else if (typeof answerKeyJson === 'object' && answerKeyJson !== null) {
    parsedJson = answerKeyJson;
  }

  return normalizeAnswerKeySource(
    source.answer_key_source ||
      source.answerKeySource ||
      source.sourceCode ||
      source.source_code ||
      source.targetCode ||
      source.target_code ||
      source.solutionCode ||
      source.solution_code ||
      source.expectedCode ||
      source.expected_code ||
      source.code ||
      source.solution ||
      source.answer ||
      parsedJson?.targetCode ||
      parsedJson?.target_code ||
      parsedJson?.sourceCode ||
      parsedJson?.source_code ||
      parsedJson?.answerKeySource ||
      parsedJson?.answer_key_source ||
      parsedJson?.solutionCode ||
      parsedJson?.solution_code ||
      parsedJson?.expectedCode ||
      parsedJson?.expected_code ||
      parsedJson?.code ||
      parsedJson?.solution ||
      parsedJson?.answer ||
      ''
  );
}

function getAnswerKeyLanguageFromObject(source) {
  if (!source || typeof source !== 'object') return 'python';

  const answerKeyJson =
    source.answer_key ||
    source.answerKey ||
    source.answer_key_json ||
    source.answerKeyJson ||
    source;

  return cleanString(
    source.language ||
      source.answer_key_language ||
      source.answerKeyLanguage ||
      answerKeyJson?.language ||
      'python'
  ) || 'python';
}

function findMatchingAnswerKeyRow(rows, taskId) {
  if (!Array.isArray(rows)) return null;

  const normalizedTaskId = cleanString(taskId);

  return rows.find((row) => {
    const rowTaskId = cleanString(row?.task_id || row?.taskId);
    return rowTaskId === normalizedTaskId;
  }) || rows[0] || null;
}

function extractAnswerKeyFromPayload(payload, taskId) {
  const data = payload?.data || payload;

  if (!data) {
    return {
      source: '',
      language: 'python',
    };
  }

  if (Array.isArray(data?.answerKeys)) {
    const row = findMatchingAnswerKeyRow(data.answerKeys, taskId);

    return {
      source: getAnswerKeySourceFromObject(row),
      language: getAnswerKeyLanguageFromObject(row),
    };
  }

  if (Array.isArray(payload?.answerKeys)) {
    const row = findMatchingAnswerKeyRow(payload.answerKeys, taskId);

    return {
      source: getAnswerKeySourceFromObject(row),
      language: getAnswerKeyLanguageFromObject(row),
    };
  }

  if (Array.isArray(data)) {
    const row = findMatchingAnswerKeyRow(data, taskId);

    return {
      source: getAnswerKeySourceFromObject(row),
      language: getAnswerKeyLanguageFromObject(row),
    };
  }

  const direct =
    data.answerKey ||
    data.answer_key ||
    data.record ||
    data.answerKeyRecord ||
    data.answer_key_record ||
    data;

  return {
    source: getAnswerKeySourceFromObject(direct),
    language: getAnswerKeyLanguageFromObject(direct),
  };
}

async function submitIdeSource({
  pageInstance,
  task,
  state,
  code,
  runtimeStatus,
  action = 'save_source',
  isCorrect = false,
}) {
  const apiBase = getApiBaseUrl();
  const taskId = getTaskId(task);
  const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance, task, state);

  if (!courseId || !lessonId || !pageId || !taskId) {
    throw new Error('Missing courseId, lessonId, pageId, or taskId.');
  }

  const sourceCode = normalizeCode(code);
  const clientSavedAt = new Date().toISOString();
  const userId = getStudentUserId(pageInstance, task);
  let savedToCloud = false;

  // 1. Submit to Backend API if configured
  if (apiBase) {
    const endpoint = getSubmitEndpoint(task, state);
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${apiBase}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: getSessionId(),
          userId,
          courseId,
          lessonId,
          pageId,
          taskId,
          activityType: 'ide-programming',
          action,
          runMode: 'run',
          language: 'python',
          sourceCode,
          runtimeStatus: runtimeStatus || 'ran',
          // Only send completion fields when explicitly submitting (not on regular saves)
          ...(isCorrect ? { isCorrect: true, status: 'completed' } : {}),
          clientSavedAt,
          answer: {
            code: sourceCode,
            submittedCode: sourceCode,
            sourceCode,
            language: 'python',
            runMode: 'run',
            runtimeStatus: runtimeStatus || 'ran',
            ...(isCorrect ? { isCorrect: true, status: 'completed' } : {}),
            clientSavedAt,
          },
        }),
      });

      const text = await response.text();
      let payload = null;

      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      if (response.ok && payload?.ok !== false) {
        savedToCloud = true;
      }
    } catch (apiErr) {
      console.warn('[IDE_PROGRAMMING_API_SAVE_WARN]', apiErr);
    }
  }

  // 2. Direct Supabase save if Supabase credentials exist
  if (typeof window !== 'undefined') {
    const supabaseUrl =
      sessionStorage.getItem('lms_supabase_url') ||
      localStorage.getItem('lms_supabase_url');
    const supabaseKey =
      sessionStorage.getItem('lms_supabase_key') ||
      localStorage.getItem('lms_supabase_key');
    const accessToken =
      sessionStorage.getItem('lms_access_token') ||
      localStorage.getItem('lms_access_token');

    // The auth policy ties progress to the signed-in student's email and
    // CK2 course membership. Do not use arbitrary task user IDs or the CK
    // asset identifier when calling the Supabase Data API.
    const studentEmail = (
      sessionStorage.getItem('lms_student_email') ||
      localStorage.getItem('lms_student_email') ||
      ''
    ).trim().toLowerCase();
    const hasJwt = Boolean(accessToken && accessToken.split('.').length === 3);

    if (supabaseUrl && supabaseKey && studentEmail && hasJwt) {
      const headers = {
        apikey: supabaseKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      };

      try {
        // activity_attempts.attempt_no is NOT NULL without a database default.
        // Resolve the next number from this student's attempts for this task.
        const progressCourseId = getProgressCourseId(courseId);
        const attemptQuery = new URLSearchParams({
          user_id: `eq.${studentEmail}`,
          course_id: `eq.${progressCourseId}`,
          lesson_id: `eq.${lessonId}`,
          page_id: `eq.${pageId}`,
          task_id: `eq.${taskId}`,
          select: 'attempt_no',
          order: 'attempt_no.desc',
          limit: '1',
        });
        const previousResponse = await fetch(
          `${supabaseUrl}/rest/v1/activity_attempts?${attemptQuery}`,
          { headers },
        );
        if (!previousResponse.ok) {
          throw new Error(`Could not read previous attempts: ${previousResponse.status}`);
        }
        const previousAttempts = await previousResponse.json();
        const lastAttemptNo = Number(previousAttempts?.[0]?.attempt_no ?? 0);
        const attemptNo = Number.isSafeInteger(lastAttemptNo) && lastAttemptNo >= 0
          ? lastAttemptNo + 1
          : 1;

        const response = await fetch(`${supabaseUrl}/rest/v1/activity_attempts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            session_id: `user:${studentEmail}`,
            user_id: studentEmail,
            course_id: progressCourseId,
            lesson_id: lessonId,
            page_id: pageId,
            task_id: taskId,
            attempt_no: attemptNo,
            activity_type: 'ide-programming',
            source_code: sourceCode,
            status: isCorrect ? 'completed' : runtimeStatus || 'saved',
            is_correct: isCorrect,
            submitted_answer: {
              code: sourceCode,
              sourceCode,
              language: 'python',
            },
          }),
        });

        if (response.ok) {
          savedToCloud = true;
        } else {
          console.warn(
            '[SUPABASE_DIRECT_SAVE_ATTEMPT_WARN]',
            response.status,
            await response.text(),
          );
        }
      } catch (error) {
        console.warn('[SUPABASE_DIRECT_SAVE_ATTEMPT_WARN]', error);
      }
    } else if (supabaseUrl && supabaseKey) {
      console.warn('[SUPABASE_DIRECT_SAVE_ATTEMPT_WARN] Missing authenticated student session.');
    }
  }

  // 3. Sync completion to Supabase and notify shell if task was completed/submitted
  if (isCorrect || action === 'submit') {
    try {
      await saveTaskCompletionToSupabase({
        courseId,
        lessonId,
        pageId,
        taskId,
      });
    } catch (progressErr) {
      console.warn('[IDE_TASK_COMPLETION_SUPABASE_WARN]', progressErr);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId },
        })
      );
    }
  }

  return { ok: true, savedToCloud };
}

async function fetchSavedIdeSource({
  pageInstance,
  task,
  state,
}) {
  const apiBase = getApiBaseUrl();
  const taskId = getTaskId(task);
  const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance, task, state);

  if (!courseId || !lessonId || !pageId || !taskId) return null;

  const endpoint = getSubmitEndpoint(task, state);
  const userId = getStudentUserId(pageInstance, task);

  // 1. Try Backend API first if available
  if (apiBase) {
    const url = new URL(
      endpoint.startsWith('http')
        ? endpoint
        : `${apiBase}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
    );

    url.searchParams.set('courseId', courseId);
    url.searchParams.set('lessonId', lessonId);
    url.searchParams.set('pageId', pageId);
    url.searchParams.set('taskId', taskId);
    url.searchParams.set('userId', userId);
    url.searchParams.set('sessionId', getSessionId());

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const payload = await response.json();
        const data = unwrapBackendPayload(payload);

        if (data) {
          const attempt = Array.isArray(data) ? data[0] : (data.attempt || data.attempts?.[0] || data.record || data);

          const sourceCode =
            attempt?.sourceCode ||
            attempt?.source_code ||
            attempt?.code ||
            attempt?.answer?.sourceCode ||
            attempt?.answer?.submittedCode ||
            attempt?.answer?.code ||
            '';

          if (sourceCode) return normalizeCode(sourceCode);
        }
      }
    } catch (error) {
      console.warn('[IDE_PROGRAMMING_FETCH_SAVED_SOURCE_WARN]', error);
    }
  }

  // 2. Direct Supabase fallback if backend API is unavailable or didn't return source
  if (typeof window !== 'undefined') {
    try {
      const supabaseUrl =
        sessionStorage.getItem('lms_supabase_url') ||
        localStorage.getItem('lms_supabase_url');
      const supabaseKey =
        sessionStorage.getItem('lms_supabase_key') ||
        localStorage.getItem('lms_supabase_key');
      const accessToken =
        sessionStorage.getItem('lms_access_token') ||
        localStorage.getItem('lms_access_token');

      if (supabaseUrl && supabaseKey) {
        const headers = { apikey: supabaseKey };
        if (accessToken && accessToken.split('.').length === 3) {
          headers.Authorization = `Bearer ${accessToken}`;
        } else {
          headers.Authorization = `Bearer ${supabaseKey}`;
        }

        // 2a. Query activity_attempts
        const sbUrl = `${supabaseUrl}/rest/v1/activity_attempts?user_id=ilike.${encodeURIComponent(userId)}&course_id=eq.${encodeURIComponent(getProgressCourseId(courseId))}&lesson_id=eq.${encodeURIComponent(lessonId)}&page_id=eq.${encodeURIComponent(pageId)}&task_id=eq.${encodeURIComponent(taskId)}&order=attempt_no.desc,created_at.desc&limit=1`;

        const sbRes = await fetch(sbUrl, { headers });
        if (sbRes.ok) {
          const rows = await sbRes.json();
          const row = Array.isArray(rows) ? rows[0] : null;
          const answer = row?.submitted_answer || row?.answer;
          const sourceCode =
            row?.source_code ||
            answer?.sourceCode ||
            answer?.submittedCode ||
            answer?.code ||
            '';

          if (sourceCode) return normalizeCode(sourceCode);
        }

        // 2b. Fallback to activity_progress
        const progressUrl = `${supabaseUrl}/rest/v1/activity_progress?user_id=ilike.${encodeURIComponent(userId)}&course_id=eq.${encodeURIComponent(getProgressCourseId(courseId))}&lesson_id=eq.${encodeURIComponent(lessonId)}&page_id=eq.${encodeURIComponent(pageId)}&task_id=eq.${encodeURIComponent(taskId)}&limit=1`;
        const progressRes = await fetch(progressUrl, { headers });
        if (progressRes.ok) {
          const pRows = await progressRes.json();
          const pRow = Array.isArray(pRows) ? pRows[0] : null;
          const pAnswer = pRow?.submitted_answer || pRow?.answer || pRow?.metadata;
          const sourceCode =
            pRow?.source_code ||
            pAnswer?.sourceCode ||
            pAnswer?.submittedCode ||
            pAnswer?.code ||
            '';
          if (sourceCode) return normalizeCode(sourceCode);
        }
      }
    } catch (sbErr) {
      console.warn('[IDE_PROGRAMMING_SUPABASE_FETCH_WARN]', sbErr);
    }
  }

  return null;
}

async function fetchAnswerKey({
  pageInstance,
  task,
  state,
}) {
  const localSource =
    getAnswerKeySourceFromObject(state?.ideProgramming) ||
    getAnswerKeySourceFromObject(task?.ideProgramming) ||
    getAnswerKeySourceFromObject(state) ||
    getAnswerKeySourceFromObject(task);

  if (localSource) {
    const localLanguage =
      getAnswerKeyLanguageFromObject(state?.ideProgramming) ||
      getAnswerKeyLanguageFromObject(task?.ideProgramming) ||
      getAnswerKeyLanguageFromObject(state) ||
      getAnswerKeyLanguageFromObject(task) ||
      'python';
    return {
      source: localSource,
      language: localLanguage,
    };
  }

  const checkMode =
    state?.ideProgramming?.checkMode ||
    task?.ideProgramming?.checkMode ||
    state?.checkMode ||
    task?.checkMode ||
    '';

  const initialCode =
    state?.ideProgramming?.initialCode ||
    task?.ideProgramming?.initialCode ||
    state?.initialCode ||
    task?.initialCode ||
    '';

  // For visual-only tasks, there's no grading solution required, so initialCode is the answer key.
  if (checkMode === 'visual-only' && initialCode) {
    const localLanguage =
      getAnswerKeyLanguageFromObject(state?.ideProgramming) ||
      getAnswerKeyLanguageFromObject(task?.ideProgramming) ||
      'python';
    return {
      source: initialCode,
      language: localLanguage,
    };
  }

  if (!API_BASE_URL) {
    throw new Error('Missing VITE_API_URL. Add VITE_API_URL=http://localhost:<backend-port> in .env.');
  }

  const taskId = getTaskId(task);
  const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance, task, state);

  if (!courseId || !lessonId || !pageId || !taskId) {
    throw new Error('Missing courseId, lessonId, pageId, or taskId.');
  }

  const endpoint = getAnswerKeyEndpoint(task, state);
  const url = new URL(
    endpoint.startsWith('http')
      ? endpoint
      : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
  );

  url.searchParams.set('courseId', courseId);
  url.searchParams.set('lessonId', lessonId);
  url.searchParams.set('pageId', pageId);
  url.searchParams.set('taskId', taskId);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    let payload = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      throw new Error(getBackendError(payload));
    }

    if (payload?.ok === false) {
      throw new Error(getBackendError(payload));
    }

    const parsed = extractAnswerKeyFromPayload(payload, taskId);

    if (!parsed.source) {
      throw new Error('Answer key not found for this task.');
    }

    return parsed;
  } catch (error) {
    if (initialCode) {
      const localLanguage =
        getAnswerKeyLanguageFromObject(state?.ideProgramming) ||
        getAnswerKeyLanguageFromObject(task?.ideProgramming) ||
        'python';
      return {
        source: initialCode,
        language: localLanguage,
      };
    }
    throw error;
  }
}

function getManualMapUrl(pageInstance, task) {
  return (
    pageInstance?.manualActivityMap?.url ||
    pageInstance?.manualActivityMapUrl ||
    task?.manualActivityMapUrl ||
    task?.activityMapUrl ||
    ''
  );
}

function findManualTask(manualMap, taskId) {
  if (!manualMap || !taskId) return null;

  if (manualMap?.tasks?.[taskId]) {
    return manualMap.tasks[taskId];
  }

  if (Array.isArray(manualMap?.tasks)) {
    return manualMap.tasks.find((item) => {
      const id = String(item?.id || item?.taskId || '').trim();
      return id === taskId;
    }) || null;
  }

  if (manualMap?.[taskId]) {
    return manualMap[taskId];
  }

  return null;
}

function findManualState(manualTask, stateId) {
  if (!manualTask || !stateId) return null;

  const states = manualTask.states;

  if (Array.isArray(states)) {
    return states.find((item) => {
      const id = String(item?.id || item?.stateId || '').trim();
      return id === stateId;
    }) || null;
  }

  if (states && typeof states === 'object') {
    const direct = states[stateId];

    if (direct) {
      return {
        id: direct?.id || direct?.stateId || stateId,
        stateId: direct?.stateId || direct?.id || stateId,
        ...direct,
      };
    }

    return Object.entries(states)
      .map(([id, value]) => ({
        id: value?.id || value?.stateId || id,
        stateId: value?.stateId || value?.id || id,
        ...value,
      }))
      .find((item) => {
        const id = String(item?.id || item?.stateId || '').trim();
        return id === stateId;
      }) || null;
  }

  return null;
}

function mergeIdeProgrammingOverride(task, state, manualTask) {
  if (!manualTask) {
    return { task, state, hasManualOverride: false };
  }

  const stateId = getStateId(state);
  const manualState = findManualState(manualTask, stateId);
  const manualIde = manualTask.ideProgramming || {};
  const manualStateIde = manualState?.ideProgramming || {};

  const mergedState = state
    ? {
        ...state,
        ...(manualState || {}),
        id: state.id || state.stateId || manualState?.id || manualState?.stateId,
        stateId: state.stateId || state.id || manualState?.stateId || manualState?.id,
        title:
          manualStateIde.title ||
          manualState?.title ||
          state?.title,
        selectedType:
          manualState?.selectedType ||
          state?.selectedType,
        ideProgramming: {
          ...(state?.ideProgramming || {}),
          ...manualStateIde,
        },
      }
    : state;

  const mergedTaskBase = {
    ...task,
    ...manualTask,
    id: task?.id || task?.taskId || manualTask?.id || manualTask?.taskId,
    taskId: task?.taskId || task?.id || manualTask?.taskId || manualTask?.id,
    selectedType: manualTask?.selectedType || task?.selectedType,
    title:
      manualIde.title ||
      manualTask?.title ||
      task?.title,
    description:
      manualIde.description ||
      manualTask?.description ||
      task?.description,
    question:
      manualIde.question ||
      manualTask?.question ||
      task?.question,
    instructions:
      manualIde.instructions ||
      manualTask?.instructions ||
      task?.instructions,
    tips:
      manualIde.tips ||
      manualTask?.tips ||
      task?.tips,
    ideProgramming: {
      ...(task?.ideProgramming || {}),
      ...manualIde,
    },
  };

  const mergedTask = {
    ...mergedTaskBase,
    states: mergedState ? [mergedState] : mergedTaskBase.states,
  };

  return {
    task: mergedTask,
    state: mergedState,
    hasManualOverride: true,
  };
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s+\n/g, '\n')
    .trim();
}

function getImageSrc(image) {
  if (!image) return '';

  if (typeof image === 'string') return image;

  return (
    image.localSrc ||
    image.publicSrc ||
    image.src ||
    image.url ||
    image.href ||
    image.path ||
    image.file ||
    image.filename ||
    image.screenshot ||
    image.preview ||
    image.image ||
    ''
  );
}

function normalizeImage(image) {
  const src = getImageSrc(image);

  if (!src) return null;

  return {
    src,
    alt: image?.alt || image?.title || '',
    width: image?.naturalWidth || image?.width || image?.rect?.w || 0,
    height: image?.naturalHeight || image?.height || image?.rect?.h || 0,
  };
}

function collectImagesFromSource(source, output = []) {
  if (!source || typeof source !== 'object') return output;

  const directCandidates = [
    source.image,
    source.previewImage,
    source.mainImage,
    source.preview,
  ];

  directCandidates.forEach((candidate) => {
    const image = normalizeImage(candidate);
    if (image) output.push(image);
  });

  const arrayKeys = [
    'images',
    'assets',
    'previews',
  ];

  arrayKeys.forEach((key) => {
    const value = source[key];

    if (!Array.isArray(value)) return;

    value.forEach((item) => {
      const image = normalizeImage(item);
      if (image) output.push(image);
    });
  });

  return output;
}

function getAllStates(task, state) {
  const states = [];

  if (state) states.push(state);

  if (Array.isArray(task?.states)) {
    task.states.forEach((item) => {
      if (item && item !== state) states.push(item);
    });
  }

  return states;
}

function getCaptureImages(task, state) {
  const images = [];

  collectImagesFromSource(task, images);
  collectImagesFromSource(task?.ideProgramming, images);
  collectImagesFromSource(task?.renderer?.ideProgramming, images);

  getAllStates(task, state).forEach((item) => {
    collectImagesFromSource(item, images);
    collectImagesFromSource(item?.ideProgramming, images);
    collectImagesFromSource(item?.renderer?.ideProgramming, images);
  });

  const seen = new Set();

  return images
    .filter((image) => {
      if (!image?.src) return false;

      const key = image.src;
      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const areaA = Number(a.width || 0) * Number(a.height || 0);
      const areaB = Number(b.width || 0) * Number(b.height || 0);

      return areaB - areaA;
    });
}

function collectStrings(value, output = [], depth = 0) {
  if (depth > 10 || value == null) return output;

  if (typeof value === 'string') {
    const text = stripHtml(value);
    if (text) output.push(text);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output, depth + 1));
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, output, depth + 1));
  }

  return output;
}

function getCodeFromSource(source) {
  if (!source) return '';

  const direct =
    source.initialCode ||
    source.code ||
    source.codeText ||
    source.startCode ||
    source.defaultCode ||
    source.placeholderCode ||
    '';

  if (direct) return normalizeCode(direct);

  if (Array.isArray(source.codeBlocks)) {
    const found = source.codeBlocks.find((block) => {
      const raw =
        block?.code ||
        block?.text ||
        block?.value ||
        block?.content ||
        block?.innerText ||
        block?.textContent ||
        '';

      return String(raw || '').trim();
    });

    if (found) {
      return normalizeCode(
        found.code ||
          found.text ||
          found.value ||
          found.content ||
          found.innerText ||
          found.textContent ||
          '',
      );
    }
  }

  return '';
}

function getInitialCode(task, state) {
  const sources = [
    task?.ideProgramming,
    state?.ideProgramming,
    task?.renderer?.ideProgramming,
    state?.renderer?.ideProgramming,
    state,
    task,
  ];

  for (const source of sources) {
    const code = getCodeFromSource(source);
    if (code) return code;
  }

  return '';
}

function getTitle(task, state) {
  return (
    task?.ideProgramming?.title ||
    state?.ideProgramming?.title ||
    task?.title ||
    state?.title ||
    'Write a program'
  );
}

function getQuestion(task, state) {
  return (
    task?.ideProgramming?.question ||
    state?.ideProgramming?.question ||
    task?.question ||
    state?.question ||
    ''
  );
}

function getInstructions(task, state) {
  const manualInstructions =
    task?.ideProgramming?.instructions ||
    state?.ideProgramming?.instructions ||
    task?.instructions ||
    state?.instructions ||
    [];

  if (Array.isArray(manualInstructions) && manualInstructions.length) {
    return manualInstructions.map(stripHtml).filter(Boolean);
  }

  if (typeof manualInstructions === 'string' && manualInstructions.trim()) {
    return [stripHtml(manualInstructions)];
  }

  const strings = collectStrings({
    taskPrompt: task?.prompt,
    statePrompt: state?.prompt,
    description: task?.description || state?.description,
    question: getQuestion(task, state),
  });

  return strings.filter(Boolean);
}

function normalizeTip(tip) {
  if (typeof tip === 'string') {
    const text = stripHtml(tip);
    const [title, ...bodyLines] = text.split('\n');

    return {
      title: title || '',
      body: bodyLines.join('\n').trim(),
      image: '',
    };
  }

  if (tip && typeof tip === 'object') {
    const title = stripHtml(tip.title || tip.heading || tip.name || '');
    const body = stripHtml(tip.body || tip.text || tip.description || tip.content || '');
    const image = getImageSrc(
      tip.image ||
        tip.screenshot ||
        tip.previewImage ||
        tip.captureImage ||
        tip.mainImage ||
        tip.preview ||
        '',
    );

    return {
      title,
      body,
      image,
    };
  }

  return null;
}

function getTips(task, state) {
  const tips =
    task?.ideProgramming?.tips ||
    state?.ideProgramming?.tips ||
    task?.tips ||
    state?.tips ||
    [];

  if (Array.isArray(tips)) {
    return tips.map(normalizeTip).filter(Boolean);
  }

  if (typeof tips === 'string' && tips.trim()) {
    return [normalizeTip(tips)].filter(Boolean);
  }

  return [];
}

function getLineCount(value) {
  return Math.max(1, String(value || '').split('\n').length);
}

function tokenizePythonLine(line) {
  return (
    String(line).match(
      /(#.*$)|("(?:\\.|[^"])*"|'(?:\\.|[^'])*')|(\s+)|([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|(==|!=|<=|>=|\+=|-=|\*=|\/=|\/\/=|\*\*=|[+\-*/%=<>])|([()[\]{},.:])|(\S)/g,
    ) || []
  );
}

function getTokenClass(token, nextToken = '') {
  if (/^\s+$/.test(token)) return '';
  if (/^#/.test(token)) return 'comment';
  if (/^(['"]).*\1$/.test(token)) return 'string';
  if (/^\d+(\.\d+)?$/.test(token)) return 'number';
  if (PYTHON_KEYWORDS.has(token)) return 'keyword';
  if (PYTHON_BUILTINS.has(token) || nextToken === '(') return 'builtin';
  if (/^(==|!=|<=|>=|\+=|-=|\*=|\/=|\/\/=|\*\*=|[+\-*/%=<>])$/.test(token)) return 'operator';
  if (/^[()[\]{},.:]$/.test(token)) return 'punctuation';
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) return 'variable';
  return '';
}

function renderHighlightedTokens(line, lineIndex, keyPrefix = 'line') {
  const tokens = tokenizePythonLine(line);

  return tokens.map((token, index) => {
    const className = getTokenClass(token, tokens[index + 1] || '');

    if (!className) {
      return <span key={`${keyPrefix}-${lineIndex}-${index}`}>{token}</span>;
    }

    return (
      <span key={`${keyPrefix}-${lineIndex}-${index}`} className={`ide-token ${className}`}>
        {token}
      </span>
    );
  });
}

function renderHighlightedLine(line, lineIndex) {
  return (
    <div key={lineIndex} className="ide-code-line">
      {renderHighlightedTokens(line, lineIndex, 'editor')}
    </div>
  );
}

function renderAnswerKeyLine(line, lineIndex) {
  return (
    <div key={`answer-key-${lineIndex}`} className="ide-answer-key-line">
      <span className="ide-answer-key-line-number">{lineIndex + 1}</span>
      <span className="ide-answer-key-line-code">
        {renderHighlightedTokens(line, lineIndex, 'answer-key')}
      </span>
    </div>
  );
}

export default function IdeProgrammingTask({
  task,
  state,
  pageInstance,
  onPrevTask,
  onNextTask,
  onPrevState,
  onNextState,
  onTaskComplete,
  onTaskCompleted,
}) {
  const taskId = getTaskId(task);
  const [manualTaskConfig, setManualTaskConfig] = useState(null);

  useEffect(() => {
    const manualMapUrl = getManualMapUrl(pageInstance, task);

    if (!manualMapUrl || !taskId) {
      setManualTaskConfig(null);
      return undefined;
    }

    let cancelled = false;

    fetch(`${manualMapUrl}?t=${Date.now()}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((manualMap) => {
        if (cancelled) return;
        setManualTaskConfig(findManualTask(manualMap, taskId));
      })
      .catch(() => {
        if (!cancelled) setManualTaskConfig(null);
      });

    return () => {
      cancelled = true;
    };
  }, [pageInstance, task, taskId]);

  const {
    task: effectiveTask,
    state: effectiveState,
  } = useMemo(
    () => mergeIdeProgrammingOverride(task, state, manualTaskConfig),
    [task, state, manualTaskConfig],
  );

  const title = useMemo(() => getTitle(effectiveTask, effectiveState), [effectiveTask, effectiveState]);
  const question = useMemo(() => getQuestion(effectiveTask, effectiveState), [effectiveTask, effectiveState]);
  const instructions = useMemo(() => getInstructions(effectiveTask, effectiveState), [effectiveTask, effectiveState]);
  const tips = useMemo(() => getTips(effectiveTask, effectiveState), [effectiveTask, effectiveState]);
  const secondaryImage = useMemo(() => {
    const candidate =
      effectiveState?.ideProgramming?.secondaryImage ??
      effectiveTask?.ideProgramming?.secondaryImage ??
      effectiveState?.secondaryImage ??
      effectiveTask?.secondaryImage ??
      effectiveState?.ideProgramming?.outputImage ??
      effectiveTask?.ideProgramming?.outputImage ??
      '';

    const normalized = normalizeImage(candidate);
    return normalized?.src ? normalized.src : (typeof candidate === 'string' && candidate.trim() ? candidate : null);
  }, [effectiveTask, effectiveState]);
  const captureImages = useMemo(() => {
    const originalImages = getCaptureImages(task, state);
    if (originalImages.length > 0) return originalImages;

    return getCaptureImages(effectiveTask, effectiveState);
  }, [task, state, effectiveTask, effectiveState]);

  // Optional per-task preview override.
  // Existing tasks keep using the captured mainImage exactly as before.
  const customPreviewImage = useMemo(() => {
    const candidate =
      effectiveState?.ideProgramming?.taskPreviewImage ??
      effectiveTask?.ideProgramming?.taskPreviewImage ??
      effectiveState?.taskPreviewImage ??
      effectiveTask?.taskPreviewImage ??
      '';

    const normalized = normalizeImage(candidate);
    return normalized?.src ? normalized : null;
  }, [effectiveTask, effectiveState]);

  const initialCode = useMemo(() => getInitialCode(effectiveTask, effectiveState), [effectiveTask, effectiveState]);

  const effectiveTaskId = getTaskId(effectiveTask);

  const studentEmail = useMemo(() => {
    return String(
      (typeof window !== 'undefined'
        ? sessionStorage.getItem('lms_student_email') || localStorage.getItem('lms_student_email')
        : '') ||
      task?.userId ||
      pageInstance?.userId ||
      ''
    ).trim().toLowerCase();
  }, [task, pageInstance]);

  // Đổi từ :ide-code-v4 sang :ide-code-v5 và gắn kèm studentEmail
  const storageKey = useMemo(() => {
    return `${studentEmail || 'anon'}:${effectiveTaskId}:${effectiveState?.id || effectiveState?.stateId || 'main'}:ide-code-v5`;
  }, [studentEmail, effectiveTaskId, effectiveState]);

  const saved = useMemo(() => loadLocalTaskState(storageKey, null), [storageKey]);

  const [code, setCode] = useState(() => saved?.code ?? initialCode);

  const hasGraphics = useMemo(() => {
    const codeStr = String(code || '');
    return /\bimport\s+(turtle|pygame)\b/.test(codeStr) || /\bfrom\s+(turtle|pygame)\b/.test(codeStr);
  }, [code]);

  const [status, setStatus] = useState(() => saved?.status || '');
  const [output, setOutput] = useState(() => saved?.output || '');
  const [isRunning, setIsRunning] = useState(false);
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [stdinValue, setStdinValue] = useState('');
  const [isWaitingForInput, setIsWaitingForInput] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [isTaskOpen, setIsTaskOpen] = useState(true);
  const [isAnswerKeyOpen, setIsAnswerKeyOpen] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && zoomedImage) {
        setZoomedImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedImage]);
  const [isLoadingAnswerKey, setIsLoadingAnswerKey] = useState(false);
  const [answerKeySource, setAnswerKeySource] = useState('');
  const [answerKeyLanguage, setAnswerKeyLanguage] = useState('python');
  const [answerKeyError, setAnswerKeyError] = useState('');
  const [openTips, setOpenTips] = useState(() => new Set());
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [copiedAnswerKey, setCopiedAnswerKey] = useState(false);

  const editorRef = useRef(null);
  const highlightRef = useRef(null);
  const lineNumbersRef = useRef(null);
  const undoStackRef = useRef([]);
  const stdinResolverRef = useRef(null);
  const stdinInputRef = useRef(null);
  const outputBufferRef = useRef(saved?.output || '');
  const codeRef = useRef(code);
  codeRef.current = code;

  const nextAction = onNextState || onNextTask;
  const prevAction = onPrevState || onPrevTask;

  useEffect(() => {
    let isCancelled = false;
    const nextSaved = loadLocalTaskState(storageKey, null);

    setCode(nextSaved?.code ?? initialCode);
    setStatus(nextSaved?.status || '');
    setOutput(nextSaved?.output || '');
    outputBufferRef.current = nextSaved?.output || '';
    setStdinValue('');
    setIsWaitingForInput(false);
    setAnswerKeySource('');
    setAnswerKeyLanguage('python');
    setAnswerKeyError('');
    setIsAnswerKeyOpen(false);
    stdinResolverRef.current = null;
    undoStackRef.current = [];

    fetchSavedIdeSource({
      pageInstance,
      task: effectiveTask,
      state: effectiveState,
    })
      .then((remoteCode) => {
        if (!isCancelled && remoteCode) {
          setCode(remoteCode);
          saveLocalTaskState(storageKey, {
            code: remoteCode,
            status: nextSaved?.status || '',
            output: nextSaved?.output || '',
          });
        }
      })
      .catch(() => {
        // Ignore network failure when offline / API unavailable
      });

    return () => {
      isCancelled = true;
    };
  }, [storageKey, initialCode, pageInstance, effectiveTask, effectiveState]);

  useEffect(() => {
    saveLocalTaskState(storageKey, {
      code,
      status,
      output,
    });
  }, [storageKey, code, status, output]);



  function syncScroll(event) {
    const scrollTop = event.currentTarget.scrollTop;
    const scrollLeft = event.currentTarget.scrollLeft;

    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }

    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = scrollTop;
    }
  }

  function updateCode(nextCode) {
    undoStackRef.current.push(code);

    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }

    setCode(nextCode);
    setStatus('');
  }

  function undo() {
    const previous = undoStackRef.current.pop();

    if (previous == null) return;

    setCode(previous);
    setStatus('Undo applied.');
    editorRef.current?.focus();
  }

  function reset() {
    undoStackRef.current.push(code);
    setCode(initialCode);
    setTerminalOutput('');
    setStatus('');
    setStdinValue('');
    setIsWaitingForInput(false);
    stdinResolverRef.current = null;
    editorRef.current?.focus();
  }

  async function save() {
    if (isRunning || isSavingSource || isWaitingForInput) return;

    setIsSavingSource(true);
    setStatus('Saving source...');

    try {
      await submitIdeSource({
        pageInstance,
        task: effectiveTask,
        state: effectiveState,
        code,
        runtimeStatus: 'saved',
      });

      setStatus('Source saved.');

      onTaskCompleted?.({
        completionType: 'submitted',
        needsReview: true,
        feedback: 'Source code submitted.',
        metadata: {
          language:
            effectiveTask?.ideProgramming?.language ||
            effectiveTask?.language ||
            'python',
          sourceCode: code,
          submitAction: 'save-source',
        },
      });
    } catch (error) {
      console.error('[IDE_PROGRAMMING_SAVE_BUTTON_ERROR]', error);
      setStatus(`Source not saved: ${error?.message || 'Save failed.'}`);
    } finally {
      setIsSavingSource(false);
      editorRef.current?.focus();
    }
  }

  function setTerminalOutput(value) {
    outputBufferRef.current = String(value || '');
    setOutput(outputBufferRef.current);
  }

  function appendTerminalOutput(value) {
    outputBufferRef.current += String(value || '');
    setOutput(outputBufferRef.current);
  }

  function requestTerminalInput(promptText = '') {
    if (promptText) {
      appendTerminalOutput(promptText);
    }

    setStdinValue('');
    setIsWaitingForInput(true);

    window.requestAnimationFrame(() => {
      stdinInputRef.current?.focus();
    });

    return new Promise((resolve) => {
      stdinResolverRef.current = resolve;
    });
  }

  function submitTerminalInput() {
    if (!stdinResolverRef.current) return;

    const value = String(stdinValue ?? '');
    const resolve = stdinResolverRef.current;

    stdinResolverRef.current = null;
    setIsWaitingForInput(false);
    setStdinValue('');
    appendTerminalOutput(`${value}\n`);
    resolve(value);
  }

  async function executePythonInTerminal() {
    setTerminalOutput('');

    const { courseId, lessonId, pageId } = getRuntimeIds(pageInstance, effectiveTask, effectiveState);
    const pageBaseUrl = (courseId && lessonId && pageId)
      ? `/courses/${courseId}/${lessonId}/pages/${pageId}`
      : '';

    const result = await runPythonCode(code, {
      inputProvider: requestTerminalInput,
      onOutput: appendTerminalOutput,
      timeoutMs: getPythonTimeoutMs(effectiveTask, effectiveState),
      pageBaseUrl,
    });

    if (!outputBufferRef.current && !result.stderr) {
      setTerminalOutput('(no output)');
    } else if (result.stderr) {
      appendTerminalOutput(`\n${result.stderr}`);
    }

    return result;
  }

  async function saveSourceAfterRun(runtimeStatus) {
    setIsSavingSource(true);

    try {
      await submitIdeSource({
        pageInstance,
        task: effectiveTask,
        state: effectiveState,
        code,
        runtimeStatus,
      });

      return true;
    } catch (error) {
      console.error('[IDE_PROGRAMMING_SAVE_SOURCE_ERROR]', error);
      setStatus(`Program ran. Source not saved: ${error?.message || 'Save failed.'}`);
      return false;
    } finally {
      setIsSavingSource(false);
    }
  }

  async function run() {
    if (isRunning || isSavingSource || isWaitingForInput) return;

    setIsRunning(true);
    setStatus('Running...');

    try {
      const result = await executePythonInTerminal();
      const runtimeStatus = result.ok ? 'ran' : 'runtime_error';
      const savedToBackend = await saveSourceAfterRun(runtimeStatus);

      if (savedToBackend) {
        setStatus(result.ok ? 'Program ran. Source saved.' : 'Runtime error. Source saved.');
      }
    } catch (error) {
      setTerminalOutput(error?.message || 'Python runtime failed.');
      const savedToBackend = await saveSourceAfterRun('runtime_error');

      if (savedToBackend) {
        setStatus('Runtime error. Source saved.');
      }
    } finally {
      setIsRunning(false);
      editorRef.current?.focus();
    }
  }

  async function toggleAnswerKey() {
    if (isAnswerKeyOpen) {
      setIsAnswerKeyOpen(false);
      return;
    }

    setIsAnswerKeyOpen(true);

    if (answerKeySource || answerKeyError || isLoadingAnswerKey) {
      return;
    }

    setIsLoadingAnswerKey(true);
    setAnswerKeyError('');

    try {
      const parsed = await fetchAnswerKey({
        pageInstance,
        task: effectiveTask,
        state: effectiveState,
      });

      setAnswerKeySource(parsed.source || '');
      setAnswerKeyLanguage(parsed.language || 'python');
    } catch (error) {
      console.error('[IDE_PROGRAMMING_ANSWER_KEY_ERROR]', error);
      setAnswerKeyError(error?.message || 'Could not load answer key.');
    } finally {
      setIsLoadingAnswerKey(false);
    }
  }

  function copyAnswerKeyToClipboard() {
    if (!answerKeySource) return;
    
    navigator.clipboard.writeText(answerKeySource)
      .then(() => {
        setCopiedAnswerKey(true);
        setTimeout(() => setCopiedAnswerKey(false), 2000);
      })
      .catch((err) => {
        console.error('Failed to copy answer key:', err);
      });
  }

  function handleKeyDown(event) {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (event.key === 'Tab') {
      event.preventDefault();
      const nextCode = code.slice(0, start) + '    ' + code.slice(end);
      updateCode(nextCode);
      window.requestAnimationFrame(() => {
        textarea.selectionStart = start + 4;
        textarea.selectionEnd = start + 4;
      });
      return;
    }

    const autoClosePairs = {
      '"': '"',
      "'": "'",
      '(': ')',
      '[': ']',
      '{': '}',
    };

    if (autoClosePairs[event.key] !== undefined) {
      event.preventDefault();
      const char = event.key;
      const closeChar = autoClosePairs[char];

      if (start !== end) {
        // Wrap selected text
        const selectedText = code.slice(start, end);
        const nextCode =
          code.slice(0, start) +
          char +
          selectedText +
          closeChar +
          code.slice(end);

        updateCode(nextCode);

        window.requestAnimationFrame(() => {
          textarea.selectionStart = start + 1;
          textarea.selectionEnd = end + 1;
        });
      } else {
        // Skip quote if it is already there
        if ((char === '"' || char === "'") && code[start] === char) {
          window.requestAnimationFrame(() => {
            textarea.selectionStart = start + 1;
            textarea.selectionEnd = start + 1;
          });
          return;
        }

        const nextCode =
          code.slice(0, start) +
          char +
          closeChar +
          code.slice(end);

        updateCode(nextCode);

        window.requestAnimationFrame(() => {
          textarea.selectionStart = start + 1;
          textarea.selectionEnd = start + 1;
        });
      }
      return;
    }

    const skipChars = new Set([')', ']', '}']);
    if (skipChars.has(event.key)) {
      if (start === end && code[start] === event.key) {
        event.preventDefault();
        textarea.selectionStart = start + 1;
        textarea.selectionEnd = start + 1;
        return;
      }
    }
  }

  function toggleTip(index) {
    setOpenTips((current) => {
      const next = new Set(current);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  }

  const visibleLineCount = Math.max(getLineCount(code), getLineCount(initialCode), 22);
  const lineNumbers = Array.from({ length: visibleLineCount }, (_, index) => index + 1);
  const highlightedLines = String(code || '').split('\n');
  const answerKeyLines = String(answerKeySource || '').split('\n');
  const mainImage = captureImages[0];

  return (
    <>
      <style>{EMBEDDED_STYLES}</style>

      <LmsActivityFrame
        title={title}
        onPrevTask={prevAction}
        onNextTask={nextAction}
        onReset={reset}
        isResetDisabled={isRunning || isSavingSource || isWaitingForInput}
        onCheck={() => {
          setShowConfirmModal(true);
        }}
        isCheckDisabled={isRunning || isSavingSource || isWaitingForInput}
        isCheckLoading={isSavingSource}
      >
        <section
          className={[
            'ide-programming-task',
            isRightCollapsed ? 'is-right-collapsed' : '',
            isFullscreen ? 'is-fullscreen' : '',
            isDark ? 'is-dark' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="ide-programming-left">
            <div className="ide-programming-toolbar">
              <button
                type="button"
                className="ide-toolbar-button"
                onClick={run}
                title="Run"
                disabled={isRunning || isSavingSource || isWaitingForInput}
              >
                {isRunning || isSavingSource ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )}
              </button>

              <button
                type="button"
                className="ide-toolbar-button"
                onClick={save}
                title="Save / Lưu bài"
                disabled={isRunning || isSavingSource || isWaitingForInput}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
              </button>

              <button type="button" className="ide-toolbar-button" onClick={undo} title="Undo">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14 4 9l5-5"/>
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
                </svg>
              </button>

              <button
                type="button"
                className="ide-toolbar-button"
                onClick={() => setIsDark((current) => !current)}
                title="Toggle theme"
              >
                {isDark ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                  </svg>
                )}
              </button>
            </div>

            <div className="ide-programming-editor-wrap">
              <div ref={lineNumbersRef} className="ide-line-numbers" aria-hidden="true">
                {lineNumbers.map((lineNumber) => (
                  <span key={lineNumber} className="ide-line-number">
                    {lineNumber}
                  </span>
                ))}
              </div>

              <div className="ide-code-layer">
                <pre ref={highlightRef} className="ide-code-highlight" aria-hidden="true">
                  {highlightedLines.map(renderHighlightedLine)}
                </pre>

                <textarea
                  ref={editorRef}
                  className="ide-code-textarea"
                  value={code}
                  onChange={(event) => {
                    updateCode(event.target.value.replace(/\r/g, '').replace(/[\u200B-\u200D\uFEFF\u00AD]/g, ''));
                  }}
                  onKeyDown={handleKeyDown}
                  onScroll={syncScroll}
                  rows={visibleLineCount}
                  placeholder="# Write your code here"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                />
              </div>
            </div>

            {(output || isWaitingForInput || hasGraphics) && (
              <div className="ide-output-panel">
                <strong>Output</strong>
                <div 
                  id="turtle-canvas-container" 
                  className="ide-turtle-canvas"
                  style={{
                    display: hasGraphics ? 'block' : 'none',
                    margin: '12px 0',
                    background: '#ffffff',
                    border: '1px solid #d5dae2',
                    borderRadius: '8px',
                    padding: '8px',
                    textAlign: 'center',
                    overflow: 'auto'
                  }}
                />
                <pre className="ide-output-terminal">
                  <span>{output}</span>
                  {isWaitingForInput ? (
                    <input
                      ref={stdinInputRef}
                      className="ide-stdin-input"
                      value={stdinValue}
                      onChange={(event) => setStdinValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          submitTerminalInput();
                        }
                      }}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      autoComplete="off"
                    />
                  ) : null}
                </pre>
              </div>
            )}
          </div>

          <div className="ide-programming-splitter">
            <button
              type="button"
              className="ide-splitter-button"
              onClick={() => setIsRightCollapsed((current) => !current)}
              title={isRightCollapsed ? 'Show task panel' : 'Hide task panel'}
            >
              ▸
            </button>
          </div>

          <aside className="ide-programming-right">
            <h1 className="ide-side-title">{title}</h1>
            <div className="ide-side-divider" />

            <p className="ide-side-section-label">Programming Task</p>

            <div className="ide-instruction-card">
              <button
                type="button"
                className="ide-card-header"
                onClick={() => setIsTaskOpen((current) => !current)}
              >
                <strong>{question || title}</strong>
                <span className="ide-card-chevron">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isTaskOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </span>
              </button>

              {isTaskOpen && (
                <div className="ide-card-body">
                  {customPreviewImage ? (
                    <div className="ide-task-preview-image">
                      <img
                        src={customPreviewImage.src}
                        alt={customPreviewImage.alt || question || title}
                        onClick={() => setZoomedImage(customPreviewImage.src)}
                        title="Click to zoom in"
                      />
                    </div>
                  ) : mainImage ? (
                    <div className="ide-task-preview-image">
                      <img
                        src={mainImage.src}
                        alt={mainImage.alt || title}
                        onClick={() => setZoomedImage(mainImage.src)}
                        title="Click to zoom in"
                      />
                    </div>
                  ) : null}

                  {instructions.length > 0 ? (
                    instructions.map((item, index) => (
                      <p key={`${item}-${index}`}>{item}</p>
                    ))
                  ) : !customPreviewImage && !mainImage ? (
                    <p>No captured instruction image was found for this task.</p>
                  ) : null}

                  {secondaryImage ? (
                    <div className="ide-task-preview-image" style={{ marginTop: '16px' }}>
                      <img
                        src={secondaryImage}
                        alt="Expected output"
                        onClick={() => setZoomedImage(secondaryImage)}
                        title="Click to zoom in"
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {(() => {
              const userRole = localStorage.getItem('lms_user_role') || 'student';
              if (userRole === 'student') return null;
              
              return (
                <div className="ide-answer-key-card">
                  <button
                    type="button"
                    className="ide-card-header"
                    onClick={toggleAnswerKey}
                    disabled={isLoadingAnswerKey}
                  >
                    <strong>Answer Key</strong>
                    <span className="ide-card-chevron">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isAnswerKeyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>
                        <path d="m6 9 6 6 6-6"/>
                      </svg>
                    </span>
                  </button>

                  {isAnswerKeyOpen && (
                    <div className="ide-card-body">
                      {isLoadingAnswerKey ? (
                        <p>Loading answer key...</p>
                      ) : answerKeyError ? (
                        <p className="ide-answer-key-error">{answerKeyError}</p>
                      ) : answerKeySource ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', marginBottom: '8px' }}>
                            <p className="ide-status-note" style={{ margin: 0 }}>Language: {answerKeyLanguage || 'python'}</p>
                            <button
                              type="button"
                              onClick={copyAnswerKeyToClipboard}
                              className="ide-toolbar-button"
                              style={{
                                padding: '4px 8px',
                                fontSize: '12px',
                                height: 'auto',
                                minHeight: '28px',
                                borderRadius: '6px',
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                color: '#475569',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                              </svg>
                              <span>{copiedAnswerKey ? 'Copied!' : 'Copy'}</span>
                            </button>
                          </div>
                          <pre className="ide-answer-key-code">
                            {answerKeyLines.map(renderAnswerKeyLine)}
                          </pre>
                        </>
                      ) : (
                        <p className="ide-answer-key-empty">Answer key not found for this task.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {tips.length > 0 && (
              <>
                <p className="ide-side-section-label">Tips</p>

                {tips.map((tip, index) => {
                  const isOpen = openTips.has(index);

                  return (
                    <div key={`${tip.title || tip.body || index}-${index}`} className="ide-tip-card">
                      <button
                        type="button"
                        className="ide-card-header"
                        onClick={() => toggleTip(index)}
                      >
                        <strong>{tip.title}</strong>
                        <span className="ide-card-chevron">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>
                            <path d="m6 9 6 6 6-6"/>
                          </svg>
                        </span>
                      </button>

                      {isOpen && (
                        <div className="ide-card-body">
                          {tip.image && (
                            <div className="ide-task-preview-image">
                              <img
                                src={tip.image}
                                alt={tip.title || 'Tip image'}
                                onClick={() => setZoomedImage(tip.image)}
                                title="Click to zoom in"
                              />
                            </div>
                          )}

                          {tip.body && <p>{tip.body}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </aside>
        </section>
      </LmsActivityFrame>

      {/* CUSTOM CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="lms-badge-unlock" role="dialog" aria-modal="true">
          <div className="lms-badge-unlock__card">
            <span className="lms-badge-unlock__eyebrow">
              ONE LAST CHECK!
            </span>

            <div
              className="lms-badge-unlock__medal"
              style={{
                background: 'linear-gradient(145deg, #fbbf24, #f59e0b)',
                boxShadow: '0 13px 27px rgba(245, 158, 11, 0.34), inset 0 4px 0 rgba(255, 255, 255, 0.28)',
                borderColor: '#fde68a',
              }}
              aria-hidden="true"
            >
              <span>?</span>
            </div>

            <h2>Do the outputs match?</h2>
            <p>
              Compare <strong>Your Output</strong> with the <strong>Expected Output</strong>.
              <br />
              <br />
              If they look the same, you’re ready to finish.
              <br />
              Not sure? Ask your teacher for help.
            </p>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'center', alignItems: 'center' }}>
              <button
                type="button"
                className="lms-badge-unlock__name"
                style={{ cursor: 'pointer', margin: 0, minHeight: '42px', minWidth: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setShowConfirmModal(false)}
              >
                Check Again
              </button>
              <button
                type="button"
                style={{ margin: 0, minWidth: '150px' }}
                onClick={() => {
                  setShowConfirmModal(false);
                  save();
                  submitIdeSource({
                    pageInstance,
                    task: effectiveTask,
                    state: effectiveState,
                    code,
                    runtimeStatus: 'ran',
                    action: 'submit',
                    isCorrect: true,
                  }).catch((e) => console.error('Failed to submit IDE completion:', e));

                  const completePayload = {
                    taskId,
                    activityType: 'ide-programming',
                    isCorrect: true,
                    score: 1,
                    maxScore: 1,
                    feedback: 'Correct',
                    metadata: { code },
                  };
                  if (typeof onTaskComplete === 'function') {
                    onTaskComplete(completePayload);
                  }
                  if (typeof onTaskCompleted === 'function') {
                    onTaskCompleted(completePayload);
                  }
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('LMS_TASK_COMPLETED', {
                        detail: { taskId: effectiveTaskId || taskId },
                      })
                    );
                  }
                }}
              >
                Yes, They Match!
              </button>
            </div>
          </div>
        </div>
      )}

      {zoomedImage && (
        <div
          className="ide-image-zoom-overlay"
          onClick={() => setZoomedImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            cursor: 'zoom-out',
          }}
        >
          <div
            className="ide-image-zoom-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setZoomedImage(null)}
              style={{
                position: 'absolute',
                top: '-16px',
                right: '-16px',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#ffffff',
                color: '#1e293b',
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                fontSize: '18px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
              }}
              title="Close (Esc)"
            >
              ✕
            </button>
            <img
              src={zoomedImage}
              alt="Enlarged view"
              style={{
                maxWidth: '90vw',
                maxHeight: '85vh',
                borderRadius: '12px',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                objectFit: 'contain',
                background: '#ffffff',
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}