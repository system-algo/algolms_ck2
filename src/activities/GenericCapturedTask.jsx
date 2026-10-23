import { useEffect, useMemo, useState } from 'react';
import StateReplay from '../components/StateReplay.jsx';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  cleanTextLines,
  getPrimaryState,
  getUniqueImages,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';

function shouldUseReplay(task, state, rawMode, forceReplay, lines, images) {
  const type = String(task?.activityType || '').toLowerCase();

  if (forceReplay || rawMode) return true;

  /*
    Các task dynamic không được render bằng generic text.
    Nếu render bằng generic text sẽ bị lộ rác capture:
    - CSS selector
    - timestamp
    - DOM path
    - text option bị dàn sai layout
  */
  if (type === 'code_typing_task') return true;
  if (type === 'matching_dragdrop_task') return true;

  if (!lines.length && !images.length) return true;

  return false;
}

export default function GenericCapturedTask(props) {
  const {
    task,
    state,
    stateIndex,
    rawMode,
    forceReplay,
    onNextState,
    onPrevState,
    onSelectState,
    onPrevTask,
    onNextTask,
    isTaskDone,
    completedTaskIds,
  } = props;

  const primaryState = useMemo(() => getPrimaryState(task), [task]);
  const currentState = state || primaryState;

  const taskId = String(task?.id || task?.taskId || 'generic-task').trim();
  const [localCompleted, setLocalCompleted] = useState(false);
  const isAlreadyDone =
    localCompleted ||
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));

  useEffect(() => {
    if (!taskId) return;
    saveLocalTaskState(taskId, { viewed: true });
    // Note: LMS_TASK_COMPLETED is dispatched only when user clicks Check (handleCheck),
    // so the progress celebration triggers at the right moment.
  }, [taskId, task]);

  const lines = useMemo(
    () => cleanTextLines(currentState?.textLines || []),
    [currentState],
  );

  const images = useMemo(() => getUniqueImages(task), [task]);



  if (shouldUseReplay(task, currentState, rawMode, forceReplay, lines, images)) {
    return (
      <StateReplay
        task={task}
        state={currentState}
        stateIndex={stateIndex}
        rawMode={rawMode}
        onNext={onNextState}
        onPrev={onPrevState}
        onSelectState={onSelectState}
      />
    );
  }

  const title = lines[0] || task.title || 'Activity';
  const bodyLines = lines.slice(1);

  function handleCheck() {
    if (!isAlreadyDone) {
      setLocalCompleted(true);
      import('../utils/lmsSounds.js')
        .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
          playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
        })
        .catch(() => {});

      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || task?.taskId },
        })
      );
    }

    if (onNextTask) {
      onNextTask();
    }
  }

  function handleReset() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <LmsActivityFrame
      title={title}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleCheck}
      onReset={handleReset}
      status="Static content rendered from capture data."
      isTaskDone={isTaskDone}
    >
      <article className="functional-card generic-card">
        <h1>{title}</h1>

        {bodyLines.map((line, index) => (
          <p key={`${line}-${index}`}>{line}</p>
        ))}

        {images.length > 0 && (
          <div className="generic-image-grid">
            {images.map((image) => (
              <img key={image.src} src={image.src} alt={image.alt || ''} />
            ))}
          </div>
        )}
      </article>
    </LmsActivityFrame>
  );
}