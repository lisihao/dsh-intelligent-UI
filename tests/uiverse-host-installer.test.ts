import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'

const run = promisify(execFile)
test('the integrated package installs matching standalone skills without a duplicate DSH entrypoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-uiverse-skill-'))
  try {
    const installer = fileURLToPath(new URL('../tools/uiverse/install-skills.mjs', import.meta.url))
    const args = [installer, '--codex-home', join(root, 'codex'), '--claude-home', join(root, 'claude')]
    const first = JSON.parse((await run(process.execPath, args)).stdout)
    expect(first.targets.map((target: { status: string }) => target.status)).toEqual(['installed', 'installed'])
    const roots = [join(root, 'codex/skills/uiverse-components'), join(root, 'claude/skills/uiverse-components')]
    expect(await readFile(join(roots[0]!, '.uiverse-install.json'))).toEqual(await readFile(join(roots[1]!, '.uiverse-install.json')))
    for (const target of roots) {
      expect((await readdir(target, { recursive: true })).filter(name => name.endsWith('SKILL.md'))).toEqual(['SKILL.md'])
      expect(await readFile(join(target, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toContain('entities')
      expect(await readFile(join(target, 'lib/assets/LICENSE'), 'utf8')).toContain('Copyright (c) 2023 Uiverse.io')
      const categories = JSON.parse((await run(process.execPath, [join(target, 'lib/cli.mjs'), 'categories'], { cwd: root })).stdout)
      expect(categories.total).toBe(3802)
    }
    const second = JSON.parse((await run(process.execPath, args)).stdout)
    expect(second.bundleSha256).toBe(first.bundleSha256)
    expect(second.targets.map((target: { status: string }) => target.status)).toEqual(['unchanged', 'unchanged'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
