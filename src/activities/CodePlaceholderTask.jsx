import { useEffect, useMemo, useRef, useState } from 'react';
import LmsActivityFrame from '../components/LmsActivityFrame.jsx';
import {
  loadLocalTaskState,
  saveLocalTaskState,
} from '../lib/taskExtractors.js';

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

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeCodeLine(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/\s+$/g, '');
}

function unique(values) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const text = String(value ?? '');
    const key = text.trim().toLowerCase();

    if (!key) {
      result.push(text);
      return;
    }

    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function collectAllStrings(value, output = [], depth = 0) {
  if (depth > 14 || value == null) return output;

  if (typeof value === 'string') {
    const text = value.trim();
    if (text) output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectAllStrings(item, output, depth + 1));
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectAllStrings(item, output, depth + 1));
  }

  return output;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n\s+\n/g, '\n');
}

function isBlankLine(line) {
  return String(line ?? '').trim() === '';
}

function isNoiseLine(line) {
  const text = normalizeText(line).toLowerCase();

  if (!text) return false;
  if (text === 'write your code here') return true;
  if (text === '# write your code here') return true;
  if (text.includes('output will appear')) return true;
  if (text.includes('tasks with automatic check')) return true;
  if (text.includes('task-preview')) return true;
  if (text.includes('screenshots/')) return true;
  if (text.includes('assets/')) return true;
  if (text.includes('generated/')) return true;
  if (text === 'run') return true;
  if (text === 'reset') return true;
  if (text === 'check') return true;
  if (text === 'next') return true;
  if (text === 'show raw capture') return true;
  if (text === 'use activity renderer') return true;

  return false;
}

function isCodeLine(line) {
  const text = normalizeText(line);

  if (!text) return false;
  if (isNoiseLine(text)) return false;

  return (
    /^[a-zA-Z_][\w]*\s*=\s*.+$/.test(text) ||
    /^print\s*\(.+/.test(text) ||
    /^input\s*\(.+/.test(text) ||
    /^if\s+.+/.test(text) ||
    /^elif\s+.+/.test(text) ||
    /^else\s*:/.test(text) ||
    /^for\s+.+/.test(text) ||
    /^while\s+.+/.test(text) ||
    /^return\s+.+/.test(text) ||
    /^import\s+.+/.test(text) ||
    /^from\s+.+\s+import\s+.+/.test(text) ||
    /^def\s+.+/.test(text) ||
    /^[a-zA-Z_][\w]*\s*\(.+\)$/.test(text)
  );
}

function splitRawTextIntoLines(value) {
  return stripHtml(value)
    .replace(/\r/g, '\n')
    .split('\n')
    .map(normalizeCodeLine);
}

function trimOuterBlankLines(lines) {
  let start = 0;
  let end = lines.length - 1;

  while (start <= end && isBlankLine(lines[start])) start += 1;
  while (end >= start && isBlankLine(lines[end])) end -= 1;

  return lines.slice(start, end + 1);
}

function keepCodeRegion(lines) {
  const prepared = lines.map(normalizeCodeLine);

  const firstCodeIndex = prepared.findIndex((line) => isCodeLine(line));

  if (firstCodeIndex < 0) return [];

  let lastCodeIndex = -1;

  prepared.forEach((line, index) => {
    if (isCodeLine(line)) lastCodeIndex = index;
  });

  const region = prepared.slice(firstCodeIndex, lastCodeIndex + 1);

  return trimOuterBlankLines(
    region.filter((line) => isBlankLine(line) || isCodeLine(line)),
  );
}

function getCodeLinesFromCodeBlocks(state) {
  if (!Array.isArray(state?.codeBlocks)) return [];

  const blocks = state.codeBlocks
    .map((block) => {
      const raw =
        block.code ||
        block.text ||
        block.value ||
        block.content ||
        block.innerText ||
        block.textContent ||
        '';

      return keepCodeRegion(splitRawTextIntoLines(raw));
    })
    .filter((lines) => lines.some((line) => isCodeLine(line)));

  if (blocks.length === 0) return [];

  blocks.sort((a, b) => {
    const codeCountA = a.filter(isCodeLine).length;
    const codeCountB = b.filter(isCodeLine).length;
    return codeCountB - codeCountA;
  });

  return blocks[0].slice(0, 24);
}

function getCodeLinesFromTextLines(state) {
  if (!Array.isArray(state?.textLines)) return [];

  const lines = state.textLines
    .flatMap(splitRawTextIntoLines);

  return keepCodeRegion(lines).slice(0, 24);
}

function getCodeLinesFromRawState(state) {
  const stringBlocks = collectAllStrings(state)
    .map(splitRawTextIntoLines)
    .map(keepCodeRegion)
    .filter((lines) => lines.some((line) => isCodeLine(line)));

  if (stringBlocks.length === 0) return [];

  stringBlocks.sort((a, b) => {
    const codeCountA = a.filter(isCodeLine).length;
    const codeCountB = b.filter(isCodeLine).length;
    return codeCountB - codeCountA;
  });

  return unique(stringBlocks[0]).slice(0, 24);
}

function getCodeLinesFromState(state) {
  const fromCodeBlocks = getCodeLinesFromCodeBlocks(state);
  if (fromCodeBlocks.length > 0) return fromCodeBlocks;

  const fromTextLines = getCodeLinesFromTextLines(state);
  if (fromTextLines.length > 0) return fromTextLines;

  const fromRaw = getCodeLinesFromRawState(state);
  if (fromRaw.length > 0) return fromRaw;

  return [
    'day = str(25)',
    'month = str(12)',
    "christmas = day + '.' + month",
  ];
}

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_]/.test(char);
}

