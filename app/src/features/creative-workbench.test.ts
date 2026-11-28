// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreativeTask } from '../../contracts/creative';
import { connectionError, connectionMarkup, creativePage, generationError, inProgress, readReference, referenceError, taskBody } from './creative-workbench';

const result: CreativeTask = { id: 'fixture', mode: 'image', status: 'completed', progress: 100, mediaUrl: 'http://127.0.0.1:18610/v1/media/fixture.png' };
const files = (...list: File[]) => { const dt = new DataTransfer(); list.forEach(file => dt.items.add(file)); return dt.files; };
afterEach(() => { vi.restoreAllMocks(); });

describe('创意工作台界面与校验', () => {
  it('图片和视频页面提供各自的比例和本机文件选择，不包含远端链接', () => {
    for (const [mode, aspect, reference] of [['image', 'creative-size', '参考图片'], ['video', 'creative-ratio', '首帧图片']] as const) {
      const host = document.createElement('div');
      host.innerHTML = creativePage(mode);
      expect(host.querySelector('select')?.id).toBe(aspect);
      expect(host.querySelector('[for="creative-reference"]')?.textContent).toContain(reference);
      expect(host.querySelector<HTMLInputElement>('[name="referenceImage"]')?.accept).toBe('image/png,image/jpeg,image/webp');
      expect(host.querySelector('a')).toBeNull();
      expect(host.textContent).toContain('不会使用左侧选中的 Muse 浏览器会话');
      expect(host.textContent).toContain('还没有生成任务');
    }
    expect(connectionMarkup).toContain('type="password"');
    expect(connectionMarkup).not.toContain('m2a_');
  });

  it('提示词按文本呈现，完成、失败和查询中状态不混淆', () => {
    const prompt = '<img src=x onerror=alert(1)>';
    expect(taskBody(result, prompt, 1)).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(taskBody(result, prompt, 1)).not.toContain(prompt);
    expect(taskBody(result, '', 1)).toContain('creative-image-result');
    expect(taskBody({ ...result, mode: 'video' }, '', 1)).toContain('controls');
    expect(taskBody({ ...result, mediaUrl: null }, '', 1)).toContain('未返回本机可预览');
    expect(taskBody({ ...result, status: 'failed' }, '', 1)).not.toContain('creative-save');
    expect(inProgress(result)).toBe(false);
    expect(inProgress({ ...result, status: 'queued' })).toBe(true);
    expect(inProgress({ ...result, status: 'processing' }, { state: 'stopped', message: '不存在', attempts: 1 })).toBe(false);
  });

  it('只接受一张非空 PNG/JPEG/WebP；8 MiB 恰好可用，MIME 缺省时只回退到已知扩展名', async () => {
    expect(referenceError(null)).toBe('');
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(referenceError(files(new File(['x'], 'fake', { type })))).toBe('');
    const png = new File([new Uint8Array(8 * 1024 * 1024)], 'fake.png', { type: 'image/png' });
    expect(referenceError(files(png))).toBe('');
    expect(referenceError(files(new File([png, 'x'], 'oversize.png')))).toContain('8 MiB');
    expect(referenceError(files(new File([], 'empty.png')))).toContain('不能为空');
    expect(referenceError(files(png, png))).toContain('一张');
    expect(referenceError(files(new File(['fake'], 'image.jpg', { type: 'text/html' })))).toContain('PNG');
    expect(referenceError(files(new File(['fake'], 'image.gif')))).toContain('PNG');
    const fallback = new File([new Uint8Array([255, 216, 255])], 'first-frame.JPEG');
    expect(referenceError(files(fallback))).toBe('');
    expect(await readReference(fallback)).toBe('data:image/jpeg;base64,/9j/');
  });

  it('文件读取失败或读取结果不是图片 Data URL 时只报告安全摘要', async () => {
    const file = new File(['fake'], 'fixture.webp', { type: 'image/webp' });
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    read.mockImplementationOnce(function (this: FileReader) { this.dispatchEvent(new ProgressEvent('error')); });
    await expect(readReference(file)).rejects.toMatchObject({ safeMessage: expect.stringContaining('重新选择') });
    read.mockImplementationOnce(function (this: FileReader) { Object.defineProperty(this, 'result', { value: 'https://example.invalid/fake' }); this.dispatchEvent(new ProgressEvent('load')); });
    await expect(readReference(file)).rejects.toMatchObject({ safeMessage: expect.stringContaining('重新选择') });
  });

  it('拒绝无效服务地址、密钥、超长提示词和错误比例', () => {
    for (const address of ['', 'https://127.0.0.1', 'http://example.invalid', 'http://u:p@127.0.0.1', 'http://127.0.0.1/admin', 'http://127.0.0.1/?x', 'http://127.0.0.1/#x']) expect(connectionError(address, 'fixture')).toContain('本机地址');
    for (const key of ['', 'a'.repeat(513), '\u0000fixture', '密钥']) expect(connectionError('http://127.0.0.1', key)).toContain('Key');
    expect(connectionError('http://127.0.0.1:18610/', 'fixture')).toBe('');
    for (const prompt of ['', 'a'.repeat(4001), 'a\u0000b']) expect(generationError('image', prompt, '1024x1024')).toContain('4000');
    expect(generationError('image', '一\n二\t三', '1024x1536')).toBe('');
    expect(generationError('video', '合成', '1:1')).toBe('');
    expect(generationError('video', '合成', '1024x1024')).toContain('比例');
  });
});
