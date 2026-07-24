import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.agent', '.agents', '.claude', '.codex', '.git', '.gitnexus', 'node_modules', 'artifacts']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md']);
const explicitFiles = new Set(['.env.example']);
const blockedTerms = [
  ['ge', 'mini'].join(''),
  ['anything', 'llm'].join(''),
  ['@google/', 'genai'].join(''),
  ['@google/', 'generative-ai'].join(''),
  ['GE', 'MINI', '_API_KEY'].join(''),
].map(value => value.toLowerCase());
const matches = [];

function shouldScan(relativePath) {
  const fileName = path.basename(relativePath);
  return sourceExtensions.has(path.extname(fileName)) || explicitFiles.has(fileName);
}

function scanDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) scanDirectory(path.join(directory, entry.name));
      continue;
    }
    const filePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, filePath);
    if (!shouldScan(relativePath)) continue;

    const lowerContent = fs.readFileSync(filePath, 'utf8').toLowerCase();
    const lowerPath = relativePath.toLowerCase();
    for (const blockedTerm of blockedTerms) {
      if (lowerPath.includes(blockedTerm) || lowerContent.includes(blockedTerm)) {
        matches.push(`${relativePath}: ${blockedTerm}`);
      }
    }
  }
}

scanDirectory(root);

if (matches.length > 0) {
  console.error('检测到旧提供商残留:');
  for (const match of matches) console.error(`- ${match}`);
  process.exitCode = 1;
} else {
  console.log('旧提供商残留扫描通过');
}