function isDigit(char) {
  return /[0-9]/.test(char);
}

function getSyntaxClassForWord(word) {
  if (PYTHON_KEYWORDS.has(word)) return 'syntax-keyword';
  if (PYTHON_BUILTINS.has(word)) return 'syntax-builtin';
  return 'syntax-variable';
}

function getSyntaxClassesForLine(line) {
  const classes = Array.from({ length: line.length }, () => '');
  let index = 0;

  while (index < line.length) {
    const char = line[index];

    if (char === '#') {
      for (let i = index; i < line.length; i += 1) {
        classes[i] = 'syntax-comment';
      }
      break;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      classes[index] = 'syntax-string';
      index += 1;

      while (index < line.length) {
        classes[index] = 'syntax-string';

        if (line[index] === '\\') {
          index += 1;
          if (index < line.length) {
            classes[index] = 'syntax-string';
          }
        } else if (line[index] === quote) {
          break;
        }

        index += 1;
      }

      index += 1;
      continue;
    }

    if (isDigit(char)) {
      while (index < line.length && /[0-9.]/.test(line[index])) {
        classes[index] = 'syntax-number';
        index += 1;
      }
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      let word = '';

      while (index < line.length && isIdentifierPart(line[index])) {
        word += line[index];
        index += 1;
      }

      const className = getSyntaxClassForWord(word);

      for (let i = start; i < index; i += 1) {
        classes[i] = className;
      }

      continue;
    }

    if ('+-*/%=<>!&|^~'.includes(char)) {
      classes[index] = 'syntax-operator';
      index += 1;
      continue;
    }

    if ('()[]{}.,:'.includes(char)) {
      classes[index] = 'syntax-punctuation';
      index += 1;
      continue;
    }

    index += 1;
  }

  return classes;
}

function buildTypingLines(codeLines) {
  let globalIndex = 0;

  return codeLines.map((line, lineIndex) => {
    const syntaxClasses = getSyntaxClassesForLine(line);

    const chars = line.split('').map((char, charIndex) => {
      const item = {
        id: `char-${lineIndex + 1}-${charIndex + 1}`,
        char,
        syntaxClass: syntaxClasses[charIndex] || '',
        globalIndex,
      };

      globalIndex += 1;
      return item;
    });

    return {
      id: `line-${lineIndex + 1}`,
      lineNumber: lineIndex + 1,
      text: line,
      chars,
    };
  });
}

function getPlaceholderData(task, state) {
  const source = state || task;
  const codeLines = getCodeLinesFromState(source);

  return {
    title: source.codeTypingPrompt || task.codeTypingPrompt || 'Complete the code.',
    lines: buildTypingLines(codeLines),
  };
}

function getTotalCharCount(lines) {
  return lines.reduce((total, line) => total + line.chars.length, 0);
}

function getCharByGlobalIndex(lines, globalIndex) {
  for (const line of lines) {
    const found = line.chars.find((item) => item.globalIndex === globalIndex);
    if (found) return found;
  }

  return null;
}

