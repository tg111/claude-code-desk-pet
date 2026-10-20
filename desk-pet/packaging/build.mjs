#!/usr/bin/env node
/**
 * 打包安装版（Windows exe / macOS dmg / Linux AppImage）。
 *
 * 用法（desk-pet/ 目录下，先 npm run build）：
 *   node packaging/build.mjs                       # 当前平台的默认产物
 *   node packaging/build.mjs --win nsis --x64      # 其余参数原样交给 electron-builder
 *
 * 做什么：
 *   1. 组装 packaging/stage/：package.json 的 files 清单（与 npm 包同一份内容）+ 入口 main.cjs
 *      + 运行依赖（只装 @electron/get；@electron-internal/extract-zip 只在下载 Electron 时才动态加载，
 *      安装版自带 Electron，用不到它，也省得为每个平台准备原生模块）；
 *   2. 调用 electron-builder，产物落在 packaging/dist/。
 *
 * Electron 版本与 scripts/ensure-electron.mjs 的默认版本保持一致（npm 版首次启动下载的就是它）。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ELECTRON_BUILDER = 'electron-builder@26.15.3';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HERE = join(ROOT, 'packaging');
const STAGE = join(HERE, 'stage');
const DIST = join(HERE, 'dist');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const electronVersion = /DESK_PET_ELECTRON_VERSION \|\| '([^']+)'/.exec(
  readFileSync(join(ROOT, 'scripts', 'ensure-electron.mjs'), 'utf8'),
)?.[1];
if (!electronVersion) fail('没能从 scripts/ensure-electron.mjs 读出 Electron 版本');
if (!existsSync(join(ROOT, 'lib', 'standalone.js'))) fail('缺少 lib/standalone.js：先运行 npm run build');

function fail(message) {
  console.error(`[package] ${message}`);
  process.exit(1);
}

function run(command, args, cwd) {
  console.log(`[package] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${command} 失败 (exit ${result.status})`);
}

// 1. 组装 stage
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const entry of pkg.files) {
  cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true });
}
cpSync(join(HERE, 'main.cjs'), join(STAGE, 'main.cjs'));
writeFileSync(
  join(STAGE, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      productName: 'desk-pet',
      version: pkg.version,
      description: 'A desktop pet for Claude Code',
      author: 'tg111',
      homepage: pkg.homepage,
      license: pkg.license,
      // lib/*.js 是 ESM，靠这一行；入口 main.cjs 与 runtime/electron-helper（自带 package.json）仍是 CommonJS
      type: 'module',
      main: 'main.cjs',
      dependencies: { '@electron/get': pkg.dependencies['@electron/get'] },
    },
    null,
    2,
  ) + '\n',
);
run('npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund', '--ignore-scripts'], STAGE);

// 2. electron-builder
const icon = join(HERE, 'icon.png');
const config = {
  appId: 'io.github.tg111.desk-pet',
  productName: 'desk-pet',
  electronVersion,
  // 不打 asar：桌宠进程按真实路径读素材、拉起 Helper，保持与 npm 版一致的目录结构
  asar: false,
  directories: { output: DIST },
  files: ['**/*', '!electron-builder.json'],
  afterPack: join(HERE, 'after-pack.cjs'),
  publish: null,
  mac: {
    target: ['dmg'],
    category: 'public.app-category.entertainment',
    icon,
    // 没有 Apple 开发者证书：跳过正式签名，由 after-pack.cjs 做 ad-hoc 签名（Apple 芯片上不签名的 app 直接打不开）
    identity: null,
    // 只在菜单栏托盘里出现，不占 Dock
    extendInfo: { LSUIElement: true },
  },
  dmg: { artifactName: 'desk-pet-${version}-mac-${arch}.${ext}' },
  win: { target: ['nsis'], icon },
  nsis: { artifactName: 'desk-pet-${version}-win-${arch}-setup.${ext}' },
  linux: { target: ['AppImage'], icon, category: 'Utility' },
  appImage: { artifactName: 'desk-pet-${version}-linux-${arch}.${ext}' },
};
writeFileSync(join(STAGE, 'electron-builder.json'), JSON.stringify(config, null, 2) + '\n');
rmSync(DIST, { recursive: true, force: true });
run(
  'npx',
  [
    '--yes',
    ELECTRON_BUILDER,
    '--projectDir',
    '.',
    '--config',
    'electron-builder.json',
    '--publish',
    'never',
    ...process.argv.slice(2),
  ],
  STAGE,
);
console.log(`[package] ✓ 产物在 ${DIST}`);
