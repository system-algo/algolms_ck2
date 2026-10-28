// Presentation only. Official correctness comes from the backend grading result,
// never from the words "saved" or "correct" embedded in a longer error message.
export function getLmsBannerDetails(statusText, statusVariant) {
  if (!statusText) return null;
  const message = String(statusText).trim();
  if (!message) return null;
  const lower = message.toLowerCase();

  const needsAnswer = [
    'choose an answer', 'pick an answer', 'select an answer',
    'chưa chọn', 'chọn đáp án', 'choose your answer', 'enter a link',
    'submit the answer', 'submit answer', 'please place all',
    'please complete all',
  ].some((phrase) => lower.includes(phrase));

  const negative = needsAnswer || [
    'incorrect', 'not correct', 'wrong', 'not saved', 'could not',
    'failed', 'failure', 'missing', 'try again', 'not synced',
    'not sync', 'server marked', 'does not match', 'mistake',
    'please report', 'error', 'incomplete',
  ].some((phrase) => lower.includes(phrase));

  const checking =
    lower === 'checking' || lower.startsWith('checking') ||
    lower.startsWith('saving') || lower.startsWith('submitting');

  const success = !negative && (
    /\bcorrect\b/.test(lower) ||
    lower.includes('đúng') ||
    lower.includes('completed') ||
    lower.includes('hoàn thành') ||
    lower.includes('great job') ||
    lower.includes('you got it') ||
    lower.includes('saved') ||
    lower.includes('viewed')
  );

  const type =
    statusVariant === 'error' || statusVariant === 'checking' || statusVariant === 'success'
      ? statusVariant
      : checking ? 'checking' : negative ? 'error' : success ? 'success' : 'error';

  if (type === 'checking') {
    return {
      type,
      isSuccess: false,
      title: 'Let’s see... 👀',
      description: message,
    };
  }
  if (type === 'success') {
    return {
      type,
      isSuccess: true,
      title: 'Great job! 🎉',
      description: /^(correct[.!]?|you got it[.!]?)$/i.test(message)
        ? '✓ You got it!'
        : message.startsWith('✓') ? message : `✓ ${message}`,
    };
  }
  return {
    type: 'error',
    isSuccess: false,
    title: 'Almost there! 🌟',
    description: message.startsWith('✕') ? message : `✕ ${message}`,
  };
}
