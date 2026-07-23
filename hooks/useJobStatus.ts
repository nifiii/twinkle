import { useEffect, useState } from 'react';
import { getJob, JobStatusView, retryJob } from '../services/jobService';

const TERMINAL = new Set<JobStatusView['status']>(['completed', 'failed', 'cancelled']);

export function useJobStatus(jobId: string | null, ownerId: string | null) {
  const [job, setJob] = useState<JobStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !ownerId) return;
    let disposed = false;
    const poll = async () => {
      try {
        const next = await getJob(jobId, ownerId);
        if (!disposed) { setJob(next); setError(null); }
        return TERMINAL.has(next.status);
      } catch (pollError) {
        if (!disposed) setError(pollError instanceof Error ? pollError.message : '任务状态查询失败');
        return true;
      }
    };
    let timer: number | undefined;
    const loop = async () => { if (!(await poll()) && !disposed) timer = window.setTimeout(loop, 2000); };
    void loop();
    return () => { disposed = true; if (timer) window.clearTimeout(timer); };
  }, [jobId, ownerId]);

  const retry = async () => {
    if (!jobId || !ownerId) return;
    const next = await retryJob(jobId, ownerId);
    setJob(next);
  };

  return { job, error, retry };
}
