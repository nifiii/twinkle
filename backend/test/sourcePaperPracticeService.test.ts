import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { initLearningDomainDatabase } from "../src/services/learningDomain.js";
import {
  createSourcePaperTask,
  getSourcePaperAnalysis,
  listSourcePapers,
  requestSourcePaperAnalysis,
  SourcePaperDependencies,
} from "../src/services/sourcePaperPracticeService.js";
import {
  expireStaleLearningTasks,
  getLearningTask,
} from "../src/services/learningTaskService.js";
import {
  createPaperAttempt,
  updatePaperAttempt,
} from "../src/services/paperAttemptService.js";
import { getPaperAttemptReview } from "../src/services/answerReviewService.js";
import { getChapterActions } from "../src/services/textbookTaskService.js";
import { createAssessmentBlueprint } from "../src/services/assessmentPaperService.js";

function fixture(counts = [6, 4, 10]) {
  const database = new Database(":memory:");
  // The service reads the archived original for optional vision analysis; text-only fixtures leave it null.
  database.exec(`CREATE TABLE books (id TEXT PRIMARY KEY,title TEXT,ownerId TEXT,subject TEXT,grade TEXT,category TEXT,tags TEXT,status TEXT,mdPath TEXT,tableOfContents TEXT,filePath TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY,baseGrade INTEGER,baseGradeSetAt TEXT,birthDate TEXT);
    INSERT INTO users VALUES ('child_1',4,'2026-09',NULL),('child_2',5,'2026-09',NULL),('unknown',NULL,NULL,NULL);
    INSERT INTO books (id,title,ownerId,subject,grade,category,tags,status,mdPath,tableOfContents) VALUES ('paper','完整四上英语笔试试卷','shared','英语','五年级','试卷','[]','completed','paper.md','[]'),
    ('textbook','英语教材','shared','英语','四年级','教材','[]','completed','book.md','[]'),
    ('olympiad','竞赛试卷','shared','数学','四年级','试卷','["奥数"]','completed','o.md','[]'),
    ('other','不可见母卷','other','英语','四年级','试卷','[]','completed','other.md','[]');`);
  initLearningDomainDatabase(database);
  const jobs: Array<() => Promise<void>> = [];
  const prompts: string[] = [];
  let content =
    "合成试卷正文，不含真实资料。".repeat(1500) +
    "\n最后分区独有知识点：过去式理解。";
  const summary = {
    scope: "written_only",
    coveredThroughEnd: true,
    gradeAppropriate: true,
    knowledgePoints: ["词汇", "过去式理解"],
    issues: [],
    sections: counts.map((n, i) => ({
      title: ["选择", "选词填空", "阅读理解"][i],
      questionKind: ["单项选择", "选词填空", "阅读选择"][i],
      responseType: i === 1 ? "fill" : "choice",
      questionCount: n,
      groupCount: i ? 1 : 0,
      requiresMaterial: Boolean(i),
    })),
  };
  let serial = 0;
  const dependencies: SourcePaperDependencies = {
    database,
    now: () => new Date("2026-10-16").getTime(),
    readMarkdown: async () => content,
    schedule: (work) => jobs.push(work),
    model: async (prompt) => {
      prompts.push(prompt);
      if (prompt.startsWith("分析")) return summary;
      const count = Number(prompt.match(/本批恰好(\d+)道/)![1]);
      return {
        questions: Array.from({ length: count }, () => ({
          stem: `原创题${++serial}：Choose the suitable word.`,
          options: ["A. green", "B. yellow"],
          material:
            "This is a newly written story about a school garden. Children water plants and share their findings every Friday.",
          groupId: "g1",
          answer: "A. green",
          explanation: "结合题目中的意思和句意选择。",
        })),
      };
    },
  };
  const analyse = async (key = "analysis") => {
    const a = await requestSourcePaperAnalysis(
      { ownerId: "child_1", bookId: "paper", requestKey: key },
      dependencies,
    );
    if (jobs.length) await jobs.shift()!();
    return getSourcePaperAnalysis("child_1", { id: a.id }, database);
  };
  return {
    database,
    jobs,
    prompts,
    summary,
    dependencies,
    analyse,
    setContent: (value: string) => {
      content = value;
    },
  };
}
const request = (id: string, counts = [6, 4, 10], key = "generate") => ({
  ownerId: "child_1",
  requestKey: key,
  taskType: "assessment",
  source: { kind: "source_paper", analysisId: id, counts },
});

