import type { CreativeConnection, CreativeMode, CreativeTask } from '../../contracts/creative';
import { safeError, type NativeBridge } from '../bridge/native';
import { connectionError, connectionMarkup, creativePage, emptyResults, generationError, inProgress, readReference, referenceError, taskBody, type QueryIssue } from './creative-workbench';

interface Job {
  task: CreativeTask; prompt: string; index: number; card: HTMLElement;
  issue?: QueryIssue; save: 'ready' | 'saving' | 'saved';
}

const find = <T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string) => root.querySelector<T>(selector)!;
function modeView(mode: CreativeMode) {
  const template = document.createElement('template');
  template.innerHTML = creativePage(mode);
  const page = template.content.firstElementChild as HTMLElement;
  return {
    mode, page, form: find<HTMLFormElement>(page, 'form'), prompt: find<HTMLTextAreaElement>(page, 'textarea'),
    aspect: find<HTMLSelectElement>(page, 'select'), file: find<HTMLInputElement>(page, '[name="referenceImage"]'),
    submit: find<HTMLButtonElement>(page, '.creative-submit'), remove: find<HTMLButtonElement>(page, '[data-action="creative-remove-reference"]'),
    results: find(page, '.creative-results'), jobs: new Map<string, Job>(), submitting: false,
  };
}
type View = ReturnType<typeof modeView>;
type ConnectionAction = 'checking' | 'connecting' | 'disconnecting';

