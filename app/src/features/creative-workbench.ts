import type { CreativeMode, CreativeTask } from '../../contracts/creative';
import { escapeHtml as esc, icon } from '../ui/markup';
import './creative-workbench.css';

const specs = {
  image: {
    heading: '图片工作台', field: '提示词', submit: '生成图片', reference: '参考图片',
    placeholder: '例如：清晨薄雾中的海边小屋，暖色窗灯，电影感构图',
    options: [['1024x1024', '正方形 · 1:1'], ['1536x1024', '横向 · 3:2'], ['1024x1536', '纵向 · 2:3']],
  },
  video: {
    heading: '视频工作台', field: '视频提示词', submit: '生成视频', reference: '首帧图片',
    placeholder: '例如：镜头缓慢推近，海浪轻拍海边小屋，晨雾渐渐散开',
    options: [['16:9', '横向 · 16:9'], ['1:1', '正方形 · 1:1'], ['9:16', '纵向 · 9:16']],
  },
} as const;

export const emptyResults = '<div class="creative-empty"><strong>还没有生成任务</strong></div>';
export const connectionMarkup = `<details open><summary><strong id="creative-connection-title">生成服务连接</strong><span class="creative-connect-status" role="status"></span></summary>
  <form class="creative-connect-form" action="#" method="post" novalidate aria-label="连接本机 Muse2API">
    <div class="creative-connect-fields"><div class="creative-field"><label for="creative-service-url">本机服务地址</label><input id="creative-service-url" name="baseUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" required maxlength="160" value="http://127.0.0.1:18610" aria-describedby="creative-service-help creative-connection-error"></div>
    <div class="creative-field"><label for="creative-api-key">Muse2API API Key</label><input id="creative-api-key" name="apiKey" type="password" autocomplete="off" spellcheck="false" required maxlength="512" aria-describedby="creative-key-help creative-connection-error" placeholder="连接时输入；不会保存"></div></div>
    <p id="creative-service-help" class="creative-help">只接受本机 127.0.0.1 服务。重新连接或断开会清除本次任务列表，不会取消服务端已接受的任务。</p>
    <p id="creative-key-help" class="creative-help">API Key 仅保存在当前应用进程内存中；退出应用后需重新连接，不写入工作台设置或日志。</p>
    <p id="creative-connection-error" class="creative-error" role="alert"></p>
    <footer><button type="submit" class="primary">连接并验证</button><button type="button" class="secondary" data-action="creative-disconnect" hidden>断开连接</button></footer>
  </form></details>`;

export function creativePage(mode: CreativeMode): string {
  const spec = specs[mode];
  const aspectId = mode === 'image' ? 'creative-size' : 'creative-ratio';
  return `<div class="page creative-page" data-creative-mode="${mode}">
    <header class="page-heading creative-heading"><h1>${spec.heading}</h1><span class="creative-pool-badge">Muse2API 账号池</span></header>
    <div class="creative-connection-slot"></div>
    <div class="creative-grid"><form class="creative-generate-form" action="#" method="post" novalidate aria-labelledby="creative-prompt-heading">
      <div class="creative-section-heading"><h2 id="creative-prompt-heading">${spec.field}</h2><span>最多 4000 字</span></div>
      <label class="visually-hidden" for="creative-prompt">${spec.field}</label><textarea id="creative-prompt" name="prompt" rows="5" maxlength="4000" required placeholder="${spec.placeholder}" aria-describedby="creative-prompt-help creative-submit-error"></textarea>
      <div class="creative-options"><label for="${aspectId}">${mode === 'image' ? '图片' : '视频'}比例</label><select id="${aspectId}" name="${mode === 'image' ? 'size' : 'aspectRatio'}">${spec.options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div>
      <div class="creative-reference"><label for="creative-reference">${spec.reference}（可选）</label><div class="creative-reference-row"><input type="file" id="creative-reference" name="referenceImage" accept="image/png,image/jpeg,image/webp" aria-describedby="creative-reference-help creative-file-error"><button type="button" class="icon-button" data-action="creative-remove-reference" aria-label="移除${spec.reference}" title="移除${spec.reference}" hidden>${icon('close')}</button></div>
      <span class="creative-reference-name" role="status"></span><p id="creative-reference-help" class="creative-help">单张本机 PNG、JPEG 或 WebP 图片，最大 8 MiB。</p><p id="creative-file-error" class="creative-error" role="alert"></p></div>
      <p id="creative-prompt-help" class="creative-help">生成账号由 Muse2API 账号池独立选择；不会使用左侧选中的 Muse 浏览器会话。</p>
      <p id="creative-submit-error" class="creative-error" role="alert"></p>
      <button type="submit" class="primary creative-submit" disabled>${spec.submit}</button>
      <p class="creative-disabled-note">连接 Muse2API 后即可提交生成任务。</p>
    </form><section class="creative-results-panel" aria-labelledby="creative-results-heading"><div class="creative-section-heading"><h2 id="creative-results-heading">任务与结果</h2><span class="creative-active-count" role="status">0 项进行中</span></div><div class="creative-results">${emptyResults}</div></section></div>
  </div>`;
}

