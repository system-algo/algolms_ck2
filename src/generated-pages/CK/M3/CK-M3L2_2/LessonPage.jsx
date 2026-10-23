import GeneratedPageShell from '../../../GeneratedPageShell.jsx';

export default function LessonPage({
  courseId,
  lessonId,
  pageId,
  onBackToPages,
}) {
  return (
    <GeneratedPageShell
      manifestUrl="/courses/CK/M3/pages/CK-M3L2_2/manifest.json"
      pageInstanceUrl="/courses/CK/M3/pages/CK-M3L2_2/page.instance.json"
      courseId={courseId}
      lessonId={lessonId}
      pageId={pageId}
      onBackToPages={onBackToPages}
    />
  );
}
