'use strict';
/**
 * electron-builder 的 afterPack 钩子：macOS 上给 .app 做 ad-hoc 签名。
 *
 * 没有 Apple 开发者证书时 electron-builder 跳过签名，但它改过 Info.plist 等文件，Electron 自带的签名随之失效；
 * Apple 芯片的 Mac 不运行签名无效的程序（提示「已损坏」）。ad-hoc 签名不需要证书，签完就能打开
 * （首次打开仍要在「系统设置 → 隐私与安全性」里点「仍要打开」，见 README）。
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
