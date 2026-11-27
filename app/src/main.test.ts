// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mount = vi.hoisted(() => vi.fn());
vi.mock('./shell/workspace', () => ({ mountWorkspace: mount }));

beforeEach(() => {
  document.body.innerHTML = '';
  mount.mockReset();
  vi.resetModules();
});

describe('应用入口', () => {
  it('找到 #app 容器后挂载工作台', async () => {
    const root = document.createElement('main');
    root.id = 'app';
    document.body.append(root);

    await import('./main');

    expect(mount).toHaveBeenCalledExactlyOnceWith(root);
  });

  it('缺少 #app 容器时立即报错', async () => {
    await expect(import('./main')).rejects.toThrow('工作台容器不存在');
    expect(mount).not.toHaveBeenCalled();
  });
});
