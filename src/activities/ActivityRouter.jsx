import { useEffect, useMemo, useState } from 'react';
import CodeClassificationTask from './CodeClassificationTask.jsx';
import CodeCopyConfirmTask from './CodeCopyConfirmTask.jsx';
import CodePlaceholderTask from './CodePlaceholderTask.jsx';
import ConnectedBlocksTask from './ConnectedBlocksTask.jsx';
import FillBlankTask from './FillBlankTask.jsx';
import GenericCapturedTask from './GenericCapturedTask.jsx';
import IdeaListTask from './IdeaListTask.jsx';
import IdeProgrammingTask from './IdeProgrammingTask.jsx';
import ImageDropzonesTask from './ImageDropzonesTask.jsx';
import MatchingDragdropTask from './MatchingDragdropTask.jsx';
import MatchingConnectTask from './MatchingConnectTask.jsx';
import McqCheckboxTask from './McqCheckboxTask.jsx';
import ProjectChecklistTask from './ProjectChecklistTask.jsx';
import SequenceOrderTask from './SequenceOrderTask.jsx';
import SceneClassificationTask from './SceneClassificationTask.jsx';
import ToolLabelDragdropTask from './ToolLabelDragdropTask.jsx';
import FeedbackTask from './FeedbackTask.jsx';
import LessonFinishTask from './LessonFinishTask.jsx';
import TypingPracticeTask from './TypingPracticeTask.jsx';
import WindowFillBlankTask from './WindowFillBlankTask.jsx';
import YoutubeEmbedTask from './YoutubeEmbedTask.jsx';
import GoogleSlideEmbedTask from './GoogleSlideEmbedTask.jsx';
import TheoryReadingTask from './TheoryReadingTask.jsx';
import FinishTask from './FinishTask.jsx';
import ScratchEmbedTask from './ScratchEmbedTask.jsx';
import LinkDownloadTask from './LinkDownloadTask.jsx';
import { resolveActivityMapUrl } from '../lib/taskExtractors.js';

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeRaw(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function collectAllText(value, output = [], depth = 0) {
  if (depth > 14 || value == null) return output;

  if (typeof value === 'string') {
    const text = value.trim();
    if (text) output.push(text);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectAllText(item, output, depth + 1));
    return output;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectAllText(item, output, depth + 1));
  }

  return output;
}

function getCurrentSource(task, state) {
  if (state) return state;

  if (Array.isArray(task?.states) && task.states.length === 1) {
    return task.states[0];
  }

  return task;
}

function getLinesFromSource(source) {
  const seen = new Set();
  const result = [];

  collectAllText(source)
    .flatMap((text) => String(text).replace(/\r/g, '\n').split('\n'))
    .map(normalizeRaw)
    .filter(Boolean)
    .forEach((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(line);
    });

  return result;
}

function isTechnicalCaptureLine(line) {
  const text = String(line || '').trim();
  const lower = normalizeText(text);

  if (!text) return false;

  if (lower.includes('nth-of-type')) return true;
  if (lower.includes('queryselector')) return true;
  if (lower.includes('dom path')) return true;
  if (lower.includes('css selector')) return true;
  if (lower.includes('.sc-')) return true;
  if (lower.includes('div.sc-')) return true;
  if (lower.includes('span.sc-')) return true;
  if (lower.includes('button.sc-')) return true;

  if (
    /(^|\s)(div|span|button|input|textarea|section|article|aside|main|p|pre)\.[a-z0-9_-]+/i.test(text) &&
    (text.includes('>') || text.includes(':nth-'))
  ) {
    return true;
  }

  if (text.length > 100 && text.includes('>') && text.includes('.')) {
    return true;
  }

  return false;
}

function isNoiseLine(line) {
  const lower = normalizeText(line);

  if (!lower) return true;
  if (isTechnicalCaptureLine(line)) return true;

  if (lower === 'run') return true;
  if (lower === 'reset') return true;
  if (lower === 'check') return true;
  if (lower === 'next') return true;
  if (lower === 'show raw capture') return true;
  if (lower === 'use activity renderer') return true;
  if (lower === 'tasks with automatic check') return true;
  if (lower === 'task with automatic check') return true;
  if (lower === '# write your code here') return true;
  if (lower === 'write your code here') return true;
  if (lower === 'select a value') return true;

  if (lower.includes('output will appear')) return true;
  if (lower.includes('task-preview')) return true;
  if (lower.includes('screenshots/')) return true;
  if (lower.includes('assets/')) return true;
  if (lower.includes('generated/')) return true;

  return false;
}

function cleanLines(lines) {
  return lines.filter((line) => !isNoiseLine(line));
}

function joinedText(lines) {
  return cleanLines(lines).map(normalizeText).join(' ');
}

