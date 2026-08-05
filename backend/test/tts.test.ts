import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createTtsRouter } from '../src/routes/tts.js';

async function withServer(router: express.Router, verify: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server unavailable');
    await verify(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('rejects arbitrary speed values and only renders a verified listening package script', async () => {
  let controlledCalls = 0;
  const router = createTtsRouter({
    getListeningScript: packageId => packageId === 'listening-1' ? 'Hello students.' : null,
    controlledRateAdapter: {
      getAudio: async request => {
        controlledCalls++;
        return {
          audio: Buffer.from(request.speed), cached: false, speed: request.speed,
          renderer: 'controlled-rate-v1' as const, cacheKeyVersion: 2 as const,
        };
      },
    },
  });
  await withServer(router, async baseUrl => {
    const invalid = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello students.', coursewareId: 'listening-1', speed: '0.8' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).errorCode, 'invalid_audio_speed');

    const notListening = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello students.', coursewareId: 'not-a-listening-package', speed: 'slow' }),
    });
    assert.equal(notListening.status, 400);

    const controlled = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello students.', coursewareId: 'listening-1', speed: 'slow' }),
    });
    assert.equal(controlled.status, 200);
    const body = await controlled.json();
    assert.equal(body.speed, 'slow');
    assert.equal(body.renderer, 'controlled-rate-v1');
    assert.equal(controlledCalls, 1);
  });
});

test('keeps no-speed courseware requests on the existing cache path', async () => {
  const previousKey = process.env.VOLCANO_TTS_API_KEY;
  process.env.VOLCANO_TTS_API_KEY = 'test-key';
  let syntheses = 0;
  const router = createTtsRouter({
    synthesizeAudio: async () => { syntheses++; return Buffer.from('legacy-courseware-audio'); },
  });
  try {
    await withServer(router, async baseUrl => {
      const coursewareId = `courseware-${randomUUID()}`;
      for (let index = 0; index < 2; index++) {
        const response = await fetch(`${baseUrl}/api/tts`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Existing courseware narration.', coursewareId, chunkIdx: 0 }),
        });
        assert.equal(response.status, 200);
      }
      assert.equal(syntheses, 1);
    });
  } finally {
    if (previousKey === undefined) delete process.env.VOLCANO_TTS_API_KEY;
    else process.env.VOLCANO_TTS_API_KEY = previousKey;
  }
});
