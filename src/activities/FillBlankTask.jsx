import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  cleanTextLines,
  getPrimaryState,
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getStateId(state) {
  return String(state?.id || state?.stateId || '').trim();
}

function buildFillBlankData(task, state) {
  const source = state || task;
  const lines = Array.isArray(source?.textLines)
    ? cleanTextLines(source.textLines)
    : [];

  const title =
    task?.title ||
    state?.title ||
    lines[0] ||
    'Save your login and password';

  const promptLines = lines.length > 0 ? lines : [task?.title || 'Type your login and password in the answer field below.'];

  return {
    title,
    promptLines,
  };
}

export default function FillBlankTask(props) {
  const {
    task,
    state,
    onPrevTask,
    onNextTask,
    isTaskDone,
  } = props;

  const primaryState = useMemo(() => getPrimaryState(task), [task]);
  const currentState = state || primaryState;
  const data = useMemo(() => buildFillBlankData(task, currentState), [task, currentState]);

  const storageKey = useMemo(
    () => `fill-blank:${getTaskId(task)}:${getStateId(currentState) || 'default'}`,
    [task, currentState],
  );

  const saved = useMemo(() => loadLocalTaskState(storageKey, null), [storageKey]);
  const [answer, setAnswer] = useState(saved?.answer || '');
  const [checked, setChecked] = useState(saved?.checked || false);
  const [panelOpen, setPanelOpen] = useState(saved?.panelOpen ?? true);
  const [status, setStatus] = useState(saved?.status || '');

  useEffect(() => {
    saveLocalTaskState(storageKey, {
      answer,
      checked,
      panelOpen,
      status,
    });
  }, [storageKey, answer, checked, panelOpen, status]);

  function triggerSuccess() {
    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: task?.id || task?.taskId },
      })
    );

    if (onNextTask) {
      setTimeout(onNextTask, 1000);
    }
  }

  function checkAnswer() {
    if (!answer.trim()) {
      setStatus('Please enter your login and password first.');
      return;
    }

    setStatus('Answer saved locally. This task will be reviewed by the teacher.');
    triggerSuccess();
  }

  function resetAnswer() {
    setAnswer('');
    setChecked(false);
    setStatus('');
  }

  return (
    <LmsActivityFrame
      title={data.title}
      status={status}
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={checkAnswer}
      onReset={resetAnswer}
      isTaskDone={isTaskDone}
    >
      <article className={`fill-blank-task-v2 ${panelOpen ? 'fill-blank-panel-open-v2' : 'fill-blank-panel-closed-v2'}`}>
        <section className="fill-blank-left-v2">
          <div className="fill-blank-headline">
            <h1>{data.title}</h1>
            <p>Type your login and password in the answer field and click the airplane icon to submit.</p>
          </div>

          <div className="fill-blank-input-row">
            <input
              type="text"
              className="fill-blank-input"
              value={answer}
              onChange={(event) => {
                setAnswer(event.target.value);
                setStatus('');
              }}
              placeholder="Enter your answer here..."
              aria-label="Fill in the blank answer"
            />
            <button type="button" className="fill-blank-send-button" onClick={checkAnswer} aria-label="Send answer">
              ✈
            </button>
          </div>

          <div className="fill-blank-prompt">
            {data.promptLines.map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
          </div>
        </section>

        <button
          type="button"
          className="fill-blank-panel-toggle-v2"
          onClick={() => setPanelOpen((current) => !current)}
          aria-label={panelOpen ? 'Hide task panel' : 'Show task panel'}
          aria-expanded={panelOpen}
        >
          <span>{panelOpen ? '›' : '‹'}</span>
        </button>

        <aside className="fill-blank-right-v2" aria-hidden={!panelOpen}>
          <div className="fill-blank-side-card">
            <div className="fill-blank-side-subtitle">TASKS WILL BE CHECKED BY THE TEACHER ⓘ</div>
            <div className="fill-blank-side-title">{task?.title || 'Save your login and password'}</div>
            <div className="fill-blank-side-copy">
              Type your login and password in the answer field and submit the task when ready. Your teacher will review the completion.
            </div>
            <div className="fill-blank-side-checklist">
              <label className="fill-blank-side-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                <span>The student entered his login and password</span>
              </label>
            </div>
          </div>
        </aside>
      </article>
    </LmsActivityFrame>
  );
}
