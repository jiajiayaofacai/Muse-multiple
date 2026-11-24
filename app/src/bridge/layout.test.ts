import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBounds } from '../../contracts/workspace';
import { NativeLayout, slotGeometry } from './layout';

describe('原生 slot 布局（不创建真实 WebView）', () => {
  let notifyResize: () => void;
  let frames: FrameRequestCallback[];
  let rect: { x: number; y: number; width: number; height: number };
  let slot: HTMLElement;
  let reporter: NativeLayout | undefined;

  beforeEach(() => {
    frames = [];
    rect = { x: 228.5, y: 166.25, width: 1000.25, height: 600.75 };
    slot = { getBoundingClientRect: () => rect } as HTMLElement;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 850, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    reporter?.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('几何使用逻辑像素并裁入 viewport；隐藏或无面积使用 visible=false', () => {
    const viewport = { width: 1280, height: 850 };
    expect(slotGeometry(rect, true, viewport)).toEqual({ x: 229, y: 167, width: 999, height: 600, visible: true });
    expect(slotGeometry({ x: 190, y: 173, width: 1000, height: 530 }, true, { width: 1113, height: 568 })).toEqual({ x: 190, y: 173, width: 923, height: 395, visible: true });
    expect(slotGeometry(rect, false, viewport)).toEqual({ x: 0, y: 0, width: 0, height: 0, visible: false });
    expect(slotGeometry({ ...rect, height: 0 }, true, viewport).visible).toBe(false);
    const actual = slotGeometry({ x: 228, y: 239.4, width: 1052, height: 604.8 }, true, viewport);
    expect(actual.y + actual.height).toBe(844);
  });

  it('NativeLayout sends bounds clipped to the WebView viewport', async () => {
    rect = { x: 190, y: 173, width: 1000, height: 530 };
    vi.stubGlobal('window', { innerWidth: 1113, innerHeight: 568, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    await reporter.setVisible(true);
    expect(send).toHaveBeenCalledWith({ x: 190, y: 173, width: 923, height: 395, visible: true, layoutSeq: 1 });
  });
  it('相同几何去重，显隐和尺寸变更才推进 layoutSeq', async () => {
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    await reporter.setVisible(true);
    await reporter.setVisible(true);
    await reporter.setVisible(false);
    await reporter.setVisible(false);
    await reporter.setVisible(true);
    expect(send.mock.calls.map(([bounds]) => bounds.layoutSeq)).toEqual([1, 2, 3]);
    expect(send.mock.calls[1][0].visible).toBe(false);
  });

  it('ResizeObserver 与 resize 请求合并，控制台缩小 slot 后更新边界', async () => {
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    await reporter.setVisible(true);
    rect = { ...rect, height: 380.75 };
    notifyResize();
    notifyResize();
    reporter.schedule();
    expect(frames).toHaveLength(1);
    frames[0](0);
    await reporter.setVisible(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].height).toBe(380);
  });

  it('串行发送；弹窗隐藏确认不会被之前的可见请求反超', async () => {
    let release!: () => void;
    const firstSend = new Promise<void>(resolve => { release = resolve; });
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockReturnValueOnce(firstSend).mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    const visible = reporter.setVisible(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    const hidden = reporter.setVisible(false);
    release();
    await Promise.all([visible, hidden]);
    expect(send.mock.calls.map(([bounds]) => [bounds.layoutSeq, bounds.visible])).toEqual([[1, true], [2, false]]);
  });

  it('布局失败不自动重放同一几何，防止诊断事件触发无限 IPC 循环', async () => {
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockRejectedValue(new Error('synthetic failure'));
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    await expect(reporter.setVisible(true)).rejects.toThrow('synthetic failure');
    await expect(reporter.setVisible(true)).rejects.toThrow('synthetic failure');
    expect(send).toHaveBeenCalledTimes(1);
    await expect(reporter.setVisible(false)).rejects.toThrow('synthetic failure');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('握手之前 setVisible、ResizeObserver 和 schedule 均不能发送布局', async () => {
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn());
    notifyResize();
    reporter.schedule();
    await reporter.setVisible(true);
    expect(send).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    reporter.initialize(700);
    await reporter.setVisible(false);
    expect(send.mock.calls[0][0]).toEqual({ x: 0, y: 0, width: 0, height: 0, visible: false, layoutSeq: 701 });
  });

  it('shell reload 使用原生序号基线，首个请求严格大于 baseline', async () => {
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn());
    reporter.initialize(1234);
    await reporter.setVisible(false);
    await reporter.setVisible(true);
    expect(send.mock.calls.map(([bounds]) => bounds.layoutSeq)).toEqual([1235, 1236]);
  });

  it('workspace_busy 经短延迟后重试同一几何并恢复', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>()
      .mockRejectedValueOnce({ code: 'workspace_busy' }).mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    const result = reporter.setVisible(true).catch(error => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBeUndefined();
    expect(send.mock.calls.map(([bounds]) => bounds.layoutSeq)).toEqual([1, 2]);
    expect(send.mock.calls.map(([bounds]) => bounds.visible)).toEqual([true, true]);
  });

  it('workspace_busy 最多追加三次重试，耗尽后不自循环，后续同几何调用可恢复', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>().mockRejectedValue({ code: 'workspace_busy' });
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    const result = expect(reporter.setVisible(true)).rejects.toMatchObject({ code: 'workspace_busy' });
    await vi.advanceTimersByTimeAsync(150);
    await result;
    expect(send).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    send.mockResolvedValue();
    await reporter.setVisible(true);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('新的隐藏边界优先，取消旧 visible 的等待与重试，不让旧请求反超', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>()
      .mockRejectedValueOnce({ code: 'workspace_busy' }).mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    const old = reporter.setVisible(true).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    const hidden = reporter.setVisible(false);
    const result = Promise.all([old, hidden]);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual([undefined, undefined]);
    await vi.advanceTimersByTimeAsync(500);
    expect(send.mock.calls.map(([bounds]) => [bounds.layoutSeq, bounds.visible])).toEqual([[1, true], [2, false]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('invalid_layout 后续可同几何布局事件恢复，不会自动重试', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const send = vi.fn<(bounds: ContentBounds) => Promise<void>>()
      .mockRejectedValueOnce({ code: 'invalid_layout', safeMessage: '原生布局请求无效；未读取网页内容' })
      .mockResolvedValue();
    reporter = new NativeLayout(slot, send, vi.fn(), { initialSequence: 0 });
    await expect(reporter.setVisible(true)).rejects.toMatchObject({ code: 'invalid_layout' });
    await reporter.setVisible(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].layoutSeq).toBeGreaterThan(send.mock.calls[0][0].layoutSeq);
    expect(vi.getTimerCount()).toBe(0);
  });
});
