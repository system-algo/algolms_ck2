import GeneratedPageShell from '../../../GeneratedPageShell.jsx';

export default function LessonPage({
  courseId,
  lessonId,
  pageId,
  onBackToPages,
}) {
  return (
    <GeneratedPageShell
      manifestUrl="/courses/CK/CK_M3L2/pages/CK-M3L2_3/manifest.json"
      pageInstanceUrl="/courses/CK/CK_M3L2/pages/CK-M3L2_3/page.instance.json"
      courseId={courseId}
      lessonId={lessonId}
      pageId={pageId}
      onBackToPages={onBackToPages}
    />
  );
}
