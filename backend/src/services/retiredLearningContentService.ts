import Database from 'better-sqlite3';

export type RetiredLearningContentType =
  | 'learning_task'
  | 'classroom_courseware'
  | 'classroom_quiz'
  | 'learning_package'
  | 'assessment_paper'
  | 'quiz_result';

export function isRetiredLearningContent(
  database: Database.Database,
  ownerId: unknown,
  entityId: string,
  entityTypes: readonly RetiredLearningContentType[],
): boolean {
  if (typeof ownerId !== 'string' || !ownerId.trim() || !entityId || entityTypes.length === 0) return false;
  const placeholders = entityTypes.map(() => '?').join(', ');
  return Boolean(database.prepare(`
    SELECT 1 FROM retired_learning_content
    WHERE ownerId = ? AND entityId = ? AND entityType IN (${placeholders})
    LIMIT 1
  `).get(ownerId.trim(), entityId, ...entityTypes));
}
