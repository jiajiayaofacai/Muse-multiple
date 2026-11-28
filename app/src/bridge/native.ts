import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CreativeConnection, CreativeMode, CreativeTask } from '../../contracts/creative';
import type { CommandError, ContentBounds, WorkspaceAction, WorkspaceSnapshot } from '../../contracts/workspace';

export class NativeBridge {
  readonly available = isTauri();
  private unlisten: UnlistenFn | undefined;

  async connect(receive: (snapshot: WorkspaceSnapshot) => void): Promise<void> {
    if (!this.available) return;
    // Subscribe first: a slower initial command must not overwrite a newer event.
    this.unlisten = await listen<WorkspaceSnapshot>('workspace_changed', event => receive(event.payload));
    try {
      receive(await invoke<WorkspaceSnapshot>('workspace_snapshot'));
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  async action(action: WorkspaceAction): Promise<WorkspaceSnapshot> {
    if (!this.available) throw new Error('native-runtime-unavailable');
    return invoke<WorkspaceSnapshot>('workspace_action', { action });
  }

  async beginLayout(): Promise<number> {
    if (!this.available) throw new Error('native-runtime-unavailable');
    return invoke<number>('workspace_layout_begin');
  }

  async layout(bounds: ContentBounds): Promise<void> {
    if (!this.available) return;
    await invoke('workspace_layout', { bounds });
  }

  private creativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.available) return Promise.reject(new Error('native-runtime-unavailable'));
    return invoke<T>(command, args);
  }

  creativeStatus(): Promise<CreativeConnection> { return this.creativeInvoke('creative_status'); }
  connectCreative(baseUrl: string, apiKey: string): Promise<CreativeConnection> { return this.creativeInvoke('creative_connect', { baseUrl, apiKey }); }
  disconnectCreative(): Promise<void> { return this.creativeInvoke('creative_disconnect'); }
  generateImage(prompt: string, size: string, referenceImage?: string): Promise<CreativeTask> {
    return this.creativeInvoke('creative_generate_image', { prompt, size, referenceImage: referenceImage ?? null });
  }
  generateVideo(prompt: string, aspectRatio: string, referenceImage?: string): Promise<CreativeTask> {
    return this.creativeInvoke('creative_generate_video', { prompt, aspectRatio, referenceImage: referenceImage ?? null });
  }
  creativeTask(mode: CreativeMode, taskId: string): Promise<CreativeTask> { return this.creativeInvoke('creative_get_task', { mode, taskId }); }
  saveCreativeResult(mode: CreativeMode, taskId: string): Promise<string> { return this.creativeInvoke('creative_save_result', { mode, taskId }); }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = undefined;
  }
}

export function safeError(error: unknown): string {
  // Do not echo arbitrary invoke errors or navigation URLs into UI/console.
  if (error && typeof error === 'object' && 'safeMessage' in error) {
    const message = (error as CommandError).safeMessage;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return '原生操作未完成。请查看控制台中的安全诊断，或重新启动应用后重试。';
}