function displayChar(char) {
  if (char === ' ') return '\u00a0';
  return char;
}

function CodeChar({ item, cursorIndex }) {
  const isTyped = item.globalIndex < cursorIndex;
  const isActive = item.globalIndex === cursorIndex;

  let stateClassName = 'code-char-pending';

  if (isTyped) stateClassName = 'code-char-typed';
  if (isActive) stateClassName = 'code-char-active';

  return (
    <span className={`${stateClassName} ${item.syntaxClass || ''}`}>
      {displayChar(item.char)}
    </span>
  );
}

export default function CodePlaceholderTask({
  task,
  state,
  onPrevTask,
  onNextTask,
  onPrevState,
  onNextState,
  isTaskDone,
}) {
  const data = useMemo(() => getPlaceholderData(task, state), [task, state]);
  const totalChars = useMemo(() => getTotalCharCount(data.lines), [data.lines]);

  const taskId = String(task?.id || task?.taskId || 'placeholder').trim();
  const storageKey = `${taskId}:${state?.id || 'placeholder_typing'}:all-chars-v4`;
  const saved = useMemo(() => loadLocalTaskState(storageKey, null), [storageKey]);

  const [cursorIndex, setCursorIndex] = useState(() => saved?.cursorIndex || 0);
  const [status, setStatus] = useState(() => saved?.status || '');
  const [wrongFlash, setWrongFlash] = useState(false);
  const focusRef = useRef(null);

  const nextAction = onNextState || onNextTask;
  const prevAction = onPrevState || onPrevTask;

  useEffect(() => {
    setCursorIndex((current) => Math.min(current, totalChars));
  }, [totalChars]);

  useEffect(() => {
    saveLocalTaskState(storageKey, { cursorIndex, status });
  }, [storageKey, cursorIndex, status]);

  useEffect(() => {
    focusRef.current?.focus();
  }, [state?.id]);

  function flashWrong() {
    setWrongFlash(true);
    window.setTimeout(() => setWrongFlash(false), 160);
  }

  function handleKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Tab') return;

    event.preventDefault();

    if (event.key === 'Backspace') {
      setCursorIndex((current) => Math.max(0, current - 1));
      setStatus('');
      return;
    }

    if (event.key.length !== 1) return;

    const currentChar = getCharByGlobalIndex(data.lines, cursorIndex);

    if (!currentChar) {
      setStatus('Completed locally.');
      return;
    }

    if (event.key !== currentChar.char) {
      flashWrong();
      return;
    }

    setCursorIndex((current) => {
      const next = current + 1;

      if (next >= totalChars) {
        setStatus('Completed locally.');
      } else {
        setStatus('');
      }

      return next;
    });
  }

  function reset() {
    setCursorIndex(0);
    setStatus('');
    focusRef.current?.focus();
  }

  function check() {
    if (cursorIndex < totalChars) {
      setStatus(`Continue typing. ${cursorIndex}/${totalChars} characters completed.`);
    } else {
      setStatus('Completed locally.');
      window.dispatchEvent(
        new CustomEvent('LMS_TASK_COMPLETED', {
          detail: { taskId: task?.id || task?.taskId },
        })
      );
      if (onNextTask) {
        setTimeout(onNextTask, 1000);
      }
    }

    focusRef.current?.focus();
  }

  return (
    <LmsActivityFrame
      title={data.title}
      status={status}
      onPrevTask={prevAction}
      onNextTask={nextAction}
      onCheck={check}
      onReset={reset}
      isTaskDone={isTaskDone}
    >
      <article
        ref={focusRef}
        className={`placeholder-code-task all-char-typing-mode ${wrongFlash ? 'wrong-key' : ''}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={() => focusRef.current?.focus()}
      >
        <div className="placeholder-code-topbar" />

        <div className="placeholder-code-editor">
          {data.lines.map((line) => (
            <div key={line.id} className="placeholder-code-line">
              <span className="placeholder-line-number">{line.lineNumber}</span>

              <span className="placeholder-code-tokens">
                {line.chars.map((item) => (
                  <CodeChar
                    key={item.id}
                    item={item}
                    cursorIndex={cursorIndex}
                  />
                ))}
              </span>
            </div>
          ))}
        </div>
      </article>
    </LmsActivityFrame>
  );
}