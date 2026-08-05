import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const CONTROLLED_RATE_RENDERER_VERSION = 'controlled-rate-v1';

export const CONTROLLED_RATE_SPEEDS = {
  slow: 0.75,
  standard: 1,
  fast: 1.1,
} as const;

export type ControlledRateSpeed = keyof typeof CONTROLLED_RATE_SPEEDS;

export interface ControlledRateTtsResult {
  audio: Buffer;
  cached: boolean;
  speed: ControlledRateSpeed;
  renderer: typeof CONTROLLED_RATE_RENDERER_VERSION;
  cacheKeyVersion: 2;
}

export class ControlledRateTtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlledRateTtsError';
  }
}

interface ControlledRateTtsAdapterOptions {
  cacheDirectory: string;
  voiceProfileFingerprint: string;
  synthesizeBaseAudio: (script: string) => Promise<Buffer>;
  renderAudio?: (inputPath: string, outputPath: string, speed: number) => Promise<void>;
  readDurationSeconds?: (filePath: string) => Promise<number>;
}

interface AudioRequest {
  packageId: string;
  script: string;
  speed: ControlledRateSpeed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runProgram(program: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ControlledRateTtsError(`${program} 执行超时`));
    }, 30_000);
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', error => {
      clearTimeout(timer);
      reject(new ControlledRateTtsError(`${program} 无法启动: ${error.message}`));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      reject(new ControlledRateTtsError(`${program} 失败: ${Buffer.concat(stderr).toString('utf8').trim() || `exit ${code}`}`));
    });
  });
}

async function renderWithFfmpeg(inputPath: string, outputPath: string, speed: number): Promise<void> {
  await runProgram('ffmpeg', [
    '-y', '-i', inputPath,
    '-filter:a', `atempo=${speed}`,
    '-vn', '-codec:a', 'libmp3lame', '-q:a', '4', outputPath,
  ]);
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  const output = await runProgram('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ]);
  const seconds = Number.parseFloat(output.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ControlledRateTtsError('音频时长无法验证');
  return seconds;
}

async function writeAtomically(filePath: string, content: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content);
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

/**
 * Makes the three listening rates reproducible even when the upstream TTS vendor
 * does not honour a requested speed parameter. The cache key includes all inputs
 * that can change the rendered sound, so a changed script or voice never reuses
 * an old speed variant.
 */
export class ControlledRateTtsAdapter {
  private readonly pending = new Map<string, Promise<ControlledRateTtsResult>>();
  private readonly pendingBase = new Map<string, Promise<string>>();
  private readonly renderAudio: (inputPath: string, outputPath: string, speed: number) => Promise<void>;
  private readonly readDurationSeconds: (filePath: string) => Promise<number>;

  constructor(private readonly options: ControlledRateTtsAdapterOptions) {
    this.renderAudio = options.renderAudio || renderWithFfmpeg;
    this.readDurationSeconds = options.readDurationSeconds || probeDurationSeconds;
  }

  async getAudio(request: AudioRequest): Promise<ControlledRateTtsResult> {
    const cacheKey = sha256([
      request.packageId,
      sha256(request.script),
      this.options.voiceProfileFingerprint,
      CONTROLLED_RATE_RENDERER_VERSION,
    ].join('\u0000'));
    const outputPath = path.join(this.options.cacheDirectory, cacheKey, `${request.speed}.mp3`);
    if (await exists(outputPath)) {
      return this.result(await fs.readFile(outputPath), request.speed, true);
    }

    const pendingKey = `${cacheKey}:${request.speed}`;
    const running = this.pending.get(pendingKey);
    if (running) return running;

    const work = this.createAudio(cacheKey, request, outputPath)
      .finally(() => this.pending.delete(pendingKey));
    this.pending.set(pendingKey, work);
    return work;
  }

  private result(audio: Buffer, speed: ControlledRateSpeed, cached: boolean): ControlledRateTtsResult {
    return { audio, cached, speed, renderer: CONTROLLED_RATE_RENDERER_VERSION, cacheKeyVersion: 2 };
  }

  private async createAudio(cacheKey: string, request: AudioRequest, outputPath: string): Promise<ControlledRateTtsResult> {
    const directory = path.dirname(outputPath);
    const basePath = path.join(directory, 'base.mp3');
    await this.ensureBaseAudio(cacheKey, basePath, request.script);

    if (request.speed === 'standard') {
      return this.result(await fs.readFile(basePath), request.speed, false);
    }

    const baseDuration = await this.readDurationSeconds(basePath);
    const temporaryPath = path.join(directory, `${request.speed}.${randomUUID()}.tmp.mp3`);
    try {
      await fs.mkdir(directory, { recursive: true });
      await this.renderAudio(basePath, temporaryPath, CONTROLLED_RATE_SPEEDS[request.speed]);
      const renderedDuration = await this.readDurationSeconds(temporaryPath);
      const expectedDuration = baseDuration / CONTROLLED_RATE_SPEEDS[request.speed];
      const deviation = Math.abs(renderedDuration - expectedDuration) / expectedDuration;
      if (deviation > 0.08) {
        throw new ControlledRateTtsError(`${request.speed} 音频时长未达到受控速度要求`);
      }
      await fs.rename(temporaryPath, outputPath);
      return this.result(await fs.readFile(outputPath), request.speed, false);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async ensureBaseAudio(cacheKey: string, basePath: string, script: string): Promise<void> {
    if (await exists(basePath)) return;
    const running = this.pendingBase.get(cacheKey);
    if (running) {
      await running;
      return;
    }
    const work = (async () => {
      const baseAudio = await this.options.synthesizeBaseAudio(script);
      if (!baseAudio.length) throw new ControlledRateTtsError('标准听力音频为空');
      await writeAtomically(basePath, baseAudio);
      return basePath;
    })().finally(() => this.pendingBase.delete(cacheKey));
    this.pendingBase.set(cacheKey, work);
    await work;
  }
}
