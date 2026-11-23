import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { NativeBridge } from './native';

beforeEach(() => {
  vi.resetAllMocks();
  native.isTauri.mockReturnValue(true);
});

describe('布局启动握手', () => {
  it('调用无参受信命令并返回原生最大序号，不自行重置为零', async () => {
    native.invoke.mockResolvedValueOnce(812);
    expect(await new NativeBridge().beginLayout()).toBe(812);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('workspace_layout_begin');
  });

  it('握手失败向启动方传播，不伪造成功或回退序号', async () => {
    const error = { code: 'workspace_busy', safeMessage: '合成握手失败', retryable: true };
    native.invoke.mockRejectedValueOnce(error);
    await expect(new NativeBridge().beginLayout()).rejects.toBe(error);
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('非 Tauri 环境不调用原生握手、不提供 mock baseline', async () => {
    native.isTauri.mockReturnValue(false);
    await expect(new NativeBridge().beginLayout()).rejects.toThrow('native-runtime-unavailable');
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