export function createCreativeWorkbench(host: HTMLElement, bridge: NativeBridge) {
  // The two detached pages own their drafts (including FileList); only one is mounted.
  const views = { image: modeView('image'), video: modeView('video') };
  const modes = Object.values(views);
  const section = document.createElement('section');
  section.className = 'creative-connection';
  section.setAttribute('aria-labelledby', 'creative-connection-title');
  section.innerHTML = connectionMarkup;
  const service = find<HTMLFormElement>(section, 'form');
  const address = find<HTMLInputElement>(service, '[name="baseUrl"]');
  const key = find<HTMLInputElement>(service, '[name="apiKey"]');
  const connect = find<HTMLButtonElement>(service, '[type="submit"]');
  const disconnect = find<HTMLButtonElement>(service, '[data-action="creative-disconnect"]');
  const connectionNotice = find(service, '.creative-error');
  let connection: CreativeConnection | null = null;
  let phase: ConnectionAction | null = null;
  let ready = false, disposed = false, session = 0, pollTimer = 0, polling = false;
  const current = (version: number) => !disposed && version === session;
  const usable = () => ready && !phase && connection?.connected === true;

  function refreshSubmit(view: View) {
    view.submit.disabled = !usable() || view.submitting || !!referenceError(view.file.files);
    view.submit.textContent = view.submitting ? '正在提交…' : view.mode === 'image' ? '生成图片' : '生成视频';
  }
  function controls() {
    const locked = !ready || !!phase;
    address.disabled = key.disabled = connect.disabled = disconnect.disabled = locked;
    disconnect.hidden = !connection?.connected;
    connect.textContent = phase === 'connecting' ? '正在连接…' : connection?.connected ? '重新连接' : '连接并验证';
    disconnect.textContent = phase === 'disconnecting' ? '正在断开…' : '断开连接';
    const status = find(section, '.creative-connect-status');
    status.classList.toggle('connected', !!connection?.connected && !phase);
    status.textContent = !ready ? '请在 Muse-multiple 桌面应用中连接本机服务。' : phase ? { checking: '正在检查连接…', connecting: '正在验证连接…', disconnecting: '正在断开连接…' }[phase] : connection?.connected ? `已连接 · ${connection.baseUrl}` : '尚未连接';
    for (const view of modes) {
      view.prompt.disabled = view.aspect.disabled = view.file.disabled = view.remove.disabled = !ready;
      find(view.page, '.creative-disabled-note').hidden = !!connection?.connected;
      refreshSubmit(view);
      for (const job of view.jobs.values()) {
        const button = job.card.querySelector<HTMLButtonElement>('button');
        if (button) button.disabled = !usable() || job.save !== 'ready';
      }
    }
  }
  function count(view: View) {
    find(view.page, '.creative-active-count').textContent = `${[...view.jobs.values()].filter(job => inProgress(job.task, job.issue)).length} 项进行中`;
  }
  function draw(view: View, job: Job) {
    job.card.innerHTML = taskBody(job.task, job.prompt, job.index, job.issue);
    const button = job.card.querySelector<HTMLButtonElement>('button');
    if (button) button.disabled = !usable();
    count(view);
  }
  function schedule() {
    if (usable() && !pollTimer && !polling && modes.some(view => [...view.jobs.values()].some(job => inProgress(job.task, job.issue)))) {
      pollTimer = window.setTimeout(() => { void poll(); }, 2500);
    }
  }
  async function poll() {
    pollTimer = 0;
    polling = true;
    const version = session;
    await Promise.all(modes.flatMap(view => [...view.jobs.values()].filter(job => inProgress(job.task, job.issue)).map(async job => {
      try {
        const task = await bridge.creativeTask(view.mode, job.task.id);
        if (!current(version)) return;
        if (task.mode !== view.mode || task.id !== job.task.id) throw { retryable: false, safeMessage: '服务返回的任务编号或类型不匹配。' };
        job.task = task;
        job.issue = undefined;
      } catch (error) {
        if (!current(version)) return;
        const attempts = (job.issue?.attempts ?? 0) + 1;
        const terminal = !!error && typeof error === 'object' && (('retryable' in error && error.retryable === false) || ('code' in error && error.code === 'creative_task_not_found'));
        job.issue = { attempts, state: terminal ? 'stopped' : attempts >= 3 ? 'paused' : 'retrying', message: safeError(error) };
      }
      draw(view, job);
    })));
    if (current(version)) { polling = false; schedule(); }
  }
  function clearSession() {
    session++;
    window.clearTimeout(pollTimer);
    pollTimer = 0;
    polling = false;
    for (const view of modes) {
      view.jobs.clear();
      view.results.innerHTML = emptyResults;
      view.submitting = false;
      find(view.page, '#creative-submit-error').textContent = '';
      count(view);
    }
  }
  async function changeConnection(action: ConnectionAction) {
    if (!ready || phase || disposed) return;
    if (action === 'connecting') {
      connectionNotice.textContent = connectionError(address.value.trim(), key.value.trim());
      if (connectionNotice.textContent) return;
    }
    if (action !== 'checking' && modes.some(view => view.jobs.size || view.submitting) && !window.confirm('清除当前服务的任务列表并停止跟踪？服务端已接受的任务不会取消。')) return;
    phase = action;
    window.clearTimeout(pollTimer);
    pollTimer = 0;
    connectionNotice.textContent = '';
    controls();
    try {
      let next: CreativeConnection;
      if (action === 'checking') next = await bridge.creativeStatus();
      else if (action === 'connecting') {
        const request = bridge.connectCreative(address.value.trim(), key.value.trim());
        key.value = '';
        next = await request;
      } else { await bridge.disconnectCreative(); next = { connected: false, baseUrl: null }; }
      if (disposed) return;
      clearSession(); // Even the same address with a new key is a new task namespace.
      connection = next;
      if (next.baseUrl) address.value = next.baseUrl;
      key.value = '';
      find<HTMLDetailsElement>(section, 'details').open = !next.connected;
    } catch (error) {
      if (disposed) return;
      connection ??= { connected: false, baseUrl: null };
      connectionNotice.textContent = safeError(error);
      find<HTMLDetailsElement>(section, 'details').open = true;
    } finally {
      phase = null;
      if (!disposed) { controls(); schedule(); }
    }
  }
  async function generate(view: View) {
    if (!host.contains(view.page) || !usable() || view.submitting) return;
    const fileProblem = referenceError(view.file.files);
    const fileError = find(view.page, '#creative-file-error');
    fileError.textContent = fileProblem;
    const error = find(view.page, '#creative-submit-error');
    const prompt = view.prompt.value.trim(), aspect = view.aspect.value;
    const promptProblem = generationError(view.mode, prompt, aspect);
    error.textContent = promptProblem;
    view.file.setAttribute('aria-invalid', String(!!fileProblem));
    view.prompt.setAttribute('aria-invalid', String(!!promptProblem));
    if (fileProblem) { view.file.focus(); return; }
    if (promptProblem) { view.prompt.focus(); return; }

    const version = session;
    view.submitting = true;
    refreshSubmit(view);
    try {
      const file = view.file.files?.[0];
      const reference: [] | [string] = file ? [await readReference(file)] : [];
      if (!current(version)) return;
      if (!usable()) throw { safeMessage: '服务连接正在更改，本次任务未提交。' };
      const task = view.mode === 'image' ? await bridge.generateImage(prompt, aspect, ...reference) : await bridge.generateVideo(prompt, aspect, ...reference);
      if (!current(version)) return;
      if (task.mode !== view.mode) throw { safeMessage: '服务返回的任务类型不匹配。' };
      if (!view.jobs.has(task.id)) {
        const card = document.createElement('article');
        card.className = 'creative-task';
        card.dataset.taskId = task.id;
        const job: Job = { task, prompt, card, index: view.jobs.size + 1, save: 'ready' };
        view.jobs.set(task.id, job);
        view.results.querySelector('.creative-empty')?.remove();
        view.results.prepend(card);
        draw(view, job);
      }
    } catch (reason) { if (current(version)) error.textContent = safeError(reason); }
    finally { if (current(version)) { view.submitting = false; refreshSubmit(view); schedule(); } }
  }
  async function save(job: Job, button: HTMLButtonElement) {
    if (job.task.status !== 'completed' || job.save !== 'ready' || !usable()) return;
    const version = session, feedback = find(job.card, '.creative-save-status');
    job.save = 'saving';
    button.disabled = true;
    feedback.textContent = '正在保存到下载目录…';
    try {
      const name = await bridge.saveCreativeResult(job.task.mode, job.task.id);
      if (!current(version)) return;
      job.save = 'saved';
      feedback.textContent = `已保存到下载目录：${name}`;
      button.textContent = '已保存';
    } catch (error) {
      if (!current(version)) return;
      job.save = 'ready';
      button.disabled = !usable();
      feedback.textContent = `保存失败：${safeError(error)}`;
    }
  }
  for (const view of modes) {
    const fileChanged = () => {
      const problem = referenceError(view.file.files), file = view.file.files?.[0];
      find(view.page, '#creative-file-error').textContent = problem;
      view.file.setAttribute('aria-invalid', String(!!problem));
      find(view.page, '.creative-reference-name').textContent = file ? `已选择：${file.name.replace(/^.*[\\/]/, '')}` : '';
      view.remove.hidden = !file;
      refreshSubmit(view);
    };
    view.file.onchange = fileChanged;
    view.remove.onclick = () => { view.file.value = ''; fileChanged(); view.file.focus(); };
    view.form.onsubmit = event => { event.preventDefault(); void generate(view); };
    view.results.onclick = event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      const job = button && view.jobs.get(button.closest<HTMLElement>('.creative-task')!.dataset.taskId!);
      if (!button || button.disabled || !job || !usable()) return;
      if (button.dataset.action === 'creative-save') void save(job, button);
      else if (job.issue?.state === 'paused') { job.issue = undefined; draw(view, job); schedule(); }
    };
  }
  service.onsubmit = event => { event.preventDefault(); void changeConnection('connecting'); };
  disconnect.onclick = () => { if (connection?.connected) void changeConnection('disconnecting'); };

  return {
    show(mode: CreativeMode | null, nativeReady: boolean) {
      ready = nativeReady;
      if (!mode) { host.querySelector('.creative-page')?.remove(); return; }
      const view = views[mode];
      if (host.firstElementChild !== view.page) {
        find(view.page, '.creative-connection-slot').append(section);
        host.replaceChildren(view.page);
        controls();
      }
      if (ready && !connection && !phase) void changeConnection('checking');
    },
    dispose() {
      disposed = true;
      ready = false;
      clearSession();
      key.value = '';
      for (const view of modes) { view.form.reset(); view.page.remove(); }
    },
  };
}
