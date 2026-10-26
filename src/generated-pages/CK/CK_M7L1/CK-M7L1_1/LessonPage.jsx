import GeneratedPageShell from '../../../GeneratedPageShell.jsx';

export default function LessonPage({
  courseId,
  lessonId,
  pageId,
  onBackToPages,
}) {
  return (
    <GeneratedPageShell
      manifestUrl="/courses/CK/CK_M7L1/pages/CK-M7L1_1/manifest.json"
      pageInstanceUrl="/courses/CK/CK_M7L1/pages/CK-M7L1_1/page.instance.json"
      courseId={courseId}
      lessonId={lessonId}
      pageId={pageId}
      onBackToPages={onBackToPages}
    />
  );
}
