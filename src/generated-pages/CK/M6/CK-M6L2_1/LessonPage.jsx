import GeneratedPageShell from '../../../GeneratedPageShell.jsx';

export default function LessonPage({
  courseId,
  lessonId,
  pageId,
  onBackToPages,
}) {
  return (
    <GeneratedPageShell
      manifestUrl="/courses/CK/M6/pages/CK-M6L2_1/manifest.json"
      pageInstanceUrl="/courses/CK/M6/pages/CK-M6L2_1/page.instance.json"
      courseId={courseId}
      lessonId={lessonId}
      pageId={pageId}
      onBackToPages={onBackToPages}
    />
  );
}
