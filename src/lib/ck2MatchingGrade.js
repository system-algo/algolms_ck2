// Official backend grading is the single source of truth for CK2 matching.
// An HTTP 201 / ok:true means the attempt was saved, NOT necessarily correct.
export function classifyMatchingAttempt(saved) {
  if (saved?.ok !== true) return 'save-error';

  const result = saved?.result || {};
  if (result.isCorrect === true && result.status === 'correct') return 'correct';
  if (result.status === 'missing_answer_key') return 'missing-answer-key';
  if (
    result.isCorrect === false ||
    result.status === 'incorrect' ||
    result.status === 'incomplete'
  ) return 'wrong';
  return 'grading-unavailable';
}

export function getWrongMatchingPairIds(saved) {
  const ids = saved?.result?.details?.wrongIds;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
}
