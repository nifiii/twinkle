import { AlertCircle, CheckCircle2, Clock3, Loader2, RotateCcw } from 'lucide-react';
import { JobStatusView } from '../services/jobService';

interface JobStatusCardProps {
  job: JobStatusView;
  onRetry?: () => void;
}

const copy = {
  queued: '正在排队', running: '正在处理', completed: '结果可用', failed: '处理失败', cancelled: '已取消',
} as const;

export function JobStatusCard({ job, onRetry }: JobStatusCardProps) {
  const isFailed = job.status === 'failed';
  const isDone = job.status === 'completed';
  const Icon = isDone ? CheckCircle2 : isFailed ? AlertCircle : job.status === 'queued' ? Clock3 : Loader2;
  return (
    <div className="flex items-center gap-3 border border-gray-200 bg-white p-3 rounded-lg">
      <Icon className={`w-5 h-5 ${isDone ? 'text-green-600' : isFailed ? 'text-red-600' : 'text-blue-600'} ${job.status === 'running' ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800">{copy[job.status]}</p>
        <p className="text-xs text-gray-500 truncate">{job.status === 'queued' ? `队列第 ${job.queuePosition || 1} 位` : job.stage}</p>
      </div>
      {isFailed && onRetry && <button aria-label="重试任务" title="重试任务" onClick={onRetry} className="p-2 text-blue-600 hover:bg-blue-50 rounded"><RotateCcw className="w-4 h-4" /></button>}
    </div>
  );
}
