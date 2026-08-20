import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const patterns = [
  ['Resend API key', /\bre_[A-Za-z0-9]{24,}\b/],
  ['Supabase account token', /\bsbp_[A-Za-z0-9]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

function fallbackFiles(directory = '.') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name) || entry.name === '.temp') continue;
      files.push(...fallbackFiles(join(directory, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name !== '.env.example' && (entry.name === '.env' || entry.name.startsWith('.env.')))
      continue;
    files.push(join(directory, entry.name));
  }
  return files;
}

let files;
let source = 'tracked';
try {
  files = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\0')
    .filter(Boolean);
} catch {
  files = fallbackFiles();
  source = 'project';
}
const findings = [];

for (const file of files) {
  const content = readFileSync(file);
  if (content.byteLength > 5_000_000 || content.includes(0)) continue;
  const text = content.toString('utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length > 0) {
  console.error('Potential committed secrets detected (values intentionally hidden):');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret-pattern scan passed across ${files.length} ${source} files.`);
