// 一键发布：改版本 → 还原 patch 占位符 → publish → 无论成败都把本机 patch 恢复。
// 用法：
//   node scripts/release.mjs patch            # 0.2.1 -> 0.2.2
//   node scripts/release.mjs minor            # 0.2.1 -> 0.3.0
//   node scripts/release.mjs 0.3.0            # 指定版本
//   node scripts/release.mjs patch --dry-run  # 只打包校验，不真发
//
// 需要发布权限：环境变量 NPM_TOKEN，或 ~/.npmrc 里已配好 _authToken。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgFile = path.join(root, 'package.json');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpArg = args.find((a) => !a.startsWith('--')) || 'patch';

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function bumpVersion(current, spec) {
  if (/^\d+\.\d+\.\d+(-\S+)?$/.test(spec)) return spec;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!m) fail(`当前版本号解析不了：${current}`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (spec === 'major') { major += 1; minor = 0; patch = 0; }
  else if (spec === 'minor') { minor += 1; patch = 0; }
  else if (spec === 'patch') { patch += 1; }
  else fail(`参数要 patch / minor / major 或具体版本号，收到：${spec}`);
  return `${major}.${minor}.${patch}`;
}

function compare(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// 找一个可用的 npm/pnpm 可执行文件
function resolvePublisher() {
  const candidates = [
    process.env.NPM_BIN,
    process.env.PNPM_BIN,
    'npm',
    'pnpm',
    'C:/Users/skbds/AppData/Local/Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs'
  ].filter(Boolean);
  for (const c of candidates) {
    if (c.endsWith('.mjs')) {
      if (fs.existsSync(c)) return { kind: 'script', bin: process.execPath, args: [c] };
      continue;
    }
    const probe = spawnSync(c, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (probe.status === 0) return { kind: c === 'npm' ? 'npm' : 'pnpm', bin: c, args: [] };
  }
  return null;
}

function hasAuth() {
  if (process.env.NPM_TOKEN) return 'env';
  const npmrc = path.join(process.env.USERPROFILE || process.env.HOME || '', '.npmrc');
  try {
    if (/_authToken=/.test(fs.readFileSync(npmrc, 'utf8'))) return 'npmrc';
  } catch { /* 没文件 */ }
  return null;
}

function runPrepack() { /* MCP 路径由启动器运行时解析，无需预处理 */ }

function runPostinstall() { /* 同上，无需恢复 */ }

const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const current = pkg.version;
const next = bumpVersion(current, bumpArg);
if (compare(next, current) <= 0) fail(`新版本 ${next} 必须大于当前版本 ${current}`);

const publisher = resolvePublisher();
if (!publisher) fail('找不到 npm 或 pnpm 命令，无法发布');
const auth = hasAuth();
if (!dryRun && !auth) fail('没有发布凭据：请设置 NPM_TOKEN 环境变量，或在 ~/.npmrc 里配置 _authToken');

console.log(`\n包名     ${pkg.name}`);
console.log(`版本     ${current} → ${next}${dryRun ? '（dry-run，不发布）' : ''}`);
console.log(`发布器   ${publisher.bin} ${publisher.args.join(' ')}`);
if (!dryRun) console.log(`凭据     来自 ${auth}`);
console.log('');

// 写版本号（dry-run 也写，失败时回滚）
const original = fs.readFileSync(pkgFile, 'utf8');
fs.writeFileSync(pkgFile, JSON.stringify({ ...pkg, version: next }, null, 2) + '\n');

let ok = false;
try {
  runPrepack();
  const pubArgs = [...publisher.args, 'publish', '--access', 'public', '--no-git-checks'];
  if (dryRun) pubArgs.push('--dry-run');
  const r = spawnSync(publisher.bin, pubArgs, { cwd: root, stdio: 'inherit', env: { ...process.env } });
  if (r.status !== 0) throw new Error(`publish 退出码 ${r.status}`);
  ok = true;
  // dry-run 不能留下新版本号，否则下次会以为已经发过了
  if (dryRun) fs.writeFileSync(pkgFile, original);
} catch (error) {
  console.error(`\n✗ 发布失败：${error.message}`);
  fs.writeFileSync(pkgFile, original);
  console.error('  已把 package.json 版本号回滚');
} finally {
  runPostinstall();
}

if (ok) {
  if (dryRun) {
    console.log(`\n✓ dry-run 通过（${next} 打包正常，版本号已回滚，未发布）`);
  } else {
    console.log(`\n✓ ${pkg.name}@${next} 已发布`);
    console.log('  验证：https://www.npmjs.com/package/' + pkg.name);
    console.log('  别忘了：发布完成后撤销这次用的 npm token');
  }
  process.exit(0);
}
process.exit(1);
