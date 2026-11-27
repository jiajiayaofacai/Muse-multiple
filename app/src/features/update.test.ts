import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../src-tauri/tauri.conf.json';
import { checkLatestRelease } from './update';

vi.mock('../../src-tauri/tauri.conf.json', () => ({ default: { version: '1.10.0' }, version: '1.10.0' }));
afterEach(() => vi.unstubAllGlobals());
describe('公开正式版检查', () => {
  it.each([
    ['v1.11.0', '发现新版本'], ['v2.0.0', '发现新版本'], ['1.10.0+build.1', '已是最新'], ['1.9.99', '高于'],
    ['v1.11.0-rc.1', '无法比较'], ['n/a', '无法比较'], ['01.2.3', '无法比较'],
  ])('%s → %s', async (tag, message) => {
    const request = vi.fn().mockResolvedValue(Response.json({ tag_name: tag, draft: false, prerelease: false }));
    vi.stubGlobal('fetch', request);
    expect(await checkLatestRelease()).toContain(message);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('https://api.github.com/repos/jiajiayaofacai/Muse-multiple/releases/latest', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  });
  it.each([[404, '未找到公开'], [403, '限制访问'], [429, '限制访问'], [500, '检查失败']] as const)('%i → %s', async (status, message) => {
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    expect(await checkLatestRelease()).toContain(message);
  });
  it('不把预发布、无效 JSON 或网络失败当作最新版本', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ tag_name: config.version, draft: false, prerelease: true })).mockResolvedValueOnce(new Response('invalid')).mockRejectedValueOnce(new Error()));
    expect(await checkLatestRelease()).toContain('无法比较');
    expect(await checkLatestRelease()).toContain('未能完成');
    expect(await checkLatestRelease()).toContain('未能完成');
  });
});
