import type { TabDto, WorkspaceSnapshot } from '../../contracts/workspace';
import { emptyState, escapeHtml as esc, icon } from '../ui/markup';
import { accountNewWindowDiagnostic } from './workspace-state';

export function accountRequestNotice(snapshot: WorkspaceSnapshot | null, accountId: string | null): string {
  const diagnostic = accountNewWindowDiagnostic(snapshot, accountId);
  if (!diagnostic) return '';
  const account = snapshot!.accounts.find(item => item.id === accountId)!;
  return `<strong>账号「${esc(account.name)}」的新标签请求受限</strong><p><code>${esc(diagnostic.code)} #${esc(diagnostic.id)}</code> · ${esc(diagnostic.safeMessage)}</p><p>可能涉及连接第三方应用的外部授权或普通外链；未判断为授权请求，也不代表原页登录失败。</p><p>最近一次受限请求的历史记录，不代表当前登录或连接结果；标签关闭不代表连接成功。请以 Muse 原页显示的结果为准。</p>`;
}

export function tabLabel(tab: TabDto): string {
  const title = tab.title || (tab.loadState === 'loading' ? '正在加载…' : '未命名网页');
  return tab.purpose === 'authentication' ? `${title} · 外部授权` : title;
}

export function browserEmptyState(hasTabs: boolean, ready: boolean): string {
  return `${emptyState(hasTabs ? '选择一个标签继续' : '这里还没有网页标签', hasTabs ? '点击上方标签切换；网页由原生运行时呈现。' : '最后一个标签已关闭时保持空态。新建标签不会更改账号资料。')}<p class="test-site-note">Muse 登录：电话/邮箱 → 验证码 → 可选两步验证，均在该账号原标签完成。<br>连接第三方应用会使用外部授权新标签；外部授权或普通外链的新窗口请求当前仍受限。<br>授权完成后的预期是授权标签自动关闭，由 Muse 原页显示连接结果；标签消失不代表连接成功。</p><div class="slot-actions"><button class="primary" data-action="open-muse" ${ready ? '' : 'disabled'}>${icon('plus')}打开 Muse</button><button class="secondary" data-action="test-parent" ${ready ? '' : 'disabled'}>测试父页 :4317</button><button class="secondary" data-action="test-auth" ${ready ? '' : 'disabled'}>认证端 :4318</button></div><p class="test-site-note">合成站点需先在项目根目录启动 <code>npm --prefix app run test:sites:start</code><br>仅通过原生 HTTP 导航打开，不授予本地文件或系统权限。这里不模拟 Muse 网页。</p>`;
}
