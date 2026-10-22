import { ClassroomTaskDetail } from "./classroomTaskApi";

export type SourcePaper = {
  id: string;
  title: string;
  subject: string;
  grade: string | null;
  status: string;
};
export type SourcePaperAnalysis = {
  id: string;
  status: "running" | "ready" | "failed";
  source: SourcePaper;
  targetGrade: string;
  error?: string;
  taskId?: string;
  taskRetired?: boolean;
  counts?: number[];
  createdAt: number;
  summary?: {
    scope: "full" | "written_only";
    gradeAppropriate: boolean;
    knowledgePoints: string[];
    sections: Array<{
      id: string;
      title: string;
      questionKind: string;
      responseType: string;
      questionCount: number;
      groupCount: number;
      requiresMaterial: boolean;
      convertedFromDrawing?: boolean;
      conversionGoal?: string;
    }>;
  };
};
export class SourcePaperApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const json = await response.json();
  if (!response.ok || !json.success)
    throw new SourcePaperApiError(json.error || "请求失败", response.status);
  return json.data;
}
export const fetchSourcePapers = (ownerId: string) =>
  request<SourcePaper[]>(
    `/assistant/source-papers?ownerId=${encodeURIComponent(ownerId)}`,
  );
export const analyseSourcePaper = (
  ownerId: string,
  bookId: string,
  requestKey: string,
) =>
  request<SourcePaperAnalysis>("/assistant/source-paper-analyses", {
    ownerId,
    bookId,
    requestKey,
  });
export const readSourcePaperAnalysis = (
  ownerId: string,
  analysisId?: string,
  requestKey?: string,
) =>
  request<SourcePaperAnalysis>(
    `/assistant/source-paper-analyses${analysisId ? `/${encodeURIComponent(analysisId)}` : ""}?ownerId=${encodeURIComponent(ownerId)}${!analysisId ? `&requestKey=${encodeURIComponent(requestKey || "")}` : ""}`,
  );
export const generateSourcePaper = (
  ownerId: string,
  analysisId: string,
  counts: number[],
  requestKey: string,
) =>
  request<{ id: string }>("/learning-tasks", {
    ownerId,
    requestKey,
    taskType: "assessment",
    source: { kind: "source_paper", analysisId, counts },
  });
export const readSourceTask = (ownerId: string, id: string) =>
  request<ClassroomTaskDetail>(
    `/learning-tasks/${encodeURIComponent(id)}?ownerId=${encodeURIComponent(ownerId)}`,
  );