function isCodeLine(line) {
  const text = normalizeRaw(line);

  if (isNoiseLine(text)) return false;

  return (
    /^[a-zA-Z_][\w]*\s*=\s*.*$/.test(text) ||
    /^print\s*\(.*/.test(text) ||
    /^input\s*\(.*/.test(text) ||
    /^if\s+.+/.test(text) ||
    /^elif\s+.+/.test(text) ||
    /^else\s*:/.test(text) ||
    /^for\s+.+/.test(text) ||
    /^while\s+.+/.test(text) ||
    /^return\s+.+/.test(text) ||
    /^import\s+.+/.test(text) ||
    /^from\s+.+\s+import\s*.*$/.test(text) ||
    /^def\s+.+/.test(text) ||
    /^[a-zA-Z_][\w.]*\s*\(.*\)$/.test(text)
  );
}

function getCodeLines(lines) {
  return cleanLines(lines).filter(isCodeLine);
}

function hasMcqShape(task, state, lines) {
  const joined = joinedText(lines);

  const hasChoiceOptions =
    Array.isArray(state?.choiceOptions) &&
    state.choiceOptions.length > 0;

  return (
    hasChoiceOptions ||
    joined.includes('mark the correct') ||
    joined.includes('choose the correct') ||
    joined.includes('correct statements') ||
    joined.includes('there may be more than one correct answer') ||
    joined.includes('select the correct') ||
    joined.includes('indicate which are examples')
  );
}

function hasClassificationMatchingShape(lines) {
  const joined = joinedText(lines);
  const codeCount = getCodeLines(lines).length;

  const hasSnippetMatching =
    joined.includes('match the code snippets to the categories') ||
    /match.*code.*snippet.*categor/i.test(joined) ||
    /match.*code.*categor/i.test(joined);

  const hasErrorMatching =
    joined.includes('determine whether the interpreter will output an error') ||
    joined.includes('whether the interpreter will output an error') ||
    (
      joined.includes('there is an error') &&
      joined.includes('no error') &&
      codeCount >= 2
    );

  return hasSnippetMatching || hasErrorMatching;
}

function hasExpressionMatchingShape(lines) {
  const joined = joinedText(lines);
  const codeCount = getCodeLines(lines).length;

  const hasDirectPrompt =
    joined.includes('match the expressions and their values') ||
    joined.includes('match expressions and values') ||
    /match.*expressions?.*values?/i.test(joined);

  const hasExpressionValueContent =
    codeCount >= 2 &&
    (
      joined.includes('return the time') ||
      joined.includes('pause the program') ||
      joined.includes('interpreter will return an error') ||
      joined.includes('generate a random number') ||
      joined.includes('connect all commands')
    );

  return hasDirectPrompt || hasExpressionValueContent;
}

function hasMatchingDragdropShape(lines) {
  const joined = joinedText(lines);
  const codeCount = getCodeLines(lines).length;

  const hasRuleMeaningPrompt =
    joined.includes('correlate the rule names and their meaning') ||
    joined.includes('one name is superfluous') ||
    joined.includes('rule of code design') ||
    joined.includes('rule of order') ||
    joined.includes('the start rule') ||
    joined.includes('parenthesis rule');

  const hasGeneralMatchingPrompt =
    joined.includes('match the names and their meanings') ||
    joined.includes('match the rule names') ||
    joined.includes('match the rule name') ||
    joined.includes('match the terms') ||
    joined.includes('match the definitions') ||
    joined.includes('match names and meanings') ||
    joined.includes('match terms and definitions') ||
    joined.includes('correlate') ||
    joined.includes('superfluous');

  const looksLikeDragDrop =
    joined.includes('attempt:') ||
    joined.includes('attempt') ||
    joined.includes('try again') ||
    joined.includes('a mistake has been made') ||
    joined.includes('drag') ||
    joined.includes('drop');

  if (hasClassificationMatchingShape(lines)) return false;
  if (codeCount >= 2 && hasExpressionMatchingShape(lines)) return false;

  return hasRuleMeaningPrompt || (hasGeneralMatchingPrompt && looksLikeDragDrop);
}

function hasStrongIdeInstruction(lines) {
  const joined = joinedText(lines);

  return (
    joined.includes('fix bugs') ||
    joined.includes('fix bug') ||
    joined.includes('fix errors') ||
    joined.includes('fix the errors') ||
    joined.includes('fix the error') ||
    joined.includes('debug the program') ||
    joined.includes('correct the program') ||
    joined.includes('write the program') ||
    joined.includes('write a program') ||
    joined.includes('write a program that') ||
    joined.includes('program should') ||
    joined.includes('the program should') ||
    joined.includes('should print') ||
    joined.includes('should output') ||
    joined.includes('expected output') ||
    joined.includes('format the result') ||
    joined.includes('result in the picture') ||
    joined.includes('the program combines') ||
    joined.includes('single search query') ||
    joined.includes('fix the errors in the work of the program')
  );
}

function hasPlaceholderTypingShape(task, state, lines) {
  if (hasMcqShape(task, state, lines)) return false;
  if (hasClassificationMatchingShape(lines)) return false;
  if (hasExpressionMatchingShape(lines)) return false;
  if (hasMatchingDragdropShape(lines)) return false;
  if (hasStrongIdeInstruction(lines)) return false;

  const codeLines = getCodeLines(lines);

  return codeLines.length >= 2;
}

function hasFeedbackShape(lines) {
  const joined = joinedText(lines);
  return joined.includes('did you enjoy the task') ||
    joined.includes('did you like the task') ||
    joined.includes('did you like this task') ||
    joined.includes('how was the task') ||
    joined.includes('rate this task') ||
    joined.includes('rate the task') ||
    joined.includes('was this task helpful');
}

function hasLessonFinishShape(lines) {
  const joined = joinedText(lines);
  return (
    joined.includes('way to go') ||
    joined.includes('you finished the task') ||
    joined.includes('you completed the task') ||
    joined.includes('lesson completed') ||
    joined.includes('great job') ||
    joined.includes('congratulations')
  );
}

function inferSubtype(task, state) {
  const source = getCurrentSource(task, state);
  const lines = getLinesFromSource(source);

  if (hasLessonFinishShape(lines)) {
    return 'lesson_finish';
  }

  if (hasFeedbackShape(lines)) {
    return 'feedback';
  }

  if (hasMcqShape(task, state, lines)) {
    return 'mcq';
  }

  if (hasClassificationMatchingShape(lines)) {
    return 'classification_matching';
  }

  if (hasMatchingDragdropShape(lines)) {
    return 'matching_dragdrop';
  }

  if (hasStrongIdeInstruction(lines)) {
    return 'code_editor';
  }

  if (hasExpressionMatchingShape(lines)) {
    return 'generic_capture';
  }

  if (hasPlaceholderTypingShape(task, state, lines)) {
    return 'placeholder_typing';
  }

  return 'generic_capture';
}

function normalizeRendererType(value) {
  const text = String(value || '').trim().toLowerCase();

  if (!text) return '';

  const aliases = {
    'lesson-finish': 'lesson-finish-task',
    'lesson_finish': 'lesson-finish-task',
    'lesson-finish-task': 'lesson-finish-task',
    'way-to-go': 'lesson-finish-task',
    'way_to_go': 'lesson-finish-task',

    'finish-task': 'finish-task',
    'finish_task': 'finish-task',
    finish: 'finish-task',
    finish_slide: 'finish-task',
    finish_slide_task: 'finish-task',
    'finish-slide-task': 'finish-task',
    lesson_slide_card: 'finish-task',
    'lesson-slide-card': 'finish-task',

    feedback: 'feedback-task',
    feedback_task: 'feedback-task',
    'feedback-task': 'feedback-task',

    mcq: 'mcq-checkbox',
    mcq_checkbox: 'mcq-checkbox',
    mcqcheckbox: 'mcq-checkbox',
    'mcq-checkbox': 'mcq-checkbox',

    classification_matching: 'code-classification',
    snippet_matching: 'code-classification',
    code_classification: 'code-classification',
    'code-classification': 'code-classification',

    code_copy_confirm: 'code-copy-confirm-task',
    code_copy_confirm_task: 'code-copy-confirm-task',
    code_copy: 'code-copy-confirm-task',
    code_copy_task: 'code-copy-confirm-task',
    copy_code: 'code-copy-confirm-task',
    copy_code_task: 'code-copy-confirm-task',
    copy_code_confirm: 'code-copy-confirm-task',
    copy_code_confirm_task: 'code-copy-confirm-task',
    codecopyconfirm: 'code-copy-confirm-task',
    codecopyconfirmtask: 'code-copy-confirm-task',
    codecopy: 'code-copy-confirm-task',
    codecopytask: 'code-copy-confirm-task',
    copycode: 'code-copy-confirm-task',
    copycodetask: 'code-copy-confirm-task',
    copycodeconfirm: 'code-copy-confirm-task',
    copycodeconfirmtask: 'code-copy-confirm-task',
    'code-copy-confirm': 'code-copy-confirm-task',
    'code-copy-confirm-task': 'code-copy-confirm-task',
    'code-copy': 'code-copy-confirm-task',
    'code-copy-task': 'code-copy-confirm-task',
    'copy-code': 'code-copy-confirm-task',
    'copy-code-task': 'code-copy-confirm-task',
    'copy-code-confirm': 'code-copy-confirm-task',
    'copy-code-confirm-task': 'code-copy-confirm-task',

    code_editor: 'ide-programming',
    ide_programming: 'ide-programming',
    ide_programming_task: 'ide-programming',
    programming_task: 'ide-programming',
    'ide-programming': 'ide-programming',

    placeholder_typing: 'code-placeholder',
    code_placeholder: 'code-placeholder',
    'code-placeholder': 'code-placeholder',

    typing_practice: 'typing-practice',
    typing_practice_task: 'typing-practice',
    typing_speed: 'typing-practice',
    typing_speed_task: 'typing-practice',
    code_typing: 'typing-practice',
    code_typing_task: 'typing-practice',
    'typing-practice': 'typing-practice',
    'typing-practice-task': 'typing-practice',
    'typing-speed': 'typing-practice',
    'code-typing': 'typing-practice',
    'code-typing-task': 'typing-practice',

    fill_blank: 'fill-blank',
    fill_blank_task: 'fill-blank',
    'fill-blank': 'fill-blank',
    'fill-blank-task': 'fill-blank',

    window_fill_blank: 'window-fill-blank-task',
    window_fill_blank_task: 'window-fill-blank-task',
    windowfillblank: 'window-fill-blank-task',
    windowfillblanktask: 'window-fill-blank-task',
    'window-fill-blank': 'window-fill-blank-task',
    'window-fill-blank-task': 'window-fill-blank-task',

    image_dropzones: 'image-dropzones-task',
    image_dropzones_task: 'image-dropzones-task',
    image_dropzone: 'image-dropzones-task',
    image_dropzone_task: 'image-dropzones-task',
    image_drop: 'image-dropzones-task',
    image_drop_task: 'image-dropzones-task',
    diagram_dropzones: 'image-dropzones-task',
    diagram_dropzones_task: 'image-dropzones-task',
    drag_label_on_image: 'image-dropzones-task',
    drag_label_on_image_task: 'image-dropzones-task',
    imagedropzones: 'image-dropzones-task',
    imagedropzonestask: 'image-dropzones-task',
    imagedropzone: 'image-dropzones-task',
    imagedropzonetask: 'image-dropzones-task',
    diagramdropzones: 'image-dropzones-task',
    diagramdropzonestask: 'image-dropzones-task',
    'image-dropzones': 'image-dropzones-task',
    'image-dropzones-task': 'image-dropzones-task',
    'image-dropzone': 'image-dropzones-task',
    'image-dropzone-task': 'image-dropzones-task',
    'image-drop': 'image-dropzones-task',
    'image-drop-task': 'image-dropzones-task',
    'diagram-dropzones': 'image-dropzones-task',
    'diagram-dropzones-task': 'image-dropzones-task',
    'drag-label-on-image': 'image-dropzones-task',
    'drag-label-on-image-task': 'image-dropzones-task',

    tool_label_dragdrop: 'tool-label-dragdrop',
    tool_label_dragdrop_task: 'tool-label-dragdrop',
    tool_label_drag_drop: 'tool-label-dragdrop',
    tool_label_drag_drop_task: 'tool-label-dragdrop',
    tool_label_drag: 'tool-label-dragdrop',
    tool_label_drag_task: 'tool-label-dragdrop',
    toollabeldragdrop: 'tool-label-dragdrop',
    toollabeldragdroptask: 'tool-label-dragdrop',
    toollabeldrag: 'tool-label-dragdrop',
    toollabeldragtask: 'tool-label-dragdrop',
    'tool-label-dragdrop': 'tool-label-dragdrop',
    'tool-label-dragdrop-task': 'tool-label-dragdrop',
    'tool-label-drag-drop': 'tool-label-dragdrop',
    'tool-label-drag-drop-task': 'tool-label-dragdrop',
    'tool-label-drag': 'tool-label-dragdrop',
    'tool-label-drag-task': 'tool-label-dragdrop',

    connected_blocks: 'connected-blocks-task',
    connected_blocks_task: 'connected-blocks-task',
    connected_block: 'connected-blocks-task',
    connected_block_task: 'connected-blocks-task',
    mindmap: 'connected-blocks-task',
    mindmap_task: 'connected-blocks-task',
    mind_map: 'connected-blocks-task',
    mind_map_task: 'connected-blocks-task',
    node_graph: 'connected-blocks-task',
    node_graph_task: 'connected-blocks-task',
    nodegraph: 'connected-blocks-task',
    nodegraphtask: 'connected-blocks-task',
    connectedblocks: 'connected-blocks-task',
    connectedblockstask: 'connected-blocks-task',
    connectedblock: 'connected-blocks-task',
    connectedblocktask: 'connected-blocks-task',
    'connected-blocks': 'connected-blocks-task',
    'connected-blocks-task': 'connected-blocks-task',
    'connected-block': 'connected-blocks-task',
    'connected-block-task': 'connected-blocks-task',
    'mind-map': 'connected-blocks-task',
    'mind-map-task': 'connected-blocks-task',
    'node-graph': 'connected-blocks-task',
    'node-graph-task': 'connected-blocks-task',

    idea_list: 'idea-list-task',
    idea_list_task: 'idea-list-task',
    ideas: 'idea-list-task',
    ideas_task: 'idea-list-task',
    dynamic_text_list: 'idea-list-task',
    dynamic_text_list_task: 'idea-list-task',
    idealist: 'idea-list-task',
    idealisttask: 'idea-list-task',
    dynamictextlist: 'idea-list-task',
    dynamictextlisttask: 'idea-list-task',
    'idea-list': 'idea-list-task',
    'idea-list-task': 'idea-list-task',
    'ideas-task': 'idea-list-task',
    'dynamic-text-list': 'idea-list-task',
    'dynamic-text-list-task': 'idea-list-task',

    theory_reading: 'theory-reading-task',
    theory_reading_task: 'theory-reading-task',
    theory_task: 'theory-reading-task',
    theory_lesson: 'theory-reading-task',
    text_reading: 'theory-reading-task',
    text_reading_task: 'theory-reading-task',
    theoryreading: 'theory-reading-task',
    theoryreadingtask: 'theory-reading-task',
    'theory-reading': 'theory-reading-task',
    'theory-reading-task': 'theory-reading-task',
    'theory-task': 'theory-reading-task',
    'theory-lesson': 'theory-reading-task',
    'text-reading': 'theory-reading-task',
    'text-reading-task': 'theory-reading-task',

    project_checklist: 'project-checklist-task',
    project_checklist_task: 'project-checklist-task',
    project_task: 'project-checklist-task',
    teacher_checked_task: 'project-checklist-task',
    projectchecklist: 'project-checklist-task',
    projectchecklisttask: 'project-checklist-task',
    'project-checklist': 'project-checklist-task',
    'project-checklist-task': 'project-checklist-task',
    'project-task': 'project-checklist-task',
    'teacher-checked-task': 'project-checklist-task',

    sequence_order: 'sequence-order-task',
    sequence_order_task: 'sequence-order-task',
    order_sequence: 'sequence-order-task',
    order_sequence_task: 'sequence-order-task',
    sortable_sequence: 'sequence-order-task',
    sortable_sequence_task: 'sequence-order-task',
    sequenceorder: 'sequence-order-task',
    sequenceordertask: 'sequence-order-task',
    ordersequence: 'sequence-order-task',
    ordersequencetask: 'sequence-order-task',
    sortablesequence: 'sequence-order-task',
    sortablesequencetask: 'sequence-order-task',
    'sequence-order': 'sequence-order-task',
    'sequence-order-task': 'sequence-order-task',
    'order-sequence': 'sequence-order-task',
    'order-sequence-task': 'sequence-order-task',
    'sortable-sequence': 'sequence-order-task',
    'sortable-sequence-task': 'sequence-order-task',

    google_slide_embed: 'google-slide-embed-task',
    google_slide_embed_task: 'google-slide-embed-task',
    google_slide: 'google-slide-embed-task',
    google_slides: 'google-slide-embed-task',
    google_slide_task: 'google-slide-embed-task',
    google_slides_task: 'google-slide-embed-task',
    slides_embed: 'google-slide-embed-task',
    slides_embed_task: 'google-slide-embed-task',
    slide_embed: 'google-slide-embed-task',
    slide_embed_task: 'google-slide-embed-task',
    googleslideembed: 'google-slide-embed-task',
    googleslideembedtask: 'google-slide-embed-task',
    'google-slide-embed': 'google-slide-embed-task',
    'google-slide-embed-task': 'google-slide-embed-task',
    'google-slide': 'google-slide-embed-task',
    'google-slides': 'google-slide-embed-task',
    'google-slide-task': 'google-slide-embed-task',
    'google-slides-task': 'google-slide-embed-task',
    'slides-embed': 'google-slide-embed-task',
    'slides-embed-task': 'google-slide-embed-task',
    'slide-embed': 'google-slide-embed-task',
    'slide-embed-task': 'google-slide-embed-task',

    youtube_embed: 'youtube-embed-task',
    youtube_embed_task: 'youtube-embed-task',
    youtube_video: 'youtube-embed-task',
    youtube_video_task: 'youtube-embed-task',
    video_embed: 'youtube-embed-task',
    video_embed_task: 'youtube-embed-task',
    video_lesson: 'youtube-embed-task',
    video_lesson_task: 'youtube-embed-task',
    youtubeembed: 'youtube-embed-task',
    youtubeembedtask: 'youtube-embed-task',
    youtubevideo: 'youtube-embed-task',
    youtubevideotask: 'youtube-embed-task',
    videoembed: 'youtube-embed-task',
    videoembedtask: 'youtube-embed-task',
    videolesson: 'youtube-embed-task',
    videolessontask: 'youtube-embed-task',
    'youtube-embed': 'youtube-embed-task',
    'youtube-embed-task': 'youtube-embed-task',
    'youtube-video': 'youtube-embed-task',
    'youtube-video-task': 'youtube-embed-task',
    'video-embed': 'youtube-embed-task',
    'video-embed-task': 'youtube-embed-task',
    'video-lesson': 'youtube-embed-task',
    'video-lesson-task': 'youtube-embed-task',

    matching_connect: 'matching-connect',
    matching_connect_task: 'matching-connect',
    matchingconnect: 'matching-connect',
    matchingconnecttask: 'matching-connect',
    connect_matching: 'matching-connect',
    connect_matching_task: 'matching-connect',
    line_matching: 'matching-connect',
    line_matching_task: 'matching-connect',
    matching_lines: 'matching-connect',
    matching_lines_task: 'matching-connect',
    'matching-connect': 'matching-connect',
    'matching-connect-task': 'matching-connect',
    'connect-matching': 'matching-connect',
    'connect-matching-task': 'matching-connect',
    'line-matching': 'matching-connect',
    'line-matching-task': 'matching-connect',
    'matching-lines': 'matching-connect',
    'matching-lines-task': 'matching-connect',

    scene_classification: 'scene-classification-task',
    scene_classification_task: 'scene-classification-task',
    sceneclassification: 'scene-classification-task',
    sceneclassificationtask: 'scene-classification-task',
    scene_dragdrop: 'scene-classification-task',
    scene_dragdrop_task: 'scene-classification-task',
    'scene-classification': 'scene-classification-task',
    'scene-classification-task': 'scene-classification-task',
    'scene-dragdrop': 'scene-classification-task',
    'scene-dragdrop-task': 'scene-classification-task',

    matching: 'matching-dragdrop',
    matching_dragdrop_task: 'matching-dragdrop',
    matching_dragdrop: 'matching-dragdrop',
    matching_drag_drop: 'matching-dragdrop',
    dragdrop: 'matching-dragdrop',
    drag_drop: 'matching-dragdrop',
    'matching-dragdrop': 'matching-dragdrop',
    'matching-drag-drop': 'matching-dragdrop',
    'matching-dragdrop-task': 'matching-dragdrop',

    generic_capture: 'generic-captured-task',
    generic_captured_task: 'generic-captured-task',
    generic: 'generic-captured-task',
    'generic-captured-task': 'generic-captured-task',

    scratch_embed: 'scratch-embed-task',
    scratch_embed_task: 'scratch-embed-task',
    'scratch-embed': 'scratch-embed-task',
    'scratch-embed-task': 'scratch-embed-task',

    link_download: 'link-download-task',
    link_download_task: 'link-download-task',
    download_link: 'link-download-task',
    download_link_task: 'link-download-task',
    download_task: 'link-download-task',
    'link-download': 'link-download-task',
    'link-download-task': 'link-download-task',
    'download-link': 'link-download-task',
    'download-link-task': 'link-download-task',
    'download-task': 'link-download-task',
  };

  return aliases[text] || text.replaceAll('_', '-');
}

function rendererTypeFromLegacySubtype(subtype) {
  if (subtype === 'mcq') return 'mcq-checkbox';
  if (subtype === 'classification_matching') return 'code-classification';
  if (subtype === 'matching_dragdrop') return 'matching-dragdrop';
  if (subtype === 'code_editor') return 'ide-programming';
  if (subtype === 'placeholder_typing') return 'code-placeholder';
  if (subtype === 'feedback') return 'feedback-task';
  if (subtype === 'lesson_finish') return 'lesson-finish-task';
  return 'generic-captured-task';
}

function getTaskId(task) {
  return String(task?.id || task?.taskId || '').trim();
}

function getStateId(state) {
  return String(state?.id || state?.stateId || '').trim();
}

function getManualMapUrl(pageInstance) {
  try {
    const params = new URLSearchParams(window.location.search);

    const courseId = params.get('course') || '';
    const lessonId = params.get('lesson') || '';
    const pageId = params.get('page') || '';

    if (courseId && lessonId && pageId) {
      return `/manual-activity-maps/${encodeURIComponent(courseId)}/${encodeURIComponent(
        lessonId,
      )}/${encodeURIComponent(pageId)}.activity-map.json`;
    }
  } catch {
    // Fallback to pageInstance below.
  }

  if (typeof pageInstance?.manualActivityMap === 'string') {
    return resolveActivityMapUrl(pageInstance.manualActivityMap);
  }

  const directUrl =
    pageInstance?.manualActivityMap?.url ||
    pageInstance?.manualMapUrl ||
    pageInstance?.manualActivityMapUrl ||
    '';

  if (directUrl) return resolveActivityMapUrl(directUrl);

  const courseId = pageInstance?.courseId || pageInstance?.course?.id || pageInstance?.course || '';
  const lessonId = pageInstance?.lessonId || pageInstance?.lesson?.id || pageInstance?.lesson || '';
  const pageId = pageInstance?.pageId || pageInstance?.page?.id || pageInstance?.id || '';

  if (!courseId || !lessonId || !pageId) return '';

  return `/manual-activity-maps/${encodeURIComponent(courseId)}/${encodeURIComponent(
    lessonId,
  )}/${encodeURIComponent(pageId)}.activity-map.json`;
}

function getManualTask(manualMap, task) {
  const taskId = getTaskId(task);

  if (!taskId) return null;

  return manualMap?.tasks?.[taskId] || null;
}

function getManualState(manualTask, state) {
  const stateId = getStateId(state);

  if (!manualTask || !stateId) return null;

  return manualTask?.states?.[stateId] || null;
}

function mergeManualTask(task, manualTask) {
  if (!manualTask) return task;

  const { states: manualStates = {}, ...manualTaskFields } = manualTask;

  let nextStates = task?.states;

  if (Array.isArray(task?.states)) {
    nextStates = task.states.map((item) => {
      const stateId = getStateId(item);
      const manualState = stateId ? manualStates?.[stateId] : null;

      return manualState ? { ...item, ...manualState } : item;
    });
  }

  return {
    ...task,
    ...manualTaskFields,
    states: nextStates,
  };
}

function mergeManualState(state, manualState) {
  if (!state || !manualState) return state;

  const merged = {
    ...state,
    ...manualState,
  };

  // If manual state selectedType is empty, clear selectedType so it inherits from task
  if (manualState.selectedType === '') {
    delete merged.selectedType;
  }

  return merged;
}

function getRendererFromPageInstance(pageInstance, task, state) {
  const taskId = getTaskId(task);
  const stateId = getStateId(state);

  const taskRenderer = taskId ? pageInstance?.taskRenderers?.[taskId] : null;
  const stateRenderer = taskRenderer && stateId ? taskRenderer.states?.[stateId] : null;

  return (
    task?.selectedType ||
    task?.manualSelectedType ||
    state?.selectedType ||
    state?.manualSelectedType ||
    taskRenderer?.selectedType ||
    taskRenderer?.manualSelectedType ||
    stateRenderer?.selectedType ||
    stateRenderer?.manualSelectedType ||
    task?.renderer?.type ||
    state?.renderer?.type ||
    task?.rendererType ||
    state?.rendererType ||
    taskRenderer?.type ||
    stateRenderer?.type ||
    task?.type ||
    state?.type ||
    ''
  );
}

function resolveRendererType({ pageInstance, task, state }) {
  if (
    task?.finishTask ||
    task?.finish_task ||
    task?.renderer?.finishTask ||
    task?.renderer?.finish_task
  ) {
    return 'finish-task';
  }

  // Explicit non-generic selectedType on task has highest priority
  const taskSelected = normalizeRendererType(task?.selectedType || task?.manualSelectedType);
  if (taskSelected && taskSelected !== 'generic-captured-task') {
    return taskSelected;
  }

  // Explicit non-generic selectedType on state
  const stateSelected = normalizeRendererType(state?.selectedType || state?.manualSelectedType);
  if (stateSelected && stateSelected !== 'generic-captured-task') {
    return stateSelected;
  }

  if (
    task?.sceneClassification ||
    task?.scenesTask ||
    task?.scenes ||
    task?.renderer?.sceneClassification
  ) {
    return 'scene-classification-task';
  }

  if (
    task?.imageDropzones ||
    task?.diagramDropzones ||
    task?.renderer?.imageDropzones ||
    task?.renderer?.diagramDropzones ||
    task?.matchingDragdrop?.mode === 'image-drop' ||
    task?.renderer?.matchingDragdrop?.mode === 'image-drop'
  ) {
    return 'image-dropzones-task';
  }

  if (
    task?.matchingConnect ||
    task?.matching_connect ||
    task?.renderer?.matchingConnect ||
    task?.renderer?.matching_connect ||
    state?.matchingConnect ||
    state?.matching_connect ||
    state?.renderer?.matchingConnect ||
    state?.renderer?.matching_connect
  ) {
    return 'matching-connect';
  }

  if (
    task?.codeCopyConfirm ||
    task?.codeCopy ||
    task?.copyCode ||
    state?.codeCopyConfirm ||
    state?.codeCopy
  ) {
    return 'code-copy-confirm-task';
  }

  if (
    task?.linkDownload ||
    task?.downloadLink ||
    state?.linkDownload
  ) {
    return 'link-download-task';
  }

  if (
    task?.scratchEmbed ||
    task?.scratch ||
    state?.scratchEmbed ||
    state?.scratch
  ) {
    return 'scratch-embed-task';
  }

  if (
    task?.windowFillBlank ||
    task?.windowFill ||
    state?.windowFillBlank ||
    state?.windowFill
  ) {
    return 'window-fill-blank-task';
  }

  if (
    task?.theoryReading ||
    task?.theoryTask ||
    state?.theoryReading
  ) {
    return 'theory-reading-task';
  }

  if (
    task?.toolLabelDragdrop ||
    task?.tool_label_dragdrop ||
    task?.renderer?.toolLabelDragdrop ||
    task?.renderer?.tool_label_dragdrop ||
    state?.toolLabelDragdrop ||
    state?.tool_label_dragdrop ||
    state?.renderer?.toolLabelDragdrop ||
    state?.renderer?.tool_label_dragdrop
  ) {
    return 'tool-label-dragdrop';
  }

  const fromInstance = getRendererFromPageInstance(pageInstance, task, state);
  const normalizedFromInstance = normalizeRendererType(fromInstance);
  if (normalizedFromInstance && normalizedFromInstance !== 'generic-captured-task') {
    return normalizedFromInstance;
  }

  const fromManifest =
    state?.selectedType ||
    task?.selectedType ||
    state?.manualSelectedType ||
    task?.manualSelectedType ||
    state?.renderer?.type ||
    task?.renderer?.type ||
    state?.rendererType ||
    task?.rendererType ||
    state?.type ||
    task?.type ||
    '';
  const normalizedFromManifest = normalizeRendererType(fromManifest);
  if (normalizedFromManifest && normalizedFromManifest !== 'generic-captured-task') {
    return normalizedFromManifest;
  }

  const type = String(task?.activityType || '').toLowerCase();

  if (
    type === 'code_copy_confirm_task' ||
    type === 'code_copy_confirm' ||
    type === 'code-copy-confirm' ||
    type === 'code-copy-confirm-task' ||
    type === 'code_copy_task' ||
    type === 'code_copy' ||
    type === 'code-copy' ||
    type === 'code-copy-task' ||
    type === 'copy_code_task' ||
    type === 'copy_code' ||
    type === 'copy-code' ||
    type === 'copy-code-task' ||
    type === 'copy_code_confirm_task' ||
    type === 'copy_code_confirm' ||
    type === 'copy-code-confirm' ||
    type === 'copy-code-confirm-task'
  ) {
    return 'code-copy-confirm-task';
  }

  if (
    type === 'connected_blocks_task' ||
    type === 'connected_blocks' ||
    type === 'connected-blocks' ||
    type === 'connected-blocks-task' ||
    type === 'connected_block_task' ||
    type === 'connected_block' ||
    type === 'connected-block' ||
    type === 'connected-block-task' ||
    type === 'mindmap_task' ||
    type === 'mindmap' ||
    type === 'mind_map_task' ||
    type === 'mind_map' ||
    type === 'mind-map' ||
    type === 'mind-map-task' ||
    type === 'node_graph_task' ||
    type === 'node_graph' ||
    type === 'node-graph' ||
    type === 'node-graph-task'
  ) {
    return 'connected-blocks-task';
  }

  if (
    type === 'idea_list_task' ||
    type === 'idea_list' ||
    type === 'idea-list' ||
    type === 'idea-list-task' ||
    type === 'dynamic_text_list_task' ||
    type === 'dynamic_text_list' ||
    type === 'dynamic-text-list' ||
    type === 'dynamic-text-list-task'
  ) {
    return 'idea-list-task';
  }

  if (
    type === 'sequence_order_task' ||
    type === 'sequence_order' ||
    type === 'sequence-order' ||
    type === 'sequence-order-task' ||
    type === 'order_sequence_task' ||
    type === 'order_sequence' ||
    type === 'order-sequence' ||
    type === 'order-sequence-task' ||
    type === 'sortable_sequence_task' ||
    type === 'sortable_sequence' ||
    type === 'sortable-sequence' ||
    type === 'sortable-sequence-task'
  ) {
    return 'sequence-order-task';
  }

  if (
    type === 'google_slide_embed_task' ||
    type === 'google_slide_embed' ||
    type === 'google-slide-embed' ||
    type === 'google-slide-embed-task' ||
    type === 'google_slide_task' ||
    type === 'google_slide' ||
    type === 'google-slide' ||
    type === 'google-slide-task' ||
    type === 'slides_embed_task' ||
    type === 'slides_embed' ||
    type === 'slides-embed' ||
    type === 'slides-embed-task' ||
    type === 'slide_embed_task' ||
    type === 'slide_embed' ||
    type === 'slide-embed' ||
    type === 'slide-embed-task'
  ) {
    return 'google-slide-embed-task';
  }

  if (
    type === 'youtube_embed_task' ||
    type === 'youtube_embed' ||
    type === 'youtube-embed' ||
    type === 'youtube-embed-task' ||
    type === 'youtube_video_task' ||
    type === 'youtube_video' ||
    type === 'youtube-video' ||
    type === 'youtube-video-task' ||
    type === 'video_embed_task' ||
    type === 'video_embed' ||
    type === 'video-embed' ||
    type === 'video-embed-task' ||
    type === 'video_lesson' ||
    type === 'video_lesson_task' ||
    type === 'video-lesson' ||
    type === 'video-lesson-task'
  ) {
    return 'youtube-embed-task';
  }

  if (
    type === 'project_checklist_task' ||
    type === 'project_checklist' ||
    type === 'project-task' ||
    type === 'project-checklist' ||
    type === 'project-checklist-task' ||
    type === 'teacher_checked_task' ||
    type === 'teacher-checked-task'
  ) {
    return 'project-checklist-task';
  }

  if (
    type === 'window_fill_blank_task' ||
    type === 'window_fill_blank' ||
    type === 'window-fill-blank' ||
    type === 'window-fill-blank-task'
  ) {
    return 'window-fill-blank-task';
  }

  if (
    type === 'tool_label_dragdrop_task' ||
    type === 'tool_label_dragdrop' ||
    type === 'tool_label_drag_drop_task' ||
    type === 'tool_label_drag_drop' ||
    type === 'tool-label-dragdrop' ||
    type === 'tool-label-dragdrop-task' ||
    type === 'tool-label-drag-drop' ||
    type === 'tool-label-drag-drop-task'
  ) {
    return 'tool-label-dragdrop';
  }

  if (
    type === 'matching_connect_task' ||
    type === 'matching_connect' ||
    type === 'matching-connect' ||
    type === 'matching-connect-task' ||
    type === 'line_matching_task' ||
    type === 'line_matching' ||
    type === 'line-matching' ||
    type === 'line-matching-task'
  ) {
    return 'matching-connect';
  }

  if (
    type === 'matching_dragdrop_task' ||
    type === 'matching_dragdrop' ||
    type === 'matching-dragdrop' ||
    type === 'matching-dragdrop-task'
  ) {
    return 'matching-dragdrop';
  }

  if (
    type === 'ide_programming_task' ||
    type === 'idle_programming_task' ||
    type === 'programming_task'
  ) {
    return 'ide-programming';
  }

  if (
    type === 'fill_blank_task' ||
    type === 'fill_blank' ||
    type === 'fill-blank' ||
    type === 'fill-blank-task'
  ) {
    return 'fill-blank';
  }

  if (type === 'feedback-task') {
    return 'feedback-task';
  }

  if (
    type === 'finish-task' ||
    type === 'finish_task' ||
    type === 'finish' ||
    type === 'finish_slide' ||
    type === 'finish_slide_task' ||
    type === 'finish-slide-task' ||
    type === 'lesson_slide_card' ||
    type === 'lesson-slide-card'
  ) {
    return 'finish-task';
  }

  if (
    type === 'lesson-finish-task' ||
    type === 'lesson_finish' ||
    type === 'lesson-finish' ||
    type === 'way-to-go' ||
    type === 'way_to_go'
  ) {
    return 'lesson-finish-task';
  }

  const subtype = inferSubtype(task, state);
  return rendererTypeFromLegacySubtype(subtype);
}

function singleStateTask(task, state) {
  if (!state) return task;

  return {
    ...task,
    states: [state],
  };
}

export default function ActivityRouter(props) {
  const { task, state, rawMode, pageInstance, completedTaskIds } = props;
  const manualMapUrl = getManualMapUrl(pageInstance);
  const [manualMap, setManualMap] = useState(null);

  useEffect(() => {
    let cancelled = false;

    setManualMap(null);

    if (!manualMapUrl) return undefined;

    fetch(manualMapUrl)
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((nextManualMap) => {
        if (cancelled) return;
        setManualMap(nextManualMap);
      })
      .catch(() => {
        if (!cancelled) setManualMap(null);
      });

    return () => {
      cancelled = true;
    };
  }, [manualMapUrl]);

  const effectiveProps = useMemo(() => {
    const manualTask = getManualTask(manualMap, task);
    const manualState = getManualState(manualTask, state);

    const nextTask = mergeManualTask(task, manualTask);
    const nextState = mergeManualState(state, manualState);

    // Determine if the current task is already completed
    const currentTaskId =
      String(nextTask?.id || nextTask?.taskId || '').trim();
    const isTaskDone =
      Array.isArray(completedTaskIds) &&
      currentTaskId !== '' &&
      completedTaskIds.includes(currentTaskId);

    function reportTaskCompleted(completion = {}) {
      const completionHandler =
        typeof props.onTaskComplete === 'function'
          ? props.onTaskComplete
          : typeof props.onTaskCompleted === 'function'
            ? props.onTaskCompleted
            : null;

      if (completionHandler) {
        return completionHandler({
          ...(typeof completion === 'object' ? completion : {}),
          taskId: completion?.taskId || currentTaskId,
        });
      }
    }

    return {
      ...props,
      task: nextTask,
      state: nextState,
      isTaskDone,
      onNextTask: props.onNextTask,
      onTaskComplete: reportTaskCompleted,
      onTaskCompleted: reportTaskCompleted,
    };
  }, [props, manualMap, task, state, completedTaskIds]);

  if (rawMode) {
    return <GenericCapturedTask {...effectiveProps} forceReplay />;
  }

  const rendererType = resolveRendererType(effectiveProps);
  const nextTask = singleStateTask(effectiveProps.task, effectiveProps.state);
  const taskKey = getTaskId(nextTask) || `task-${rendererType}`;

  if (rendererType === 'lesson-finish-task') {
    return <LessonFinishTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'finish-task') {
    return <FinishTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'feedback-task') {
    return <FeedbackTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'image-dropzones-task') {
    return <ImageDropzonesTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'mcq-checkbox') {
    return <McqCheckboxTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'code-classification') {
    return <CodeClassificationTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'code-copy-confirm-task') {
    return <CodeCopyConfirmTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'ide-programming') {
    return <IdeProgrammingTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'code-placeholder') {
    return <CodePlaceholderTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'typing-practice') {
    return <TypingPracticeTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'matching-connect') {
    return <MatchingConnectTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'tool-label-dragdrop') {
    return <ToolLabelDragdropTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'matching-dragdrop') {
    return <MatchingDragdropTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'fill-blank') {
    return <FillBlankTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'window-fill-blank-task') {
    return <WindowFillBlankTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'project-checklist-task') {
    return <ProjectChecklistTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'google-slide-embed-task') {
    return <GoogleSlideEmbedTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'youtube-embed-task') {
    return <YoutubeEmbedTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'scene-classification-task') {
    return <SceneClassificationTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'sequence-order-task') {
    return <SequenceOrderTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'idea-list-task') {
    return <IdeaListTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'connected-blocks-task') {
    return <ConnectedBlocksTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'theory-reading-task') {
    return <TheoryReadingTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'scratch-embed-task') {
    return <ScratchEmbedTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  if (rendererType === 'link-download-task') {
    return <LinkDownloadTask key={taskKey} {...effectiveProps} task={nextTask} />;
  }

  return <GenericCapturedTask key={taskKey} {...effectiveProps} />;
}