import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSnapshot } from '../../contracts/workspace';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const event = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
vi.mock('@tauri-apps/api/event', () => event);

import { listen } from '@tauri-apps/api/event';
import { NativeBridge, safeError } from './native';

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
describe('NativeBridge', () => {
  it('先订阅 workspace_changed，再读取快照；事件回调透传 payload', async () => {
    const order: string[] = [];
    const eventSnapshot = { revision: 2 } as WorkspaceSnapshot;
    const initialSnapshot = { revision: 1 } as WorkspaceSnapshot;
    const received: WorkspaceSnapshot[] = [];
    const unlisten = vi.fn();
    event.listen.mockImplementation(async (_name: string, handler: (event: { payload: WorkspaceSnapshot }) => void) => {
      order.push('listen');
      handler({ payload: eventSnapshot });
      return unlisten;
    });
    native.invoke.mockImplementation(async (command: string) => {
      order.push(command);
      return initialSnapshot;
    });

    await new NativeBridge().connect(snapshot => received.push(snapshot));

    expect(order).toEqual(['listen', 'workspace_snapshot']);
    expect(received).toEqual([eventSnapshot, initialSnapshot]);
    expect(listen).toHaveBeenCalledExactlyOnceWith('workspace_changed', expect.any(Function));
  });

  it('快照读取失败时撤销事件订阅并传播错误', async () => {
    const unlisten = vi.fn();
    const error = { safeMessage: 'snapshot failed' };
    event.listen.mockResolvedValueOnce(unlisten);
    native.invoke.mockRejectedValueOnce(error);
    const bridge = new NativeBridge();

    await expect(bridge.connect(() => {})).rejects.toBe(error);
    expect(unlisten).toHaveBeenCalledTimes(1);
    bridge.dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('非 Tauri 环境不订阅，不执行 action/layout，layout no-op', async () => {
    native.isTauri.mockReturnValue(false);
    const bridge = new NativeBridge();
    await bridge.connect(() => {});
    await expect(bridge.action({ type: 'retryProfileCleanup' })).rejects.toThrow('native-runtime-unavailable');
    await expect(bridge.beginLayout()).rejects.toThrow('native-runtime-unavailable');
    await expect(bridge.layout({ x: 0, y: 0, width: 0, height: 0, visible: false, layoutSeq: 0 })).resolves.toBeUndefined();
    expect(event.listen).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('action、beginLayout 和 layout 转发参数与原生错误', async () => {
    const bridge = new NativeBridge();
    const result = { revision: 4 } as WorkspaceSnapshot;
    const action = { type: 'retryProfileCleanup' } as const;
    const bounds = { x: 1, y: 2, width: 300, height: 200, visible: true, layoutSeq: 9 };
    native.invoke.mockResolvedValueOnce(result).mockResolvedValueOnce(12).mockResolvedValueOnce(undefined);

    await expect(bridge.action(action)).resolves.toBe(result);
    await expect(bridge.beginLayout()).resolves.toBe(12);
    await expect(bridge.layout(bounds)).resolves.toBeUndefined();
    expect(native.invoke.mock.calls).toEqual([
      ['workspace_action', { action }],
      ['workspace_layout_begin'],
      ['workspace_layout', { bounds }],
    ]);
    const error = new Error('native rejected');
    native.invoke.mockRejectedValueOnce(error);
    await expect(bridge.layout(bounds)).rejects.toBe(error);
  });

  it('dispose 可重复调用且仅调用一次 unlisten', async () => {
    const unlisten = vi.fn();
    event.listen.mockResolvedValueOnce(unlisten);
    native.invoke.mockResolvedValueOnce({ revision: 1 });
    const bridge = new NativeBridge();
    await bridge.connect(() => {});
    bridge.dispose();
    bridge.dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe('safeError', () => {
  it('只返回非空 safeMessage，其它错误一律使用固定文案', () => {
    expect(safeError({ code: 'failure', safeMessage: '安全摘要', retryable: true })).toBe('安全摘要');
    expect(safeError({ safeMessage: '  ' })).toContain('原生操作未完成');
    expect(safeError({ safeMessage: 12 })).toContain('原生操作未完成');
    expect(safeError(new Error('含敏感内容的原始错误'))).toContain('原生操作未完成');
    expect(safeError(null)).toContain('原生操作未完成');
  });
});
