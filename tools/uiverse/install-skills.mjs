#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillName = 'uiverse-components';
const receiptName = '.uiverse-install.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readTree(root, prefix = '') {
  const result = new Map();
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const filename = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${filename}`);
    if (entry.isDirectory()) {
      for (const [name, bytes] of await readTree(filename, relative)) result.set(name, bytes);
    } else if (entry.isFile()) result.set(relative, await readFile(filename));
    else throw new Error(`Unsupported resource: ${filename}`);
  }
  return result;
}

async function resourceBundle(sourceRoot) {
  const files = await readTree(path.join(sourceRoot, 'skills', skillName));
  if (!files.has('SKILL.md')) throw new Error('Missing skill/SKILL.md');
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    files.set(name, await readFile(path.join(sourceRoot, name)));
  }
  files.set('lib/cli.mjs', await readFile(path.join(sourceRoot, 'lib', 'uiverse', 'cli.mjs')));
  const assets = await readTree(path.join(sourceRoot, 'lib', 'uiverse', 'assets'));
  if (!assets.size) throw new Error('Missing built library assets; build the package before installing');
  for (const [name, bytes] of assets) {
    // The DSH provider copy is recursively discovered as a duplicate external skill.
    if (name === 'uiverse-components/SKILL.md') continue;
    files.set(`lib/assets/${name}`, bytes);
  }
  const inventory = [...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => ({
    path: name, bytes: bytes.length, sha256: sha256(bytes),
  }));
  const receipt = { formatVersion: 1, skill: skillName, bundleSha256: sha256(JSON.stringify(inventory)), files: inventory };
  files.set(receiptName, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  return { files, receipt };
}

async function targetState(target, files) {
  let stat;
  try { stat = await lstat(target); } catch (error) {
    if (error.code === 'ENOENT') return 'absent';
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing existing non-directory target: ${target}`);
  const existing = await readTree(target);
  if (existing.size === files.size && [...files].every(([name, bytes]) => existing.get(name)?.equals(bytes))) return 'unchanged';
  throw new Error(`Skill target contains different or unknown content: ${target}. Preserve or move it explicitly before installing; nothing is overwritten.`);
}

/** Copy standalone, identical resources; never overwrite an existing different target. */
export async function installSkills({ sourceRoot = packageRoot,
  codexHome = path.join(homedir(), '.codex'), claudeHome = path.join(homedir(), '.claude'),
} = {}) {
  const { files, receipt } = await resourceBundle(path.resolve(sourceRoot));
  const targets = [
    { agent: 'codex', path: path.resolve(codexHome, 'skills', skillName) },
    { agent: 'claude', path: path.resolve(claudeHome, 'skills', skillName) },
  ];
  if (targets[0].path === targets[1].path) throw new Error('Codex and Claude homes must select distinct skill targets');
  // Check all destinations before mutating either one.
  for (const target of targets) target.status = await targetState(target.path, files);
  for (const target of targets) {
    if (target.status === 'unchanged') continue;
    const parent = path.dirname(target.path);
    await mkdir(parent, { recursive: true });
    const staging = path.join(parent, `.${skillName}-install-${randomUUID()}`);
    try {
      await mkdir(staging);
      for (const [name, bytes] of files) {
        const destination = path.join(staging, name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx' });
      }
      if (await targetState(target.path, files) === 'unchanged') target.status = 'unchanged';
      else {
        await rename(staging, target.path);
        target.status = 'installed';
      }
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  return { formatVersion: 1, skill: skillName, bundleSha256: receipt.bundleSha256, targets };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const key = argument === '--codex-home' ? 'codexHome' : argument === '--claude-home' ? 'claudeHome' : null;
    if (!key) throw new Error(`Unknown option: ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing path after ${argument}`);
    if (options[key]) throw new Error(`Duplicate option: ${argument}`);
    options[key] = value;
  }
  return options;
}

const isMain = process.argv[1]
  && await realpath(path.resolve(process.argv[1])).catch(() => null) === await realpath(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write('Usage: node tools/uiverse/install-skills.mjs [--codex-home /path/.codex] [--claude-home /path/.claude]\nInstalls standalone copies into each home/skills/uiverse-components. Identical copies are unchanged; different contents fail without overwrite. No agent configuration is modified.\n');
    else process.stdout.write(`${JSON.stringify(await installSkills(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
