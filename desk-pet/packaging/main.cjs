'use strict';
/**
 * 安装版（exe / dmg / AppImage）的入口。
 *
 * 同一个可执行文件扮演两个角色，靠环境变量区分（打包后的 Electron 会忽略命令行里的 app 路径，
 * 没法像开发时那样 `electron runtime/electron-helper/main.js` 指定入口）：
 *   1. 用户启动（双击 / Claude Code 插件自动拉起）：直接在 Electron 主进程里跑桌宠进程
 *      （lib/standalone.js，与 npm 版是同一份代码），并把 DESK_PET_ELECTRON_PATH 指向自己——
 *      桌宠进程拉起桌面 Helper 时就用这个可执行文件，不再另外下载 Electron；
 *   2. 被桌宠进程拉起的桌面 Helper：环境里带着 DESK_PET_HOST_PID（helperSpawnEnv 唯一的 spawn 点设的），
 *      加载 runtime/electron-helper/main.js。
 */
const { app } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

if (process.env.DESK_PET_HOST_PID) {
  require('./runtime/electron-helper/main.js');
} else {
  startHost();
}

/**
 * 只保留桌宠进程认识的参数（见 src/standalone/options.ts）：
 * macOS 从 Finder 打开时会带 -psn_xxx，用户也可能顺手传 Chromium 开关，原样交给 parseArgs 会报「未知参数」退出。
 */
function cliArgs(argv) {
  const kept = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check' || arg === '-h' || arg === '--help' || arg.startsWith('--port=')) {
      kept.push(arg);
    } else if (arg === '--port' && index + 1 < argv.length) {
      kept.push(arg, argv[index + 1]);
      index += 1;
    }
  }
  return kept;
}

/**
 * 在数据目录登记本可执行文件的位置，Claude Code 插件的转发脚本自动拉起桌宠时会读它。
 * AppImage / 便携版运行时 execPath 在临时解压目录里，要登记外层那个文件。
 */
function recordLaunchCommand(args) {
  const command = process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const home = process.env.DESK_PET_HOME || join(homedir(), '.desk-pet');
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'launch.json'), JSON.stringify({ command, args }, null, 2) + '\n', 'utf8');
  } catch {
    /* 登记失败只影响自动拉起，桌宠照常运行 */
  }
}

function startHost() {
  // 桌宠进程本身不开窗口：不占 Dock，也用不到 GPU
  if (app.dock) app.dock.hide();
  app.disableHardwareAcceleration();
  process.env.DESK_PET_ELECTRON_PATH ||= process.execPath;
  // 沙箱不可用的环境（root、AppImage 碰上限制了 user namespace 的发行版，如 Ubuntu 24.04）必须带 --no-sandbox
  // 才启动得了，而且这个检查发生在任何 JS 之前。既然用户这次是带着它启动的，桌面 Helper 和下次自动拉起也都带上
  const electronArgs = app.commandLine.hasSwitch('no-sandbox') ? ['--no-sandbox'] : [];
  if (electronArgs.length && !/(^|\s)--no-sandbox(\s|$)/.test(process.env.DESK_PET_ELECTRON_ARGS || '')) {
    process.env.DESK_PET_ELECTRON_ARGS = `${process.env.DESK_PET_ELECTRON_ARGS || ''} --no-sandbox`.trim();
  }
  recordLaunchCommand(electronArgs);
  const entry = join(__dirname, 'lib', 'standalone.js');
  // 桌宠进程按 Node 的习惯读 process.argv.slice(2)；打包后的 argv 里没有脚本路径，补成 Node 的形状
  const userArgs = process.argv.slice(app.isPackaged ? 1 : 2);
  process.argv = [process.execPath, entry, ...cliArgs(userArgs)];
  import(pathToFileURL(entry).href).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
