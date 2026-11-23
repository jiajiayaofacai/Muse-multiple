import { mountWorkspace } from './shell/workspace';
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('工作台容器不存在');
void mountWorkspace(root);
