#!/usr/bin/env node
// Validate the agent suite: frontmatter, size caps, references, index completeness, leak patterns.
// Usage: node .claude/skills/learn/scripts/validate.mjs [repo-root]
import { readFileSync, readdirSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const errors = [];
const err = (m) => errors.push(m);
const read = (p) => readFileSync(join(root, p), 'utf8');
const lines = (t) => t.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')).length;

function frontmatter(text, file) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return err(`${file}: missing frontmatter`), {};
  const fm = {};
  let key = null;
  for (const raw of m[1].split('\n')) {
    if (/^\s+-\s/.test(raw) && key) (fm[key] ||= []).push(raw.replace(/^\s+-\s*/, '').replace(/^"|"$/g, ''));
    else if (/^[\w-]+:/.test(raw)) {
      const [, k, v] = raw.match(/^([\w-]+):\s*(.*)$/);
      key = k;
      fm[k] = v === '' ? [] : v.startsWith('[') ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : v.replace(/^"|"$/g, '');
    }
  }
  return fm;
}

const MODELS = /^(fable|opus|sonnet|haiku|inherit|best|claude-[a-z0-9.-]+)$/;
const skillsDir = join(root, '.claude/skills');
const skills = existsSync(skillsDir) ? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, 'SKILL.md'))) : [];
const agentsDir = join(root, '.claude/agents');
const agents = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')) : [];

for (const f of agents) {
  const file = `.claude/agents/${f}`, t = read(file), fm = frontmatter(t, file);
  if (fm.name !== basename(f, '.md')) err(`${file}: name "${fm.name}" != filename`);
  if (!fm.description || fm.description.length < 40) err(`${file}: description missing or too short`);
  if (fm.model && !MODELS.test(fm.model)) err(`${file}: model "${fm.model}" not recognised`);
  if (!fm.tools) err(`${file}: tools not declared (least privilege)`);
  for (const s of fm.skills ?? []) if (!skills.includes(s)) err(`${file}: preloads unknown skill "${s}"`);
  if (lines(t) > 80) err(`${file}: ${lines(t)} lines > 80`);
}
for (const d of skills) {
  const file = `.claude/skills/${d}/SKILL.md`, t = read(file), fm = frontmatter(t, file);
  if (fm.name && fm.name !== d) err(`${file}: name "${fm.name}" != directory`);
  if (!fm.description || fm.description.length < 40) err(`${file}: description missing or too short`);
  if (fm.model && !MODELS.test(fm.model)) err(`${file}: model "${fm.model}" not recognised`);
  if (lines(t) > 200) err(`${file}: ${lines(t)} lines > 200`);
}
const rulesDir = join(root, '.claude/rules');
for (const f of existsSync(rulesDir) ? readdirSync(rulesDir) : []) {
  const file = `.claude/rules/${f}`, t = read(file), fm = frontmatter(t, file);
  if (!fm.paths || !fm.paths.length) err(`${file}: no paths: — would load in every session; move to AGENTS.md if intended`);
  if (lines(t) > 60) err(`${file}: ${lines(t)} lines > 60`);
}

// Index and symlink
const idx = read('AGENTS.md');
if (lines(idx) > 160) err(`AGENTS.md: ${lines(idx)} lines > 160`);
for (const a of agents.map((f) => basename(f, '.md'))) if (!idx.includes('`' + a + '`')) err(`AGENTS.md: agent "${a}" not in routing table`);
for (const s of skills) if (!idx.includes('`' + s + '`') && !idx.includes('`/' + s + '`')) err(`AGENTS.md: skill "${s}" not referenced`);
const cl = join(root, 'CLAUDE.md');
if (!existsSync(cl) || !lstatSync(cl).isSymbolicLink() || readlinkSync(cl) !== 'AGENTS.md') err('CLAUDE.md must be a symlink to AGENTS.md');

// Wiki
const wikiDir = join(root, 'wiki');
const pages = existsSync(wikiDir) ? readdirSync(wikiDir).filter((f) => f.endsWith('.md')) : [];
const wikiIdx = pages.includes('README.md') ? read('wiki/README.md') : (err('wiki/README.md missing'), '');
for (const p of pages) {
  const file = `wiki/${p}`, t = read(file), n = lines(t);
  const cap = p === 'learnings.md' ? 400 : 200;
  if (n > cap) err(`${file}: ${n} lines > ${cap}`);
  if (!['README.md', 'learnings.md'].includes(p)) {
    if (!/^# .+\((checked|synced) \d{4}-\d{2}-\d{2}\)/.test(t.split('\n')[0])) err(`${file}: first line must be "# Title (checked YYYY-MM-DD)"`);
    if (!wikiIdx.includes(`](${p})`)) err(`wiki/README.md: page "${p}" not indexed`);
    const slug = basename(p, '.md');
    if (!idx.includes('`' + slug + '`') && !idx.includes(p)) err(`AGENTS.md: wiki page "${slug}" not routed`);
  }
  for (const m of t.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    const target = resolve(join(root, 'wiki'), m[1]);
    if (!existsSync(target)) err(`${file}: broken link ${m[1]}`);
  }
}

// Leak scan
const scan = ['AGENTS.md', ...agents.map((f) => `.claude/agents/${f}`), ...skills.map((s) => `.claude/skills/${s}/SKILL.md`), ...pages.map((p) => `wiki/${p}`), ...(existsSync(rulesDir) ? readdirSync(rulesDir).map((f) => `.claude/rules/${f}`) : [])];
const extra = process.env.MYFINPRO_FORBIDDEN_PATTERNS ?? join(process.env.HOME ?? '', '.config/myfinpro/forbidden-patterns');
const forbidden = existsSync(extra) ? readFileSync(extra, 'utf8').split('\n').filter(Boolean).map((p) => new RegExp(p)) : [];
for (const file of scan) {
  const t = read(file);
  for (const [i, l] of t.split('\n').entries()) {
    if (/(?<![\w.-])(?!127\.0\.0\.1|0\.0\.0\.0)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.-])/.test(l)) err(`${file}:${i + 1}: IPv4 address`);
    if (/\b[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}\b/i.test(l) && !/example\.com|noreply|\.(test|local|example|invalid)\b/i.test(l)) err(`${file}:${i + 1}: email/user@host`);
    for (const re of forbidden) if (re.test(l)) err(`${file}:${i + 1}: forbidden pattern`);
  }
}
if (!forbidden.length) console.log(`note: no local forbidden-patterns file (${extra}); hostname check skipped`);

if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} problem(s)`); process.exit(1); }
console.log(`OK: ${agents.length} agents, ${skills.length} skills, ${pages.length} wiki pages, AGENTS.md ${lines(idx)} lines`);
