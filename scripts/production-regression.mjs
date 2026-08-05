import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.PRODUCTION_BASE_URL || 'https://dd.haokuai.uk').replace(/\/$/, '');
const ownerId = process.env.PRODUCTION_OWNER_ID || 'child_1';
const writeMode = process.argv.includes('--write');
const results = [];
const createdTaskIds = [];

function record(id, status, detail) {
  results.push({ id, status, detail });
  console.log(`${status.toUpperCase()} ${id}${detail ? `: ${detail}` : ''}`);
}

function expect(id, condition, detail) {
  if (condition) record(id, 'passed', detail);
  else record(id, 'failed', detail);
  return condition;
}

async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${baseUrl}${url}`, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function requireData(id, url) {
  const { response, body } = await request(url);
  expect(id, response.ok && body.success, `${response.status} ${body.error || ''}`.trim());
  if (!response.ok || !body.success) throw new Error(`${id} failed`);
  return body.data;
}

function tocEntries(nodes = []) {
  return nodes.flatMap(node => [node, ...tocEntries(node.children || [])]);
}

function subjectOf(book) {
  return book.subject || book.metadata?.subject || '';
}

function titleOf(book) {
  return book.title || book.metadata?.title || '';
}

function chaptersOf(book) {
  return tocEntries(book.tableOfContents || book.metadata?.tableOfContents || [])
    .filter(node => node.id !== undefined && node.id !== null && node.title)
    .map(node => ({ id: String(node.id), title: String(node.title) }));
}

function isOlympiad(book) {
  return /奥数|希望杯|数学竞赛/.test(`${book.category || ''}${(book.tags || []).join('')}${titleOf(book)}`);
}

function expectedActions(subject) {
  const common = ['courseware', 'classroom_quiz', 'assessment'];
  if (subject === '英语') return [...common, 'english_listening'];
  if (subject === '数学') return [...common, 'math_thinking'];
  return common;
}

async function createChapterTask(taskType, book, chapter, options = {}) {
  const startedAt = Date.now();
  const { response, body } = await request('/api/learning-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerId,
      userName: '生产验收',
      requestKey: `production-regression-${randomUUID()}`,
      taskType,
      source: { kind: 'chapter', bookId: book.id, chapterIds: [chapter.id], options },
    }),
  });
  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  expect(`write-${taskType}`, response.ok && body.success && body.data?.generationStatus === 'ready', `${response.status}; ${durationSeconds}s; ${body.error || body.data?.generationStatus || ''}`);
  if (body.data?.id) createdTaskIds.push(body.data.id);
  return body.data;
}

async function waitForExport(id) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const job = await requireData(`export-status-${attempt + 1}`, `/api/exports/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(ownerId)}`);
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return null;
}

async function exercisePaperAttempt(paperId) {
  const paper = await requireData('write-assessment-paper', `/api/assessment-papers/${encodeURIComponent(paperId)}?ownerId=${encodeURIComponent(ownerId)}`);
  const question = paper.content?.sections?.flatMap(section => section.questions || [])[0];
  expect('write-assessment-has-question', Boolean(question?.id), paperId);
  if (!question?.id) return;
  const created = await requireData('write-paper-attempt-create', '/api/paper-attempts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId, paperId }),
  });
  const submitted = await requireData('write-paper-attempt-submit', `/api/paper-attempts/${encodeURIComponent(created.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId, action: 'submit', answers: { [question.id]: 'A' } }),
  });
  expect('write-paper-attempt-submitted', submitted.status === 'submitted', submitted.id);
  const review = await requireData('write-paper-attempt-review', `/api/paper-attempts/${encodeURIComponent(created.id)}/review?ownerId=${encodeURIComponent(ownerId)}`);
  expect('write-paper-review-items', review.items?.some(item => item.questionId === question.id && item.referenceAnswer && item.explanation), created.id);
  const reinforcement = await requireData('write-paper-reinforcement', `/api/paper-attempts/${encodeURIComponent(created.id)}/review-items/${encodeURIComponent(question.id)}/reinforcement`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId, needsReinforcement: true }),
  });
  expect('write-paper-reinforcement-state', reinforcement.needsReinforcement === true, question.id);
  const exported = await requireData('write-paper-export-create', `/api/assessment-papers/${encodeURIComponent(paperId)}/exports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId, variant: 'paper' }),
  });
  const exportJob = await waitForExport(exported.id);
  expect('write-paper-export-completed', exportJob?.status === 'completed' && Boolean(exportJob.downloadUrl), exported.id);
}

async function exerciseListeningAudio(packageId) {
  const listeningPackage = await requireData('write-listening-package', `/api/learning-packages/${encodeURIComponent(packageId)}?ownerId=${encodeURIComponent(ownerId)}`);
  const profiles = listeningPackage.content?.audioProfiles || {};
  for (const speed of ['slow', 'standard', 'fast']) {
    const profile = profiles[speed];
    if (!profile?.request) {
      expect(`write-listening-${speed}`, false, 'missing audio profile');
      continue;
    }
    const { response, body } = await request('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile.request),
    });
    expect(`write-listening-${speed}`, response.ok && body.success && typeof body.audio === 'string' && body.audio.length > 100, `${response.status}; ${body.error || ''}`.trim());
  }
}

async function main() {
  const health = await request('/api/health');
  expect('health', health.response.ok && health.body.status === 'ok', String(health.response.status));

  const users = await requireData('users', '/api/users');
  expect('owner-context', users.some(user => user.id === ownerId), ownerId);
  const books = await requireData('books', `/api/books?ownerId=${encodeURIComponent(ownerId)}`);
  const regularBooks = books.filter(book => !isOlympiad(book));
  const booksBySubject = new Map(['语文', '数学', '英语', '科学'].map(subject => [subject, regularBooks.find(book => subjectOf(book) === subject)]));
  for (const [subject, book] of booksBySubject) {
    const chapters = book ? chaptersOf(book) : [];
    expect(`book-${subject}`, Boolean(book) && chapters.length > 0, book ? `${titleOf(book)}; ${chapters.length} chapters` : 'missing');
    if (!book || !chapters.length) continue;
    const actions = await requireData(`actions-${subject}`, `/api/assistant/books/${encodeURIComponent(book.id)}/chapters/${encodeURIComponent(chapters[0].id)}/actions?ownerId=${encodeURIComponent(ownerId)}`);
    const enabled = actions.filter(action => action.available).map(action => action.action);
    expect(`actions-${subject}-contract`, expectedActions(subject).every(action => enabled.includes(action)), enabled.join(','));
  }

  const taskPage = await requireData('task-index', `/api/learning-tasks?ownerId=${encodeURIComponent(ownerId)}&limit=100`);
  const taskItems = taskPage.items || [];
  const byTarget = new Map();
  for (const item of taskItems.filter(item => item.primaryLink)) {
    const key = `${item.primaryLink.entityType}:${item.primaryLink.entityId}`;
    byTarget.set(key, [...(byTarget.get(key) || []), item]);
  }
  const duplicatedTargets = [...byTarget.entries()].filter(([, entries]) => entries.length > 1);
  expect('task-index-no-duplicates', duplicatedTargets.length === 0, duplicatedTargets.map(([key]) => key).join(','));
  const staleRunning = taskItems.filter(item => item.generationStatus === 'running' && Date.now() - item.updatedAt > 5 * 60_000);
  expect('task-index-no-stale-running', staleRunning.length === 0, staleRunning.map(item => item.id).join(','));

  for (const item of taskItems.filter(item => item.source === 'task').slice(0, 20)) {
    const detail = await requireData(`task-detail-${item.id}`, `/api/learning-tasks/${encodeURIComponent(item.id)}?ownerId=${encodeURIComponent(ownerId)}`);
    expect(`task-detail-status-${item.id}`, detail.generationStatus === item.generationStatus, detail.generationStatus);
  }

  const courseware = taskItems.find(item => item.taskType === 'courseware' && item.source === 'task' && item.generationStatus === 'ready');
  if (courseware) {
    const detail = await requireData('courseware-task-detail', `/api/learning-tasks/${encodeURIComponent(courseware.id)}?ownerId=${encodeURIComponent(ownerId)}`);
    expect('courseware-has-practice', detail.links?.some(link => link.entityType === 'classroom_quiz' && link.role === 'practice'), courseware.id);
  } else record('courseware-has-practice', 'skipped', 'no ready courseware task');

  const listening = taskItems.find(item => item.taskType === 'english_listening' && item.source === 'task' && item.generationStatus === 'ready' && item.primaryLink?.entityType === 'learning_package');
  if (listening) {
    const listeningPackage = await requireData('listening-package', `/api/learning-packages/${encodeURIComponent(listening.primaryLink.entityId)}?ownerId=${encodeURIComponent(ownerId)}`);
    expect('listening-speed-profiles', ['slow', 'standard', 'fast'].every(key => listeningPackage.content?.audioProfiles?.[key]), listening.primaryLink.entityId);
  } else record('listening-speed-profiles', 'skipped', 'no ready listening package');

  const paperTask = taskItems.find(item => item.taskType === 'assessment' && item.source === 'task' && item.generationStatus === 'ready' && item.primaryLink?.entityType === 'assessment_paper');
  if (paperTask) {
    const paper = await requireData('assessment-paper', `/api/assessment-papers/${encodeURIComponent(paperTask.primaryLink.entityId)}?ownerId=${encodeURIComponent(ownerId)}`);
    const questionCount = paper.content?.sections?.reduce((count, section) => count + (section.questions?.length || 0), 0) || 0;
    expect('assessment-paper-items', questionCount > 0, `${paperTask.primaryLink.entityId}; ${questionCount} questions`);
  } else record('assessment-paper-items', 'skipped', 'no ready assessment task');

  if (writeMode) {
    const chinese = booksBySubject.get('语文');
    const english = booksBySubject.get('英语');
    const math = booksBySubject.get('数学');
    const coursewareTask = chinese && await createChapterTask('courseware', chinese, chaptersOf(chinese)[0]);
    const listeningTask = english && await createChapterTask('english_listening', english, chaptersOf(english)[0]);
    const assessmentTask = math && await createChapterTask('assessment', math, chaptersOf(math)[0], { examType: 'unit', difficulty: 'standard' });
    if (coursewareTask?.id) {
      const detail = await requireData('write-courseware-detail', `/api/learning-tasks/${encodeURIComponent(coursewareTask.id)}?ownerId=${encodeURIComponent(ownerId)}`);
      expect('write-courseware-practice-link', detail.links?.some(link => link.entityType === 'classroom_quiz' && link.role === 'practice'), coursewareTask.id);
    }
    if (listeningTask?.primaryLink?.entityId) await exerciseListeningAudio(listeningTask.primaryLink.entityId);
    if (assessmentTask?.primaryLink?.entityId) await exercisePaperAttempt(assessmentTask.primaryLink.entityId);
  } else record('write-generation', 'skipped', 'run with --write to create three original tasks');
}

try {
  await main();
} catch (error) {
  record('runner', 'failed', error instanceof Error ? error.message : String(error));
}

const report = { baseUrl, ownerId, writeMode, createdTaskIds, results, finishedAt: new Date().toISOString() };
const reportDirectory = path.resolve('output', 'production-regression');
await mkdir(reportDirectory, { recursive: true });
const reportPath = path.join(reportDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`REPORT ${reportPath}`);
process.exitCode = results.some(result => result.status === 'failed') ? 1 : 0;
