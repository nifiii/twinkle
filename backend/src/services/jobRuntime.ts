import db from './databaseService.js';
import { JobHandler, JobScheduler, JobStore, JobType, ModelSlotPool } from './jobs.js';

export const jobStore = new JobStore(db);
export const modelSlots = new ModelSlotPool({ vision: 3, text: 3 });
const scheduler = new JobScheduler(jobStore);
let timer: NodeJS.Timeout | undefined;

export function registerJobHandler(type: JobType, handler: JobHandler): void {
  scheduler.register(type, handler);
}

export function startJobScheduler(): void {
  if (timer) return;
  const tick = () => void scheduler.tick().catch(error => console.error('[jobs] 调度失败:', error));
  tick();
  timer = setInterval(tick, 250);
}
