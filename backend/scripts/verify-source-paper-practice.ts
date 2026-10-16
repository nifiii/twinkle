/** Local, synthetic-only provider acceptance. Never reads production books. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.argv[2] || ".env") });
if (!process.env.ARK_API_KEY || !process.env.ARK_MODEL_ID)
  throw new Error("需要当前本地 .env 的模型配置；不输出配置值");
const directory = await mkdtemp(path.join(tmpdir(), "twinkle-source-paper-"));
process.env.DATA_DIR = directory;
const [{ default: database, initDatabase }, service, { renderAssessmentPdf }] =
  await Promise.all([
    import("../src/services/databaseService.js"),
    import("../src/services/sourcePaperPracticeService.js"),
    import("../src/services/exportService.js"),
  ]);
initDatabase();
database
  .prepare(
    "UPDATE users SET baseGrade=4,baseGradeSetAt=?,birthDate=NULL WHERE id='child_1'",
  )
  .run(new Date().toISOString().slice(0, 7));
const output = path.resolve("../output/source-paper-verification");
await mkdir(output, { recursive: true });
const reports = [];
for (const [name, counts] of [
  ["twenty", [6, 4, 10]],
  ["forty", [10, 10, 20]],
] as const) {
  if (process.argv[3] && process.argv[3] !== name) continue;
  const startedAt = Date.now();
  const body = [
    "# 四年级英语完整笔试卷（合成验收资料，不含听力，无图片）",
    "## 一、选择正确单词（每行一道子题）",
    ...Array.from(
      { length: counts[0] },
      (_, i) =>
        `${i + 1}. There are ${i + 2} books on the table. Choose the number word. A. ${["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"][i]} B. green C. classroom`,
    ),
    "## 二、从词库选词填空（每行一道子题）",
    "完整词库：school, red, cat, teacher, playground, pencil, book, bag, happy, friend。每词可以重复使用。",
    ...Array.from(
      { length: counts[1] },
      (_, i) =>
        `${i + 1}. This is my ${["school", "red bag", "cat", "teacher", "playground", "pencil", "book", "bag", "happy friend", "friend"][i]}. The key word in this sentence is _____.`,
    ),
    "## 三、阅读短文并选择（每行一道子题）",
    "阅读材料：My name is Sam. I am nine. I go to school with my sister. We have English on Monday and Friday. My favourite colour is blue. There is a small garden at our school. We read books there after class. My sister likes drawing trees. I like playing football. We go home at four. On Sunday we visit our grandmother.",
    ...Array.from(
      { length: counts[2] },
      (_, i) =>
        `${i + 1}. ${["What is the boy's name?", "How old is Sam?", "Who goes to school with Sam?", "What subject do they have on Monday?", "What is Sam's favourite colour?", "Where is the garden?", "What do they do after class?", "What does his sister draw?", "What sport does Sam like?", "When do they go home?"][i % 10]} A. Sam / nine / sister / English / blue / school / read / trees / football / four B. Unrelated choice C. Another unrelated choice`,
    ),
    "卷末知识点说明：星期词、颜色词、家庭成员和从短文定位信息。全卷结束。",
  ].join("\n");
  const mdPath = path.join(directory, `${name}.md`);
  await writeFile(mdPath, body);
  database
    .prepare(
      "INSERT INTO books (id,title,ownerId,subject,grade,category,tags,status,mdPath,tableOfContents) VALUES (?,?, 'shared','英语','小学四年级','试卷','[]','completed',?,'[]')",
    )
    .run(name, `合成四年级英语完整笔试卷${name}`, mdPath);
  const jobs: Array<() => Promise<void>> = [];
  const dependencies = {
    database,
    schedule: (work: () => Promise<void>) => jobs.push(work),
  };
  console.log(
    `${name}: analysing ${counts.reduce((n, x) => n + x, 0)} synthetic items`,
  );
  const accepted = await service.requestSourcePaperAnalysis(
    { ownerId: "child_1", bookId: name, requestKey: `analysis-${name}` },
    dependencies,
  );
  await jobs.shift()!();
  const analysis = service.getSourcePaperAnalysis(
    "child_1",
    { id: accepted.id },
    database,
  );
  assert.equal(
    analysis.status,
    "ready",
    analysis.error || "analysis not ready",
  );
  assert.deepEqual(
    analysis.summary!.sections.map((s) => s.questionCount),
    [...counts],
  );
  console.log(`${name}: structure correct, generating`);
  const task = await service.createSourcePaperTask(
    {
      ownerId: "child_1",
      requestKey: `task-${name}`,
      taskType: "assessment",
      source: {
        kind: "source_paper",
        analysisId: accepted.id,
        counts: [...counts],
      },
    },
    dependencies,
  );
  await jobs.shift()!();
  const row = database
    .prepare(
      "SELECT generationStatus,errorMessage FROM learning_tasks WHERE id=?",
    )
    .get(task.id) as any;
  assert.equal(
    row.generationStatus,
    "ready",
    row.errorMessage || "task not ready",
  );
  const stored = database
    .prepare(
      "SELECT p.id,p.contentJson FROM assessment_papers p JOIN learning_task_links l ON l.entityId=p.id WHERE l.taskId=?",
    )
    .get(task.id) as any;
  const paper = JSON.parse(stored.contentJson);
  assert.deepEqual(
    paper.sections.map((s: any) => s.questions.length),
    [...counts],
  );
  for (const variant of ["paper", "answer"] as const)
    await writeFile(
      path.join(output, `${name}-${variant}.pdf`),
      await renderAssessmentPdf(paper, variant, Date.now()),
    );
  await writeFile(
    path.join(output, `${name}-generated.json`),
    JSON.stringify(paper, null, 2),
  );
  reports.push({
    name,
    counts,
    analysisId: analysis.id,
    taskId: task.id,
    paperId: stored.id,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    passed: true,
  });
  console.log(`${name}: passed; ${reports.at(-1)!.elapsedSeconds}s`);
}
await writeFile(
  path.join(output, "report.json"),
  JSON.stringify(
    { environment: "local-synthetic", directory, reports },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, directory, reports }, null, 2));
database.close();