export type QueryIssue = { state: 'retrying' | 'paused' | 'stopped'; attempts: number; message: string };
export function inProgress(task: CreativeTask, issue?: QueryIssue): boolean {
  return (task.status === 'queued' || task.status === 'processing') && (!issue || issue.state === 'retrying');
}

export function taskBody(task: CreativeTask, prompt: string, index: number, issue?: QueryIssue): string {
  const label = issue ? { retrying: '暂时无法查询，稍后自动重试', paused: '已暂停查询', stopped: '已停止查询' }[issue.state]
    : { queued: '排队中', processing: '生成中', failed: '生成失败，请检查 Muse2API', completed: '已完成' }[task.status];
  const progress = task.status === 'completed' ? 100 : task.progress;
  const media = task.status !== 'completed' ? '' : !task.mediaUrl
    ? '<p class="creative-result-note">任务已完成，服务未返回本机可预览的媒体链接。</p>'
    : task.mode === 'image'
      ? `<img class="creative-image-result" src="${esc(task.mediaUrl)}" alt="生成结果：${esc(prompt)}" referrerpolicy="no-referrer">`
      : `<video class="creative-video-result" src="${esc(task.mediaUrl)}" controls preload="metadata" playsinline aria-label="生成结果：${esc(prompt)}" referrerpolicy="no-referrer"></video>`;
  return `<header class="creative-task-head"><div><span class="creative-task-index">任务 ${index}</span><strong>${esc(prompt)}</strong></div><span class="creative-task-status ${task.status}" role="status">${label}</span></header>
    ${task.status === 'failed' ? '' : `<progress max="100" value="${progress}" aria-label="${label} ${progress}%"></progress>`}${media}
    ${issue ? `<p class="creative-result-note">${esc(issue.message)}</p>` : ''}${issue?.state === 'paused' ? '<button type="button" class="secondary" data-action="creative-retry">重新查询</button>' : ''}
    ${task.status === 'completed' ? '<footer class="creative-task-actions"><button type="button" class="secondary" data-action="creative-save">保存到下载目录</button><span class="creative-save-status" role="status"></span></footer>' : ''}`;
}

const formats: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
function imageType(file: File): string | undefined {
  // Windows may omit the MIME type; native validation also checks the actual bytes.
  return file.type || formats[file.name.split('.').pop()!.toLowerCase()];
}
export function referenceError(files: FileList | null): string {
  if (!files?.length) return '';
  if (files.length !== 1) return '每次只能选择一张图片。';
  const file = files[0];
  if (!file.size || file.size > 8 * 1024 * 1024) return '图片不能为空，且不能超过 8 MiB。';
  return Object.values(formats).includes(imageType(file) ?? '') ? '' : '请选择 PNG、JPEG 或 WebP 格式的本机图片。';
}
export function readReference(file: File): Promise<string> {
  const type = imageType(file)!;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const fail = () => reject({ safeMessage: '无法读取本机图片，请重新选择文件。' });
    reader.onerror = reader.onabort = fail;
    reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith(`data:${type};base64,`) ? resolve(reader.result) : fail();
    reader.readAsDataURL(file.type ? file : file.slice(0, file.size, type));
  });
}

export function generationError(mode: CreativeMode, prompt: string, aspect: string): string {
  if (!prompt || [...prompt].length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(prompt)) return '请填写提示词（最多 4000 字），并移除不可见控制字符。';
  return specs[mode].options.some(([value]) => value === aspect) ? '' : '请选择有效的生成比例。';
}

export function connectionError(address: string, key: string): string {
  try {
    const url = new URL(address);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch { return '请输入不带路径的本机地址，例如 http://127.0.0.1:18610。'; }
  return /^[\x20-\x7e]{1,512}$/.test(key) ? '' : '请输入有效的 Muse2API API Key。';
}
