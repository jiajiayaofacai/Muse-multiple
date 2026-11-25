import { version } from '../../src-tauri/tauri.conf.json';

const latest = 'https://api.github.com/repos/jiajiayaofacai/Muse-multiple/releases/latest';
const stableTag = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export async function checkLatestRelease(): Promise<string> {
  try {
    const response = await fetch(latest, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return `未找到公开的正式版本（本机 ${version}）。`;
    if (response.status === 403 || response.status === 429) return 'GitHub 暂时限制访问，请稍后重试。';
    if (!response.ok) return `检查失败（HTTP ${response.status}），请稍后重试。`;
    const release = await response.json();
    const tag = release?.tag_name;
    const remote = typeof tag === 'string' && tag.length <= 128 && stableTag.exec(tag);
    const local = stableTag.exec(version);
    if (!remote || !local || release.draft !== false || release.prerelease !== false) return '无法比较正式版本号，请查看发布页。';
    for (let i = 1; i <= 3; i++) {
      const delta = BigInt(remote[i]) - BigInt(local[i]);
      if (delta > 0n) return `发现新版本 ${tag}（本机 ${version}），可前往发布页下载。`;
      if (delta < 0n) return `本机 ${version} 高于最新公开正式版 ${tag}。`;
    }
    return `已是最新正式版（${version}）。`;
  } catch {
    return '未能完成更新检查，请检查网络后重试。';
  }
}
