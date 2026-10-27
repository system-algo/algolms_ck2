import { useEffect, useMemo, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import { buildAuthenticatedActivityAttempt } from '../lib/ck2BackendAttempt.js';
import {
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';
import './ConnectedBlocksTask.css';

const BOARD_WIDTH = 900;
const BOARD_HEIGHT = 560;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.6;

function getBackendBaseUrl() {
  return String(
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL ||
    sessionStorage.getItem('lms_backend_url') || localStorage.getItem('lms_backend_url') || ''
  ).trim().replace(/\/+$/, '');
}

function getRuntimeIds(pageInstance) {
  let courseId = '';
  let lessonId = '';
  let pageId = '';

  try {
    const params = new URLSearchParams(window.location.search);
    courseId = params.get('course') || '';
    lessonId = params.get('lesson') || '';
    pageId = params.get('page') || '';
  } catch {}

  return {
    courseId: courseId || pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '',
    lessonId: lessonId || pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '',
    pageId: pageId || pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '',
  };
}


function makeId(prefix = 'node') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildDefaultState() {
  return {
    zoom: 1,
    nodes: [
      {
        id: 'root-node',
        text: 'New element',
        x: 50,
        y: 40,
        width: 180,
        height: 52,
        variant: 'root',
      },
    ],
    edges: [],
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getNodeById(nodes, nodeId) {
  return nodes.find((node) => node.id === nodeId) || null;
}

function getChildren(edges, parentId) {
  return edges.filter((edge) => edge.from === parentId).map((edge) => edge.to);
}

function getDescendants(edges, nodeId, output = new Set()) {
  const directChildren = getChildren(edges, nodeId);

  directChildren.forEach((childId) => {
    if (output.has(childId)) return;
    output.add(childId);
    getDescendants(edges, childId, output);
  });

  return output;
}

function autoLayoutTree(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const edgeList = Array.isArray(edges) ? edges : [];

  const root = nodes.find((n) => n.id === 'root-node' || n.variant === 'root') || nodes[0];

  const nodeMap = new Map();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const childrenMap = new Map();
  nodes.forEach((n) => childrenMap.set(n.id, []));

  edgeList.forEach((e) => {
    if (childrenMap.has(e.from) && nodeMap.has(e.to)) {
      childrenMap.get(e.from).push(nodeMap.get(e.to));
    }
  });

  const slotCountMap = new Map();

  function computeSlots(nodeId) {
    const children = childrenMap.get(nodeId) || [];
    if (children.length === 0) {
      slotCountMap.set(nodeId, 1);
      return 1;
    }

    let sum = 0;
    children.forEach((child) => {
      sum += computeSlots(child.id);
    });

    const total = Math.max(1, sum);
    slotCountMap.set(nodeId, total);
    return total;
  }

  computeSlots(root.id);

  const visited = new Set();
  function markVisited(nodeId) {
    visited.add(nodeId);
    (childrenMap.get(nodeId) || []).forEach((c) => markVisited(c.id));
  }
  markVisited(root.id);

  const orphanNodes = nodes.filter((n) => !visited.has(n.id));

  const depthMap = new Map();
  const maxDepthWidthMap = new Map();

  function computeDepths(nodeId, depth = 0) {
    depthMap.set(nodeId, depth);

    const node = nodeMap.get(nodeId);
    const text = node?.text || '';
    const w = depth === 0
      ? Math.max(160, text.length * 11 + 40)
      : (text ? Math.max(70, text.length * 10 + 24) : 52);

    const currentMax = maxDepthWidthMap.get(depth) || 0;
    if (w > currentMax) {
      maxDepthWidthMap.set(depth, w);
    }

    (childrenMap.get(nodeId) || []).forEach((child) => {
      computeDepths(child.id, depth + 1);
    });
  }

  computeDepths(root.id, 0);

  const levelXMap = new Map();
  let currentX = 50;
  const gapX = 65;

  const maxDepth = Math.max(0, ...Array.from(depthMap.values()));
  for (let d = 0; d <= maxDepth + 10; d++) {
    levelXMap.set(d, currentX);
    const w = maxDepthWidthMap.get(d) || 60;
    currentX += w + gapX;
  }

  const slotHeight = 58;
  const startY = 40;
  const updatedNodesMap = new Map();

  function layoutNode(nodeId, startSlot, depth) {
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const children = childrenMap.get(nodeId) || [];
    const totalSlots = slotCountMap.get(nodeId) || 1;

    const centerSlot = startSlot + (totalSlots - 1) / 2;
    const yPos = startY + centerSlot * slotHeight;
    const xPos = levelXMap.get(depth) || (50 + depth * 140);

    const text = node.text || '';
    const nodeWidth = depth === 0
      ? Math.max(160, text.length * 11 + 40)
      : (text ? Math.max(70, text.length * 10 + 24) : 52);

    const variant = depth === 0 ? 'root' : (depth === 1 ? 'yellow' : 'cyan');

    updatedNodesMap.set(nodeId, {
      ...node,
      x: xPos,
      y: yPos,
      width: nodeWidth,
      height: depth === 0 ? 52 : 44,
      variant,
    });

    let currentChildSlot = startSlot;
    children.forEach((child) => {
      const childSlots = slotCountMap.get(child.id) || 1;
      layoutNode(child.id, currentChildSlot, depth + 1);
      currentChildSlot += childSlots;
    });
  }

  const rootSlots = slotCountMap.get(root.id) || 1;
  layoutNode(root.id, 0, 0);

  if (orphanNodes.length > 0) {
    let orphanY = startY + (rootSlots + 1) * slotHeight;
    orphanNodes.forEach((node) => {
      const text = node.text || '';
      const w = text ? Math.max(70, text.length * 10 + 24) : 52;
      updatedNodesMap.set(node.id, {
        ...node,
        x: 50,
        y: orphanY,
        width: w,
        height: 44,
        variant: 'cyan',
      });
      orphanY += slotHeight;
    });
  }

  return nodes.map((n) => updatedNodesMap.get(n.id) || n);
}

export default function ConnectedBlocksTask(props) {
  const task = props?.task;
  const storageKey = useMemo(() => task?.id || task?.taskId || 'connected-blocks-task', [task]);

  const [localCompleted, setLocalCompleted] = useState(false);
  const isAlreadyDone =
    localCompleted ||
    props?.isTaskDone ||
    (Array.isArray(props?.completedTaskIds) &&
      (props.completedTaskIds.includes(task?.id) ||
        props.completedTaskIds.includes(task?.taskId) ||
        props.completedTaskIds.includes(storageKey)));

  const [state, setState] = useState(() => {
    const saved = loadLocalTaskState(storageKey, null);
    if (saved && Array.isArray(saved.nodes) && Array.isArray(saved.edges)) {
      return saved;
    }
    return buildDefaultState();
  });

  useEffect(() => {
    const saved = loadLocalTaskState(storageKey, null);
    if (saved && Array.isArray(saved.nodes) && Array.isArray(saved.edges)) {
      setState(saved);
    } else {
      setState(buildDefaultState());
    }
  }, [storageKey]);

  useEffect(() => {
    saveLocalTaskState(storageKey, state);
  }, [storageKey, state]);

  const rawNodes = Array.isArray(state?.nodes) ? state.nodes : [];
  const edges = Array.isArray(state?.edges) ? state.edges : [];
  const zoom = typeof state?.zoom === 'number' ? state.zoom : 1;

  // Auto-layout nodes to guarantee non-overlapping tree layout
  const nodes = useMemo(() => autoLayoutTree(rawNodes, edges), [rawNodes, edges]);

  // Compute dynamic canvas height & width so full tree is scrollable
  const canvasHeight = useMemo(() => {
    const maxY = Math.max(BOARD_HEIGHT, ...nodes.map((n) => (n.y || 0) + (n.height || 44) + 80));
    return maxY;
  }, [nodes]);

  const canvasWidth = useMemo(() => {
    const maxX = Math.max(BOARD_WIDTH, ...nodes.map((n) => (n.x || 0) + (n.width || 52) + 120));
    return maxX;
  }, [nodes]);

  function updateNodeText(nodeId, text) {
    setState((current) => ({
      ...current,
      nodes: (Array.isArray(current?.nodes) ? current.nodes : []).map((node) => {
        if (node.id !== nodeId) return node;
        return { ...node, text };
      }),
    }));
  }

  function addChildNode(parentId) {
    setState((current) => {
      const currentNodes = Array.isArray(current?.nodes) ? current.nodes : [];
      const currentEdges = Array.isArray(current?.edges) ? current.edges : [];
      const parentNode = getNodeById(currentNodes, parentId);
      if (!parentNode) return current;

      const nodeId = makeId();
      const variant = parentNode.variant === 'root' ? 'yellow' : 'cyan';

      return {
        ...current,
        nodes: [
          ...currentNodes,
          {
            id: nodeId,
            text: '',
            x: parentNode.x + 120,
            y: parentNode.y,
            width: 52,
            height: 44,
            variant,
          },
        ],
        edges: [
          ...currentEdges,
          {
            id: makeId('edge'),
            from: parentId,
            to: nodeId,
          },
        ],
      };
    });
  }

  function removeNode(nodeId) {
    if (nodeId === 'root-node') return;

    setState((current) => {
      const currentNodes = Array.isArray(current?.nodes) ? current.nodes : [];
      const currentEdges = Array.isArray(current?.edges) ? current.edges : [];
      const descendantIds = getDescendants(currentEdges, nodeId);
      descendantIds.add(nodeId);

      return {
        ...current,
        nodes: currentNodes.filter((node) => !descendantIds.has(node.id)),
        edges: currentEdges.filter(
          (edge) => !descendantIds.has(edge.from) && !descendantIds.has(edge.to),
        ),
      };
    });
  }

  function zoomIn() {
    setState((current) => ({
      ...current,
      zoom: clamp(Number(((current?.zoom || 1) + 0.1).toFixed(2)), MIN_ZOOM, MAX_ZOOM),
    }));
  }

  function zoomOut() {
    setState((current) => ({
      ...current,
      zoom: clamp(Number(((current?.zoom || 1) - 0.1).toFixed(2)), MIN_ZOOM, MAX_ZOOM),
    }));
  }

  async function saveBoard() {
    // Keep a browser draft even when the network is unavailable, but do not
    // mark it complete unless the backend stores the attempt and completion.
    saveLocalTaskState(storageKey, state);
    try {
      const apiBaseUrl = getBackendBaseUrl();
      if (!apiBaseUrl) throw new Error('LMS backend is not configured.');
      const { courseId, lessonId, pageId } = getRuntimeIds(props?.pageInstance);
      const effectiveTaskId = task?.id || task?.taskId || storageKey;
      const studentEmail =
        sessionStorage.getItem('lms_student_email') ||
        localStorage.getItem('lms_student_email') || '';
      const accessToken =
        sessionStorage.getItem('lms_access_token') ||
        localStorage.getItem('lms_access_token') || '';
      const { headers, payload } = buildAuthenticatedActivityAttempt({
        studentEmail, accessToken, courseId, lessonId, pageId,
        taskId: effectiveTaskId,
        activityType: 'connected-blocks-task',
        answer: state,
      });
      const attempt = await fetch(`${apiBaseUrl}/api/activity-attempts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!attempt.ok || (await attempt.json())?.ok !== true) {
        throw new Error('Could not save connected blocks attempt.');
      }

      const completion = await fetch(`${apiBaseUrl}/api/activity-completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...payload,
          completionType: 'completed',
          metadata: { source: 'connected-blocks-task' },
        }),
      });
      if (!completion.ok || (await completion.json())?.ok !== true) {
        throw new Error('Could not mark connected blocks complete.');
      }

      if (!isAlreadyDone) {
        setLocalCompleted(true);
        import('../utils/lmsSounds.js')
          .then(({ playLmsSound, LMS_SOUND_TYPES }) => {
            playLmsSound(LMS_SOUND_TYPES.COMPLETE_ACTIVITY);
          })
          .catch(() => {});
        window.dispatchEvent(
          new CustomEvent('LMS_TASK_COMPLETED', {
            detail: { taskId: effectiveTaskId },
          })
        );
      }
      if (typeof props?.onTaskComplete === 'function') {
        props.onTaskComplete({ taskId: effectiveTaskId });
      }
    } catch (error) {
      console.error('[ConnectedBlocksTask] Backend save failed; draft stored locally:', error);
    }
  }

  // Calculate wires and white connector dots
  const renderingWires = useMemo(() => {
    const lines = [];
    const dots = [];
    const parentChildrenMap = new Map();

    edges.forEach((edge) => {
      if (!parentChildrenMap.has(edge.from)) {
        parentChildrenMap.set(edge.from, []);
      }
      parentChildrenMap.get(edge.from).push(edge);
    });

    parentChildrenMap.forEach((childEdges, parentId) => {
      const parentNode = getNodeById(nodes, parentId);
      if (!parentNode) return;

      const pX = parentNode.x + (parentNode.width || 52);
      const pY = parentNode.y + (parentNode.height || 44) / 2;
      const isRootParent = parentNode.variant === 'root';

      if (isRootParent) {
        childEdges.forEach((edge) => {
          const childNode = getNodeById(nodes, edge.to);
          if (!childNode) return;

          const cX = childNode.x;
          const cY = childNode.y + (childNode.height || 44) / 2;

          lines.push({
            id: edge.id,
            d: `M ${pX} ${pY} L ${cX} ${cY}`,
            color: '#a78bfa',
            width: 2.5,
          });
        });
      } else {
        if (childEdges.length > 1) {
          const dotX = pX + 24;
          const dotY = pY;

          lines.push({
            id: `dot-stem-${parentId}`,
            d: `M ${pX} ${pY} L ${dotX} ${dotY}`,
            color: '#facc15',
            width: 2.5,
          });

          dots.push({ id: `dot-${parentId}`, x: dotX, y: dotY });

          childEdges.forEach((edge) => {
            const childNode = getNodeById(nodes, edge.to);
            if (!childNode) return;

            const cX = childNode.x;
            const cY = childNode.y + (childNode.height || 44) / 2;

            lines.push({
              id: edge.id,
              d: `M ${dotX} ${dotY} L ${cX} ${cY}`,
              color: '#facc15',
              width: 2.5,
            });
          });
        } else {
          childEdges.forEach((edge) => {
            const childNode = getNodeById(nodes, edge.to);
            if (!childNode) return;

            const cX = childNode.x;
            const cY = childNode.y + (childNode.height || 44) / 2;

            lines.push({
              id: edge.id,
              d: `M ${pX} ${pY} L ${cX} ${cY}`,
              color: '#facc15',
              width: 2.5,
            });
          });
        }
      }
    });

    return { lines, dots };
  }, [nodes, edges]);

  function resetBoard() {
    const defaultState = buildDefaultState();
    setState(defaultState);
    saveLocalTaskState(storageKey, defaultState);
  }

  return (
    <LmsActivityFrame
      {...props}
      onCheck={saveBoard}
      onReset={resetBoard}
      isTaskDone={props?.isTaskDone || isAlreadyDone}
    >
      <div className="connected-blocks-stage">
        <div className="connected-blocks-shell">
          {/* Zoom Controls fixed at top-right of black canvas viewport */}
          <div className="connected-blocks-toolbar">
            <button
              type="button"
              className="connected-blocks-tool"
              onClick={zoomIn}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button
              type="button"
              className="connected-blocks-tool"
              onClick={zoomOut}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
          </div>

          <div className="connected-blocks-board">
            {/* Inner Canvas Wrapper scaling contents without scaling black container box */}
            <div
              className="connected-blocks-canvas-wrapper"
              style={{
                width: Math.max(BOARD_WIDTH, canvasWidth * zoom),
                height: Math.max(BOARD_HEIGHT, canvasHeight * zoom),
                position: 'relative',
              }}
            >
              <div
                className="connected-blocks-inner-canvas"
                style={{
                  width: canvasWidth,
                  height: canvasHeight,
                  minWidth: '100%',
                  minHeight: '100%',
                  position: 'relative',
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                }}
              >
                <svg
                  className="connected-blocks-wires"
                  width={canvasWidth}
                  height={canvasHeight}
                  viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                  aria-hidden="true"
                >
                  {renderingWires.lines.map((line) => (
                    <path
                      key={line.id}
                      d={line.d}
                      stroke={line.color}
                      strokeWidth={line.width}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {renderingWires.dots.map((dot) => (
                    <circle
                      key={dot.id}
                      cx={dot.x}
                      cy={dot.y}
                      r={6}
                      fill="#ffffff"
                      stroke="#0b1329"
                      strokeWidth={2}
                    />
                  ))}
                </svg>

                {nodes.map((node) => {
                  const isRoot = node.variant === 'root';
                  const isCyan = node.variant === 'cyan';
                  const variantClass = isRoot
                    ? 'is-root'
                    : isCyan
                      ? 'is-cyan'
                      : 'is-yellow';

                  return (
                    <div
                      key={node.id}
                      className={`connected-block ${variantClass}`}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: node.width || (isRoot ? 180 : 52),
                        height: node.height || (isRoot ? 52 : 44),
                      }}
                    >
                      {!isRoot && (
                        <button
                          type="button"
                          className="connected-block-remove"
                          onClick={() => removeNode(node.id)}
                          aria-label="Remove node"
                          title="Remove"
                        >
                          ×
                        </button>
                      )}

                      <input
                        type="text"
                        value={node.text || ''}
                        onChange={(event) => updateNodeText(node.id, event.target.value)}
                        className="connected-block-input"
                        placeholder={isRoot ? 'New element' : ''}
                      />

                      <button
                        type="button"
                        className="connected-block-add"
                        onClick={() => addChildNode(node.id)}
                        aria-label="Add linked node"
                        title="Add child node"
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </LmsActivityFrame>
  );
}