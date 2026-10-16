import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { ARK_PRO_MODEL, ARK_OCR_LITE_MODEL, ARK_GENERATION_OPTIONS, ARK_EXTRACTION_OPTIONS, requireArkContent } from '../dist/services/arkModelPolicy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const option = name => process.argv[process.argv.indexOf(name) + 1];
dotenv.config({ path: process.argv.includes('--env-file') ? option('--env-file') : path.join(root, '.env') });
assert.ok(process.env.ARK_API_KEY, 'ARK_API_KEY is required');
const output = path.resolve(process.argv.includes('--output') ? option('--output') : path.join(root, 'tmp/ark-verification.json'));
const client = new OpenAI({ apiKey: process.env.ARK_API_KEY, baseURL: 'https://ark.cn-beijing.volces.com/api/v3', timeout: 120_000, maxRetries: 0 });
const report = { timestamp: new Date().toISOString(), syntheticDataOnly: true, checks: [] };

async function check(name, action) {
  const start = Date.now();
  try {
    const result = await action();
    report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - start, ...result });
  } catch (error) {
    // Provider errors can contain request/credential details. Archive only an
    // allowlisted status/code, never the raw exception or request object.
    report.checks.push({ name, status: 'failed', elapsedMs: Date.now() - start, httpStatus: error.status || null, code: error instanceof OpenAI.APIConnectionTimeoutError ? 'api_timeout' : error.code || error.name });
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report.checks.at(-1)));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
}

for (const model of [ARK_PRO_MODEL, ARK_OCR_LITE_MODEL]) {
  await check(`text-json:${model}`, async () => {
    const response = await client.chat.completions.create({
      ...ARK_GENERATION_OPTIONS, model, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return only JSON {"answer":42,"explanation":"24 plus 18 is 42"}. Calculate 24 + 18.' }],
    });
    assert.equal(response.model, model);
    assert.equal(JSON.parse(requireArkContent(response)).answer, 42);
    return { model: response.model, finishReason: response.choices[0].finish_reason, usage: response.usage };
  });
}

// A fixed synthetic fixture avoids native rendering dependencies and student data.
const imageBytes = await fs.readFile(new URL('../test/fixtures/ark-arithmetic.png', import.meta.url));
const image = `data:image/png;base64,${imageBytes.toString('base64')}`;
await check('vision-chat:pro', async () => {
  const response = await client.chat.completions.create({
    ...ARK_EXTRACTION_OPTIONS, model: ARK_PRO_MODEL, temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: 'Solve the arithmetic in the image. Return only JSON {"answer": number}.' }] }],
  });
  assert.equal(response.model, ARK_PRO_MODEL);
  assert.equal(JSON.parse(requireArkContent(response)).answer, 42);
  return { model: response.model, finishReason: response.choices[0].finish_reason, usage: response.usage };
});

for (const model of [ARK_PRO_MODEL, ARK_OCR_LITE_MODEL]) {
  await check(`vision-responses:${model}`, async () => {
    const result = await fetch('https://ark.cn-beijing.volces.com/api/v3/responses', {
      method: 'POST', signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, reasoning: { effort: 'minimal' }, max_output_tokens: 3000,
        input: [{ role: 'user', content: [{ type: 'input_image', image_url: image }, { type: 'input_text', text: 'Solve the arithmetic in the image. Return only JSON {"answer": number}.' }] }],
      }),
    });
    assert.equal(result.status, 200);
    const response = await result.json();
    assert.equal(response.model, model);
    assert.equal(response.status, 'completed');
    const text = response.output.filter(item => item.type === 'message').flatMap(item => item.content).filter(item => item.type === 'output_text').map(item => item.text).join('');
    assert.equal(JSON.parse(text).answer, 42);
    return { model: response.model, responseStatus: response.status, usage: response.usage };
  });
}

// This workload exceeds the current application blueprint (at most ten
// questions). Run it explicitly, keeping its failure separate from compatibility.
if (process.argv.includes('--include-stress')) await check('long-paper-json:pro', async () => {
  const response = await client.chat.completions.create({
    ...ARK_GENERATION_OPTIONS, model: ARK_PRO_MODEL, temperature: 0.25,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: 'Create original primary-school English practice. Return only JSON {"questions":[...]}. Exactly 40 questions, numbered 1-40 in id. Each question must include stem (at least 15 English words), options (four distinct choices), answer, explanation (at least 35 English words explaining the answer). Use short present-tense school, home, clothes and jobs vocabulary. Do not abbreviate, omit questions or use placeholders.' }],
  });
  assert.equal(response.model, ARK_PRO_MODEL);
  const content = requireArkContent(response);
  const parsed = JSON.parse(content);
  assert.equal(parsed.questions.length, 40);
  assert.ok(parsed.questions.every(q => q.stem && q.options?.length === 4 && q.answer && q.explanation));
  assert.ok(parsed.questions.every(q => q.stem.trim().split(/\s+/).length >= 15 && q.explanation.trim().split(/\s+/).length >= 35));
  return { model: response.model, finishReason: response.choices[0].finish_reason, questions: 40, contentCharacters: content.length, usage: response.usage };
});
