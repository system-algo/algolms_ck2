export const LMS_SOUND_EVENT =
  'algo:lms-sound';

export const LMS_SOUND_TYPES = Object.freeze({
  COMPLETE_SERIES: 'complete-series',
  COMPLETE_ACTIVITY: 'complete-activity',
  NEW_BADGE: 'new-badge',
  COMPLETE_LESSON: 'complete-lesson',
  EARN_POINTS: 'earn-points',
  NOTIFICATION: 'notification',
});

const VALID_SOUND_TYPES = new Set(
  Object.values(LMS_SOUND_TYPES),
);

export function playLmsSound(
  type,
  detail = {},
) {
  if (
    typeof window === 'undefined' ||
    window.__LMS_MUTE_SOUNDS__ ||
    !VALID_SOUND_TYPES.has(type)
  ) {
    return false;
  }

  window.dispatchEvent(
    new CustomEvent(LMS_SOUND_EVENT, {
      detail: {
        ...detail,
        type,
      },
    }),
  );

  return true;
}
