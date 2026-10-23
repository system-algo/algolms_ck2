import { useEffect, useMemo, useState } from 'react';
import './TheoryReadingTask.css';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  getUniqueImages,
  loadLocalTaskState,
  saveLocalTaskState,
  resolveActivityMapUrl,
} from '../lib/taskExtractors.js';

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getManualMapUrl(pageInstance) {
  return resolveActivityMapUrl(pageInstance?.manualActivityMap?.url || pageInstance?.manualActivityMap || '');
}

function getFallbackConfig(task) {
  const images = getUniqueImages(task);
  return {
    title: task?.title || 'Theory Lesson',
    code: '',
    image: images[0]?.src || '',
    nextLabel: '',
  };
}

function getConfigFromTask(task) {
  return task?.theoryReading || task?.theoryTask || task?.textTask || null;
}

function formatRgb(val) {
  if (!val) return 'transparent';
  const str = String(val).trim();
  if (str.startsWith('rgb(') || str.startsWith('rgba(') || str.startsWith('#')) return str;
  if (str.startsWith('(') && str.endsWith(')')) return `rgb${str}`;
  return `rgb(${str})`;
}

export default function TheoryReadingTask({
  task,
  pageInstance,
  onPrevTask,
  onNextTask,
  onBackToPages,
  onBackToCatalog,
  onBackToCourse,
  isTaskDone,
  completedTaskIds,
}) {
  const taskId = getTaskId(task);
  const [localCompleted, setLocalCompleted] = useState(false);
  const isAlreadyDone =
    localCompleted ||
    isTaskDone ||
    (Array.isArray(completedTaskIds) && (completedTaskIds.includes(task?.id) || completedTaskIds.includes(taskId)));

  const fallbackConfig = useMemo(() => getFallbackConfig(task), [task]);
  const [manualConfig, setManualConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;

    setManualConfig(null);

    const url = getManualMapUrl(pageInstance);

    if (!url || !taskId) return undefined;

    fetch(url)
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((manualMap) => {
        if (cancelled || !manualMap) return;

        const manualTask = manualMap?.tasks?.[taskId] || null;

        const nextConfig =
          manualTask?.theoryReading ||
          manualTask?.theoryTask ||
          manualTask?.textTask ||
          null;

        setManualConfig(nextConfig);
      })
      .catch(() => {
        if (!cancelled) {
          setManualConfig(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pageInstance, taskId]);

  const directConfig = getConfigFromTask(task);
  const config = manualConfig || directConfig || fallbackConfig;

  const storageKey = task.id || taskId || 'theory-reading-default';

  useEffect(() => {
    if (!taskId) return;
    saveLocalTaskState(storageKey, { viewed: true });
    saveLocalTaskState(taskId, { viewed: true });

    if (isAlreadyDone) return;

    // 5 seconds delay after slide appears before playing sound & showing progress popup
    const timer = setTimeout(() => {
      if (isAlreadyDone) return;
      setLocalCompleted(true);
      import('../utils/lmsSounds.js')
        .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
          playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
        })
        .catch(() => {});

      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || taskId },
        })
      );
    }, 5000);

    return () => clearTimeout(timer);
  }, [storageKey, taskId, task, isAlreadyDone]);

  function handleCheck() {
    if (isAlreadyDone) return;

    setLocalCompleted(true);
    import('../utils/lmsSounds.js')
      .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
        playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
      })
      .catch(() => {});

    window.dispatchEvent(
      new CustomEvent('LMS_TASK_COMPLETED', {
        detail: { taskId: task?.id || taskId },
      })
    );

    if (onNextTask) {
      onNextTask();
    }
  }

  function handleReset() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const titleHtml = config?.titleHtml || config?.title_html || '';
  const titleText = config?.title || task?.title || '';
  const codeHtml = config?.codeHtml || config?.code_html || '';
  const codeText = config?.code || config?.codeText || '';

  const colorSwatchTable = useMemo(() => {
    if (Array.isArray(config?.colorSwatchTable)) return config.colorSwatchTable;
    if (Array.isArray(config?.colorTable)) return config.colorTable;
    if (
      Array.isArray(config?.table) &&
      config.table.length > 0 &&
      (config.table[0]?.rgb !== undefined || config.table[0]?.number !== undefined)
    ) {
      return config.table;
    }
    return null;
  }, [config]);

  const propertyTableRows = useMemo(() => {
    if (Array.isArray(config?.propertyTableRows)) return config.propertyTableRows;
    if (Array.isArray(config?.propertyTable)) return config.propertyTable;
    return null;
  }, [config]);

  const genericTable = useMemo(() => {
    if (colorSwatchTable) return null;
    return config?.table || null;
  }, [config, colorSwatchTable]);

  const genericTableRows = useMemo(() => {
    if (!genericTable) return [];
    if (Array.isArray(genericTable.rows)) return genericTable.rows;
    if (Array.isArray(genericTable)) return genericTable;
    return [];
  }, [genericTable]);

  const genericTableHeaders = useMemo(() => {
    if (!genericTable) return [];
    if (Array.isArray(genericTable.headers)) return genericTable.headers;
    if (
      Array.isArray(genericTable) &&
      genericTable.length > 0 &&
      typeof genericTable[0] === 'object' &&
      !Array.isArray(genericTable[0])
    ) {
      return Object.keys(genericTable[0]);
    }
    return [];
  }, [genericTable]);

  const imageUrl = config?.image || config?.imageUrl || config?.imageSrc || '';
  const nextLabel =
    config?.showNextButton === false || config?.hideNextButton === true
      ? ''
      : (config?.nextLabel || config?.buttonLabel || '');

  return (
    <LmsActivityFrame
      title=""
      status=""
      onPrevTask={onPrevTask}
      onNextTask={onNextTask}
      onCheck={handleCheck}
      onReset={handleReset}
      footer={null}
      innerClassName="lms-frame__inner--narrow"
      isTaskDone={isAlreadyDone}
    >
      <article className="theory-reading-task">
        <div className="theory-reading-content">
          {titleHtml ? (
            <h1
              className="theory-reading-title"
              dangerouslySetInnerHTML={{ __html: titleHtml }}
            />
          ) : titleText ? (
            <h1 className="theory-reading-title">{titleText}</h1>
          ) : null}

          {codeHtml ? (
            <div className="theory-reading-code-box">
              <pre
                className="theory-reading-code"
                dangerouslySetInnerHTML={{ __html: codeHtml }}
              />
            </div>
          ) : codeText ? (
            <div className="theory-reading-code-box">
              <pre className="theory-reading-code">{codeText}</pre>
            </div>
          ) : null}

          {colorSwatchTable && colorSwatchTable.length > 0 ? (
            <div className="theory-reading-table-container">
              <table className="theory-reading-table">
                <thead>
                  <tr>
                    <th>Color</th>
                    <th>Name</th>
                    <th>Number</th>
                    <th>RGB Value</th>
                  </tr>
                </thead>
                <tbody>
                  {colorSwatchTable.map((row, index) => {
                    const bg = formatRgb(row.rgb || row.color || row.hex);
                    return (
                      <tr key={index}>
                        <td>
                          <div
                            className="color-swatch-box"
                            style={{ backgroundColor: bg }}
                          />
                        </td>
                        <td>{row.name}</td>
                        <td>{row.number}</td>
                        <td>{row.rgb || row.color || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : propertyTableRows && propertyTableRows.length > 0 ? (
            <div className="theory-reading-property-table-container">
              <table className="theory-reading-property-table">
                <tbody>
                  {propertyTableRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {Array.isArray(row) ? (
                        <>
                          <td className="prop-col">{row[0]}</td>
                          <td className="desc-col">{row[1]}</td>
                        </>
                      ) : (
                        <td colSpan={2}>{String(row)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : genericTableRows && genericTableRows.length > 0 ? (
            <div className="theory-reading-table-container">
              <table className="theory-reading-table">
                {genericTableHeaders && genericTableHeaders.length > 0 ? (
                  <thead>
                    <tr>
                      {genericTableHeaders.map((h, idx) => (
                        <th key={idx}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {genericTableRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {Array.isArray(row) ? (
                        row.map((cell, cIdx) => <td key={cIdx}>{cell}</td>)
                      ) : typeof row === 'object' && row !== null ? (
                        genericTableHeaders.map((key, cIdx) => <td key={cIdx}>{row[key]}</td>)
                      ) : (
                        <td>{String(row)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {imageUrl ? (
            <img
              className="theory-reading-image"
              src={imageUrl}
              alt=""
              draggable={false}
            />
          ) : null}
          <div id="theory-reading-bottom-sentinel" style={{ height: '1px', width: '100%' }} />
        </div>


      </article>
    </LmsActivityFrame>
  );
}
