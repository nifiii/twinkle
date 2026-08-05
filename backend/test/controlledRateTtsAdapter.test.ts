import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ControlledRateTtsAdapter,
  ControlledRateTtsError,
} from '../src/services/controlledRateTtsAdapter.js';

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'twinkle-rate-tts-'));
}

test('renders isolated slow, standard, and fast listening audio from one base audio', async () => {
  const cacheDirectory = await temporaryDirectory();
  let synthesized = 0;
  let rendered = 0;
  const adapter = new ControlledRateTtsAdapter({
    cacheDirectory,
    voiceProfileFingerprint: 'voice-v1',
    synthesizeBaseAudio: async () => { synthesized++; return Buffer.from('base-mp3'); },
    renderAudio: async (inputPath, outputPath) => { rendered++; await fs.copyFile(inputPath, outputPath); },
    readDurationSeconds: async filePath => {
      if (path.basename(filePath).startsWith('slow.')) return 40 / 3;
      if (path.basename(filePath).startsWith('fast.')) return 100 / 11;
      return 10;
    },
  });
  try {
    const slow = await adapter.getAudio({ packageId: 'package-1', script: 'Hello class.', speed: 'slow' });
    const standard = await adapter.getAudio({ packageId: 'package-1', script: 'Hello class.', speed: 'standard' });
    const fast = await adapter.getAudio({ packageId: 'package-1', script: 'Hello class.', speed: 'fast' });
    const cachedSlow = await adapter.getAudio({ packageId: 'package-1', script: 'Hello class.', speed: 'slow' });
    assert.equal(synthesized, 1);
    assert.equal(rendered, 2);
    assert.equal(slow.speed, 'slow');
    assert.equal(standard.speed, 'standard');
    assert.equal(fast.speed, 'fast');
    assert.equal(cachedSlow.cached, true);
  } finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('does not cache a speed variant whose measured duration is outside the allowed range', async () => {
  const cacheDirectory = await temporaryDirectory();
  const adapter = new ControlledRateTtsAdapter({
    cacheDirectory,
    voiceProfileFingerprint: 'voice-v1',
    synthesizeBaseAudio: async () => Buffer.from('base-mp3'),
    renderAudio: async (inputPath, outputPath) => fs.copyFile(inputPath, outputPath),
    readDurationSeconds: async filePath => filePath.endsWith('base.mp3') ? 10 : 10,
  });
  try {
    await assert.rejects(
      () => adapter.getAudio({ packageId: 'package-1', script: 'Hello class.', speed: 'slow' }),
      ControlledRateTtsError,
    );
    const files = await fs.readdir(cacheDirectory, { recursive: true });
    assert.ok(!files.some(file => String(file).endsWith('slow.mp3')));
  } finally {
    await fs.rm(cacheDirectory, { recursive: true, force: true });
  }
});