test("source classification excludes textbooks, Olympiad and other profiles; backend chapter entry also rejects source papers", async () => {
  const f = fixture();
  assert.deepEqual(
    listSourcePapers("child_1", f.database).map((x) => x.id),
    ["paper"],
  );
  await assert.rejects(
    requestSourcePaperAnalysis(
      { ownerId: "child_1", bookId: "textbook", requestKey: "x" },
      f.dependencies,
    ),
    /试卷/,
  );
  await assert.rejects(
    requestSourcePaperAnalysis(
      { ownerId: "child_1", bookId: "other", requestKey: "x" },
      f.dependencies,
    ),
    /不存在/,
  );
  assert.throws(
    () => getChapterActions("child_1", "paper", "c1", f.database),
    /母卷出题/,
  );
  await assert.rejects(
    createAssessmentBlueprint(
      {
        ownerId: "child_1",
        bookId: "paper",
        chapterIds: ["c1"],
        examType: "final",
      },
      { database: f.database },
    ),
    /母卷出题/,
  );
  assert.equal(f.prompts.length, 0);
});
test("analysis reads through the end, uses real profile grade and persists no source text; repeated acceptance is one job", async () => {
  const f = fixture();
  const input = { ownerId: "child_1", bookId: "paper", requestKey: "same" };
  const [a, b] = await Promise.all([
    requestSourcePaperAnalysis(input, f.dependencies),
    requestSourcePaperAnalysis(input, f.dependencies),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(f.jobs.length, 1);
  await f.jobs.shift()!();
  assert.match(f.prompts[0], /最后分区独有知识点/);
  const result = getSourcePaperAnalysis(
    "child_1",
    { requestKey: "same" },
    f.database,
  );
  assert.equal(result.targetGrade, "小学四年级");
  assert.equal(result.source.grade, "五年级");
  assert.deepEqual(
    result.summary?.sections.map((s) => s.questionCount),
    [6, 4, 10],
  );
  assert.doesNotMatch(
    JSON.stringify(
      f.database.prepare("SELECT * FROM source_paper_analyses").all(),
    ),
    /合成试卷正文/,
  );
  assert.throws(
    () => getSourcePaperAnalysis("child_2", { id: a.id }, f.database),
    /未找到/,
  );
});
test("missing grade, unready/unreadable source and overlong source fail before analysis acceptance", async () => {
  const f = fixture();
  await assert.rejects(
    requestSourcePaperAnalysis(
      { ownerId: "unknown", bookId: "paper", requestKey: "x" },
      f.dependencies,
    ),
    /档案/,
  );
  await assert.rejects(
    requestSourcePaperAnalysis(
      { ownerId: "child_1", bookId: "paper", requestKey: "x" },
      {
        ...f.dependencies,
        readMarkdown: async () => {
          throw new Error("missing");
        },
      },
    ),
    /不可读/,
  );
  f.setContent("a".repeat(180001));
  await assert.rejects(f.analyse(), /完整分析范围/);
  f.database
    .prepare("UPDATE books SET status='pending' WHERE id='paper'")
    .run();
  await assert.rejects(f.analyse(), /尚未完成/);
  assert.equal(f.jobs.length, 0);
});
for (const counts of [
  [6, 4, 10],
  [10, 10, 20],
])
  test(`generates full ${counts.reduce((n, x) => n + x)}-item paper atomically, with review materials and immutable answers`, async () => {
    const f = fixture(counts);
    const a = await f.analyse();
    const [task, duplicate] = await Promise.all([
      createSourcePaperTask(request(a.id, counts), f.dependencies),
      createSourcePaperTask(request(a.id, counts), f.dependencies),
    ]);
    assert.equal(task.id, duplicate.id);
    assert.equal(f.jobs.length, 1);
    assert.equal(
      expireStaleLearningTasks(f.database, "child_1", Date.now() + 6 * 60_000),
      0,
    );
    await f.jobs.shift()!();
    assert.equal(
      getLearningTask(f.database, task.id, "child_1")?.generationStatus,
      "ready",
    );
    const row = f.database
      .prepare("SELECT id,contentJson FROM assessment_papers")
      .get() as { id: string; contentJson: string };
    const paper = JSON.parse(row.contentJson);
    assert.deepEqual(
      paper.sections.map((s: any) => s.questions.length),
      counts,
    );
    assert.equal(paper.sections[2].questions[0].questionKind, "阅读选择");
    assert.match(paper.sections[2].questions[0].material, /newly written/);
    const attempt = createPaperAttempt(
      { ownerId: "child_1", paperId: row.id },
      f.database,
    );
    updatePaperAttempt(
      attempt.id,
      { ownerId: "child_1", action: "save", answers: { "s3-q1": "B. yellow" } },
      f.database,
    );
    updatePaperAttempt(
      attempt.id,
      {
        ownerId: "child_1",
        action: "submit",
        answers: { "s3-q1": "B. yellow" },
      },
      f.database,
    );
    const review = getPaperAttemptReview(f.database, attempt.id, "child_1")!;
    const item = review.items.find((q) => q.questionId === "s3-q1")!;
    assert.equal(item.studentAnswer, "B. yellow");
    assert.match(item.material!, /newly written/);
    assert.equal(item.options!.length, 2);
    f.database.prepare("DELETE FROM assessment_papers").run();
    assert.equal(
      getPaperAttemptReview(f.database, attempt.id, "child_1")?.items.find(
        (q) => q.questionId === "s3-q1",
      )?.material,
      item.material,
    );
    assert.equal(
      getPaperAttemptReview(f.database, attempt.id, "child_2"),
      null,
    );
  });
test("adjusted counts are exact; invalid counts, changed source and above-grade knowledge cannot create tasks", async () => {
  const f = fixture();
  const a = await f.analyse();
  for (const counts of [
    [0, 4, 10],
    [6, 1.5, 10],
    [6, -1, 10],
    [6, 4],
    [80, 80, 80],
  ])
    await assert.rejects(
      createSourcePaperTask(request(a.id, counts), f.dependencies),
      /子题/,
    );
  const task = await createSourcePaperTask(
    request(a.id, [6, 6, 10]),
    f.dependencies,
  );
  await f.jobs.shift()!();
  const paper = JSON.parse(
    (
      f.database.prepare("SELECT contentJson FROM assessment_papers").get() as {
        contentJson: string;
      }
    ).contentJson,
  );
  assert.deepEqual(
    paper.sections.map((s: any) => s.questions.length),
    [6, 6, 10],
  );
  await assert.rejects(
    createSourcePaperTask(request(a.id, [6, 4, 10]), f.dependencies),
    /配置/,
  );
  const b = await f.analyse("b");
  f.setContent("变更后的母卷".repeat(30));
  await assert.rejects(
    createSourcePaperTask(request(b.id, undefined, "b"), f.dependencies),
    /已变更/,
  );
  assert.equal(
    getLearningTask(f.database, task.id, "child_1")?.generationStatus,
    "ready",
  );
  f.summary.gradeAppropriate = false;
  const c = await f.analyse("c");
  await assert.rejects(
    createSourcePaperTask(request(c.id, undefined, "c"), f.dependencies),
    /超出当前年级/,
  );
});
test("incomplete source, provider failure and malformed batches cannot publish partial papers; retries are bounded", async () => {
  const f = fixture();
  f.summary.issues.push("听力原文缺失");
  const a = await f.analyse();
  assert.equal(a.status, "failed");
  assert.match(a.error!, /听力原文缺失/);
  assert.equal(f.prompts.length, 2);
  f.summary.issues = [];
  const b = await f.analyse("b");
  let calls = 0;
  const task = await createSourcePaperTask(request(b.id), {
    ...f.dependencies,
    model: async () => {
      calls++;
      return { questions: [{ stem: "缺材料", answer: "A" }] };
    },
  });
  await f.jobs.shift()!();
  assert.equal(calls, 2);
  assert.equal(
    getLearningTask(f.database, task.id, "child_1")?.generationStatus,
    "failed",
  );
  assert.equal(
    (
      f.database
        .prepare("SELECT COUNT(*) n FROM assessment_papers")
        .get() as any
    ).n,
    0,
  );
  assert.equal(
    (
      f.database
        .prepare("SELECT COUNT(*) n FROM assessment_blueprints")
        .get() as any
    ).n,
    0,
  );
  const retry = await createSourcePaperTask(request(b.id, undefined, "retry"), {
    ...f.dependencies,
    model: async () => {
      throw new Error("provider failed");
    },
  });
  await f.jobs.shift()!();
  assert.equal(
    getLearningTask(f.database, retry.id, "child_1")?.generationStatus,
    "failed",
  );
});
test("restart makes interrupted jobs explicit failures without reissuing model calls", async () => {
  const f = fixture();
  const a = await f.analyse();
  const task = await createSourcePaperTask(request(a.id), f.dependencies);
  initLearningDomainDatabase(f.database);
  assert.equal(
    getLearningTask(f.database, task.id, "child_1")?.errorCode,
    "generation_interrupted",
  );
});

test("unsupported images and unassociated reading sections fail analysis", async () => {
  for (const kind of ["看图选择", "阅读理解"]) {
    const f = fixture();
    f.summary.sections[0].questionKind = kind;
    const a = await f.analyse();
    assert.equal(a.status, "failed", kind);
    assert.match(a.error!, /暂不支持|缺少题组材料关联/);
    assert.equal(f.jobs.length, 0);
  }
});

for (const responseType of ["multi_choice", "listening"] as const) {
  test(`${responseType} generates and preserves answers through submission and review`, async () => {
    const f = fixture([1]);
    f.summary.sections[0].questionKind = responseType === "multi_choice" ? "多项选择" : "听力选择";
    f.summary.sections[0].responseType = responseType;
    const analysis = await f.analyse();
    assert.equal(analysis.status, "ready");
    const answer = responseType === "multi_choice" ? ["A. green", "B. yellow"] : "A. green";
    const audioScript = "The school garden is green. Please choose green.";
    const task = await createSourcePaperTask(request(analysis.id, [1]), {
      ...f.dependencies,
      model: async () => ({ questions: [{
        stem: "Choose the suitable colours.", options: ["A. green", "B. yellow", "C. blue"],
        answer, explanation: "结合材料选择颜色。", ...(responseType === "listening" ? { audioScript } : {}),
      }] }),
    });
    await f.jobs.shift()!();
    assert.equal(getLearningTask(f.database, task.id, "child_1")?.generationStatus, "ready");
    const row = f.database.prepare("SELECT id,contentJson FROM assessment_papers").get() as { id: string; contentJson: string };
    const question = JSON.parse(row.contentJson).sections[0].questions[0];
    assert.equal(question.type, responseType);
    assert.deepEqual(question.answer, answer);
    if (responseType === "listening") assert.equal(question.audioScript, audioScript);
    const attempt = createPaperAttempt({ ownerId: "child_1", paperId: row.id }, f.database);
    const submitted = updatePaperAttempt(attempt.id, { ownerId: "child_1", action: "submit", answers: { [question.id]: answer } }, f.database);
    assert.deepEqual(submitted.answers[question.id], answer);
    const item = getPaperAttemptReview(f.database, attempt.id, "child_1")!.items[0];
    const readableAnswer = Array.isArray(answer) ? answer.join("、") : answer;
    assert.equal(item.studentAnswer, readableAnswer);
    assert.equal(item.referenceAnswer, readableAnswer);
  });
}

test("listening generation without an original script cannot publish a partial paper", async () => {
  const f = fixture([1]);
  f.summary.sections[0].questionKind = "听力选择";
  f.summary.sections[0].responseType = "listening";
  const analysis = await f.analyse();
  const task = await createSourcePaperTask(request(analysis.id, [1]), f.dependencies);
  await f.jobs.shift()!();
  assert.equal(getLearningTask(f.database, task.id, "child_1")?.generationStatus, "failed");
  assert.equal((f.database.prepare("SELECT COUNT(*) n FROM assessment_papers").get() as any).n, 0);
});

test("a standalone section cannot publish passage questions without context; correction names the problem", async () => {
  const f = fixture([1, 1, 1]);
  const a = await f.analyse();
  const prompts: string[] = [];
  const task = await createSourcePaperTask(request(a.id, [1, 1, 1]), {
    ...f.dependencies,
    model: async (prompt) => {
      prompts.push(prompt);
      return { questions: [{ stem: "根据短文，Lily 在星期三上什么课？", options: ["A. Art", "B. Music"], answer: "A", explanation: "短文中提到了美术课。" }] };
    },
  });
  await f.jobs.shift()!();
  assert.equal(getLearningTask(f.database, task.id, "child_1")?.generationStatus, "failed");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /题目依赖的完整材料缺失/);
  assert.equal((f.database.prepare("SELECT COUNT(*) n FROM assessment_papers").get() as any).n, 0);
});

test("optional generated context is retained even when the source section was standalone", async () => {
  const f = fixture([1, 1, 1]);
  const a = await f.analyse();
  await createSourcePaperTask(request(a.id, [1, 1, 1]), f.dependencies);
  await f.jobs.shift()!();
  const paper = JSON.parse((f.database.prepare("SELECT contentJson FROM assessment_papers").get() as any).contentJson);
  assert.match(paper.sections[0].questions[0].material, /newly written/);
  assert.match(paper.sections[0].questions[0].groupId, /^s1-/);
});

test("concurrent different analyses sharing one request key cannot bind the same task", async () => {
  const f = fixture();
  const a = await f.analyse("a");
  const b = await f.analyse("b");
  const results = await Promise.allSettled([
    createSourcePaperTask(request(a.id), f.dependencies),
    createSourcePaperTask(request(b.id), f.dependencies),
  ]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  const rejected = results.find(x => x.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "request_conflict");
  const linked = f.database.prepare("SELECT taskId FROM source_paper_analyses WHERE taskId IS NOT NULL").all();
  assert.equal(linked.length, 1);
  assert.equal(f.jobs.length, 1);
});

test("numbered passage blanks without matching questions cannot publish an apparently complete paper", async () => {
  const f = fixture([1, 1, 1]);
  const a = await f.analyse();
  const task = await createSourcePaperTask(request(a.id, [1, 1, 1]), {
    ...f.dependencies,
    model: async () => ({ questions: [{ stem: "Fill blank (1).", material: "Word bank: blue, red. My bag is (1)____ and my pen is (2)____.", answer: "blue", explanation: "blue is a colour.", options: ["A. blue", "B. red"] }] }),
  });
  await f.jobs.shift()!();
  assert.equal(getLearningTask(f.database, task.id, "child_1")?.generationStatus, "failed");
  assert.equal((f.database.prepare("SELECT COUNT(*) n FROM assessment_papers").get() as any).n, 0);
});

test("placeholder context cannot satisfy required passages", async () => {
  const f = fixture([1, 1, 1]);
  const a = await f.analyse();
  const task = await createSourcePaperTask(request(a.id, [1, 1, 1]), {
    ...f.dependencies,
    model: async () => ({ questions: [{ stem: "What colour is the bag?", material: "无", options: ["A. blue", "B. red"], answer: "A", explanation: "The bag is blue." }] }),
  });
  await f.jobs.shift()!();
  assert.equal(getLearningTask(f.database, task.id, "child_1")?.generationStatus, "failed");
  assert.equal((f.database.prepare("SELECT COUNT(*) n FROM assessment_papers").get() as any).n, 0);
});
