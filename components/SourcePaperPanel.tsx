import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  analyseSourcePaper,
  fetchSourcePapers,
  generateSourcePaper,
  readSourcePaperAnalysis,
  readSourceTask,
  SourcePaper,
  SourcePaperAnalysis,
  SourcePaperApiError,
} from "../services/sourcePaperApi";
import { ClassroomTaskDetail } from "../services/classroomTaskApi";

type Pending = {
  bookId: string;
  analysisKey: string;
  analysisId?: string;
  taskKey?: string;
  taskId?: string;
  counts?: number[];
  startedAt: number;
};
const control =
  "min-h-11 w-full min-w-0 rounded-xl border border-cyber-border/60 bg-cyber-surface px-3 text-base text-cyber-text focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:opacity-60";
const action =
  "min-h-11 rounded-xl bg-neon-blue px-4 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-neon-blue disabled:opacity-50";
const terminal = (task: ClassroomTaskDetail | null) =>
  task &&
  ["ready", "failed", "resource_unavailable"].includes(task.generationStatus);

export default function SourcePaperPanel({
  ownerId,
  onOpenTask,
  onLockedChange,
}: {
  ownerId: string;
  onOpenTask: (id: string) => void;
  onLockedChange: (locked: boolean) => void;
}) {
  const [papers, setPapers] = useState<SourcePaper[]>([]);
  const [bookId, setBookId] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [sourceReload, setSourceReload] = useState(0);
  const [analysis, setAnalysis] = useState<SourcePaperAnalysis | null>(null);
  const [counts, setCounts] = useState<number[]>([]);
  const [task, setTask] = useState<ClassroomTaskDetail | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [canResend, setCanResend] = useState(false);
  const identity = useRef(ownerId);
  const mounted = useRef(true);
  identity.current = ownerId;
  const storageKey = `source-paper-request:${ownerId}`;
  const locked = busy && elapsed < 300;
  const persist = (value: Pending) => {
    localStorage.setItem(storageKey, JSON.stringify(value));
    setPending(value);
  };

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setAnalysis(null);
    setTask(null);
    setPending(null);
    setError("");
    setLoading(true);
    setListError('');
    setBusy(false);
    try {
      const stored = JSON.parse(
        localStorage.getItem(storageKey) || "null",
      ) as Pending | null;
      if (stored?.analysisKey && stored.bookId) {
        setPending(stored);
        setBookId(stored.bookId);
        setBusy(true);
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
    fetchSourcePapers(ownerId)
      .then((data) => {
        if (!cancelled) {
          setPapers(data);
          setBookId((current) =>
            data.some((p) => p.id === current) ? current : data[0]?.id || "",
          );
        }
      })
      .catch((reason) => {
        if (!cancelled) setListError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [ownerId, storageKey, sourceReload]);

  useEffect(() => {
    onLockedChange(locked);
    if (locked) dialog.current?.focus();
    else if (analysis) heading.current?.focus();
    return () => onLockedChange(false);
  }, [locked, onLockedChange]);
  useEffect(() => {
    if (!pending) return;
    const tick = () =>
      setElapsed(
        Math.max(0, Math.floor((Date.now() - pending.startedAt) / 1000)),
      );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pending?.startedAt]);
  useEffect(() => {
    if (!pending || !busy) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const found = await readSourcePaperAnalysis(
          ownerId,
          pending.analysisId,
          pending.analysisKey,
        );
        if (cancelled) return;
        setAnalysis(found);
        setCanResend(
          Boolean(pending.taskKey && !found.taskId && !found.taskRetired),
        );
        setCounts(
          (current) =>
            found.counts ||
            (current.length === found.summary?.sections.length
              ? current
              : found.summary?.sections.map((s) => s.questionCount) || []),
        );
        if (found.status === "failed") {
          setBusy(false);
          setError(found.error || "母卷分析失败");
          return;
        }
        if (found.taskRetired) { setBusy(false); setError('该测试已删除，可重新分析母卷'); return; }
        const taskId = pending.taskId || found.taskId;
        if (taskId) {
          const result = await readSourceTask(ownerId, taskId);
          if (cancelled) return;
          setTask(result);
          setError("");
          if (terminal(result)) {
            setBusy(false);
            return;
          }
        } else if (found.status === "ready" && !pending.taskKey) {
          setBusy(false);
          setError("");
          return;
        }
      } catch (reason) {
        if (cancelled) return;
        setError(
          reason instanceof SourcePaperApiError && reason.status === 404
            ? "尚未查到原请求，正在继续确认受理状态；请勿重复生成。"
            : "状态查询暂时失败，正在查询原请求，请勿重复创建。",
        );
        setCanResend(
          reason instanceof SourcePaperApiError &&
            reason.status === 404 &&
            !pending.taskKey,
        );
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ownerId, pending, busy, refresh]);

  const analyse = async () => {
    if (!bookId || busy) return;
    const owner = ownerId;
    const request: Pending = {
      bookId,
      analysisKey: crypto.randomUUID(),
      startedAt: Date.now(),
    };
    setAnalysis(null);
    setTask(null);
    setCounts([]);
    setError("");
    setElapsed(0);
    persist(request);
    setBusy(true);
    try {
      const result = await analyseSourcePaper(
        owner,
        bookId,
        request.analysisKey,
      );
      if (!mounted.current || identity.current !== owner) return;
      setAnalysis(result);
      persist({ ...request, analysisId: result.id });
    } catch (reason) {
      if (!mounted.current || identity.current !== owner) return;
      if (reason instanceof SourcePaperApiError && reason.status < 500) {
        setBusy(false);
        setPending(null);
        localStorage.removeItem(storageKey);
        setError(reason.message);
      } else setError("分析请求的受理状态待确认，正在查询原请求。");
    }
  };
  const generate = async () => {
    if (
      !analysis?.summary ||
      !pending ||
      busy ||
      counts.some((n) => !Number.isInteger(n) || n < 1 || n > 80) ||
      counts.reduce((n, x) => n + x, 0) > 120
    )
      return;
    const owner = ownerId;
    const request = {
      ...pending,
      analysisId: analysis.id,
      taskKey: crypto.randomUUID(),
      taskId: undefined,
      counts: [...counts],
      startedAt: Date.now(),
    };
    setTask(null);
    setError("");
    setElapsed(0);
    persist(request);
    setBusy(true);
    try {
      const result = await generateSourcePaper(
        owner,
        analysis.id,
        counts,
        request.taskKey,
      );
      if (!mounted.current || identity.current !== owner) return;
      persist({ ...request, taskId: result.id });
    } catch (reason) {
      if (!mounted.current || identity.current !== owner) return;
      if (reason instanceof SourcePaperApiError && reason.status < 500) {
        setBusy(false);
        persist({ ...request, taskKey: undefined });
        setError(reason.message);
      } else setError("生成请求的受理状态待确认，正在查询原任务。");
    }
  };
  const resend = async () => {
    if (!pending || !canResend) return;
    setCanResend(false);
    try {
      if (pending.taskKey && pending.analysisId && pending.counts) {
        const result = await generateSourcePaper(
          ownerId,
          pending.analysisId,
          pending.counts,
          pending.taskKey,
        );
        if (mounted.current && identity.current === ownerId)
          persist({ ...pending, taskId: result.id });
      } else if (!pending.taskKey) {
        const result = await analyseSourcePaper(
          ownerId,
          pending.bookId,
          pending.analysisKey,
        );
        if (mounted.current && identity.current === ownerId)
          persist({ ...pending, analysisId: result.id });
      }
    } catch (reason) {
      if (mounted.current && identity.current === ownerId)
        setError(reason instanceof Error ? reason.message : "原请求尚未恢复");
    }
    setRefresh((n) => n + 1);
  };
  const event = (task?.events || []).find(
    (item) => item.eventType === "progress",
  );
  const detail = event?.detail as
    { message?: string; completed?: number; total?: number } | undefined;
  const total = counts.reduce((n, x) => n + (Number.isFinite(x) ? x : 0), 0);
  const finished = task?.generationStatus === "ready";
  const failed = task?.generationStatus === "failed";
  const status = task
    ? detail?.message || "生成请求已受理，正在生成原创试题"
    : analysis?.status === "ready"
      ? "母卷结构分析完成"
      : "正在核对完整母卷、题型和知识点";
  const validCounts =
    counts.length > 0 &&
    counts.every((n) => Number.isInteger(n) && n >= 1 && n <= 80) &&
    total <= 120;
  return (
    <section className="space-y-5" aria-label="母卷出题">
      <div className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/60 p-5">
        <h2 className="text-base font-semibold text-cyber-text">
          基于母卷，生成原创测试
        </h2>
        <p className="mt-2 text-sm leading-6 text-cyber-muted">
          参考已上传试卷的题型与知识点，按当前学生年级出题。无需选择章节，默认保留母卷题量，也可调整。
        </p>
        {loading ? (
          <p role="status" className="mt-4">
            正在读取试卷资料…
          </p>
        ) : listError ? (
          <div role="alert" className="mt-4 text-sm text-red-800">{listError}<button type="button" className="ml-3 min-h-11 underline focus:ring-2 focus:ring-neon-blue" onClick={() => setSourceReload(n => n + 1)}>重试读取试卷</button></div>
        ) : !papers.length ? (
          <p role="status" className="mt-4 text-sm text-cyber-muted">
            暂无母卷。请在学习资料上传完整试卷，并标注学科与“试卷”类别或标签。
          </p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid min-w-0 gap-2 text-sm font-medium text-cyber-text">
              母卷
              <select
                className={control}
                value={bookId}
                disabled={busy}
                onChange={(e) => {
                  setBookId(e.target.value);
                  setAnalysis(null);
                  setTask(null);
                  setPending(null);
                  localStorage.removeItem(storageKey);
                  setError("");
                }}
              >
                {papers.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={p.status !== "completed"}
                  >
                    {p.title}
                    {p.status !== "completed" ? "（解析未完成）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={action}
              disabled={
                busy ||
                papers.find((p) => p.id === bookId)?.status !== "completed"
              }
              onClick={() => void analyse()}
            >
              {analysis ? "重新分析母卷" : "分析母卷结构"}
            </button>
          </div>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          {error}
        </p>
      )}
      {analysis?.summary && (
        <div className="rounded-2xl border border-cyber-border/60 bg-cyber-surface/60 p-5">
          <h3
            ref={heading}
            tabIndex={-1}
            className="font-semibold text-cyber-text focus:outline-none"
          >
            确认测试结构
          </h3>
          <p className="mt-2 break-words text-sm text-cyber-muted">
            来源：{analysis.source.title}（
            {analysis.source.grade || "未标注年级"}）
          </p>
          <p className="mt-2 text-sm text-neon-blue">
            目标：当前学生 · {analysis.targetGrade} ·{" "}
            {analysis.summary.scope === "written_only"
              ? "仅笔试，不含听力"
              : "完整文字试卷"}
          </p>
          {!analysis.summary.gradeAppropriate && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              母卷含超出当前年级的知识点，不能合理适配。请选择适合当前学生年级的母卷。
            </p>
          )}
          <p className="mt-3 break-words text-sm text-cyber-muted">
            知识点：{analysis.summary.knowledgePoints.join("、")}
          </p>
          <div className="mt-5 space-y-3">
            {analysis.summary.sections.map((s, i) => (
              <label
                key={s.id}
                className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-4 rounded-xl border border-cyber-border/60 p-3"
              >
                <span className="min-w-0 text-sm text-cyber-text">
                  <span className="block font-medium">{s.title}</span>
                  <span className="mt-1 block text-xs text-cyber-muted">
                    {s.questionKind}
                    {s.requiresMaterial ? " · 含完整题组材料" : ""} · 原卷
                    {s.questionCount}题 · {s.groupCount}组材料
                  </span>
                </span>
                <span className="grid gap-1 text-xs text-cyber-muted">
                  子题数
                  <input
                    aria-label={`${s.title}子题数`}
                    type="number"
                    min={1}
                    max={80}
                    aria-invalid={!Number.isInteger(counts[i]) || counts[i] < 1 || counts[i] > 80}
                    aria-describedby={`source-count-${s.id}-error`}
                    className={control}
                    disabled={busy || finished}
                    value={
                      Number.isNaN(counts[i])
                        ? ""
                        : (counts[i] ?? s.questionCount)
                    }
                    onChange={(e) =>
                      setCounts((current) =>
                        current.map((n, index) =>
                          index === i
                            ? e.target.value
                              ? Number(e.target.value)
                              : NaN
                            : n,
                        ),
                      )
                    }
                  />
                  {(!Number.isInteger(counts[i]) || counts[i] < 1 || counts[i] > 80) && <span id={`source-count-${s.id}-error`} className="text-red-800">请输入1–80之间的整数</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-4 text-sm text-cyber-muted">
            {validCounts ? `共 ${total}` : '题量待修正'}{" "}
            道子题，每分区1–80题，全卷最多120题；全部通过校验后存入智慧课堂。
          </p>
          {finished ? (
            <div
              role="status"
              className="mt-5 flex flex-wrap items-center gap-3 text-emerald-800"
            >
              <CheckCircle2 size={20} />
              原创测试已创建
              <button
                type="button"
                className={action}
                onClick={() => onOpenTask(task.id)}
              >
                开始学习
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`${action} mt-5`}
              disabled={busy || !validCounts || !analysis.summary.gradeAppropriate || analysis.taskRetired || Boolean(task && !failed)}
              onClick={() => void generate()}
            >
              {busy
                ? "正在生成，请勿重复提交"
                : failed
                  ? "重新生成原创测试"
                  : "确认并生成原创测试"}
            </button>
          )}
          {failed && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {task.errorMessage || "生成失败，未保存半成品"}
            </p>
          )}
        </div>
      )}
      {busy && (
        <div
          role="status"
          className="rounded-xl border border-cyber-border/60 bg-cyber-surface/60 p-4 text-sm text-cyber-text"
        >
          <p role="status" aria-live="polite">{status}</p>
          <p className="mt-2 text-cyber-muted">
            已等待 {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒
            {elapsed >= 300
              ? "；已解除页面锁定，原任务继续处理，请勿重复创建。"
              : ""}
          </p>
          {detail?.total ? (
            <progress
              className="mt-3 w-full"
              value={detail.completed || 0}
              max={detail.total}
              aria-label="试题生成进度"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setRefresh((n) => n + 1)}
            className="mt-2 min-h-11 underline focus:ring-2 focus:ring-neon-blue"
          >
            查询原请求状态
          </button>
          {canResend && elapsed >= 300 && <button type="button" onClick={() => void resend()} className="ml-3 min-h-11 underline focus:ring-2 focus:ring-neon-blue">恢复提交原请求（沿用原标识）</button>}
        </div>
      )}
      {locked && (
        <div
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-generation-title"
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              dialog.current?.focus();
            }
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-cyber-border bg-cyber-surface p-6">
            <Loader2 className="animate-spin text-neon-blue motion-reduce:animate-none" />
            <h2
              id="source-generation-title"
              className="mt-4 font-semibold text-cyber-text"
            >
              {status}
            </h2>
            <p className="mt-3 text-sm text-cyber-muted">
              已等待 {Math.floor(elapsed / 60)} 分 {elapsed % 60}{" "}
              秒。请勿关闭或重复提交；超过5分钟自动解除页面锁定。
            </p>
            {detail?.total ? (
              <progress
                className="mt-4 w-full"
                value={detail.completed || 0}
                max={detail.total}
                aria-label="试题生成进度"
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
