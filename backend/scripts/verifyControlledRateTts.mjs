import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });

// This sentence is intentionally self-authored. The verification must never
// send textbook text, student answers, or any generated exercise to the TTS API.
const verificationScript = 'Hello, I am Mia. Today we read a short story about a red kite in the park. Tom and Anna look at the blue sky, then they count three small birds near a tree. At the end, they smile and go home together.';
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'twinkle-rate-tts-'));
process.env.DATA_DIR = temporaryDirectory;

const [{ ControlledRateTtsAdapter }, { synthesizeVolcanoTtsAudio }] = await Promise.all([
  import('../dist/services/controlledRateTtsAdapter.js'),
  import('../dist/routes/tts.js'),
]);

function durationSeconds(filePath) {
  return Number.parseFloat(execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { encoding: 'utf8' },
  ).trim());
}

try {
  const adapter = new ControlledRateTtsAdapter({
    cacheDirectory: path.join(temporaryDirectory, 'audio'),
    voiceProfileFingerprint: 'verification-only-v1',
    synthesizeBaseAudio: synthesizeVolcanoTtsAudio,
  });
  const measurements = [];
  for (const speed of ['slow', 'standard', 'fast']) {
    const result = await adapter.getAudio({ packageId: 'verification-only', script: verificationScript, speed });
    const outputPath = path.join(temporaryDirectory, `${speed}.mp3`);
    await writeFile(outputPath, result.audio);
    measurements.push({ speed, seconds: durationSeconds(outputPath), bytes: result.audio.length });
  }
  const standard = measurements.find(item => item.speed === 'standard').seconds;
  const report = measurements.map(item => {
    const expected = item.speed === 'slow' ? standard / 0.75 : item.speed === 'fast' ? standard / 1.1 : standard;
    return {
      speed: item.speed,
      seconds: Number(item.seconds.toFixed(3)),
      ratioToStandard: Number((item.seconds / standard).toFixed(3)),
      withinTolerance: Math.abs(item.seconds - expected) / expected <= 0.08,
    };
  });
  if (!report.every(item => item.withinTolerance)) throw new Error('受控语速时长门禁未通过');
  console.log(JSON.stringify({ verified: true, report }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
