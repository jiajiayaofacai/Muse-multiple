// 无依赖的原型状态测试。DOM 交互与排版另在浏览器中检查。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boot(storedValue = null) {
  const nodes = new Map();
  const values = new Map(storedValue === null ? [] : [['muse-multiple.prototype.v1', storedValue]]);
  const intervals = [];
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', hidden: false, value: '', style: { setProperty() {} },
      classList: { toggle() {} }, setAttribute() {}, addEventListener() {},
      focus() {}, select() {}, close() {}, showModal() {},
      getBoundingClientRect: () => ({ height: 220 }), scrollTop: 0
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node, documentElement: { dataset: {}, style: { setProperty() {} } }, addEventListener() {} },
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '220px' }),
    setTimeout() {}, clearTimeout() {}, setInterval: (callback) => intervals.push(callback),
    innerWidth: 1280, crypto: { randomUUID: () => 'test-uuid' }, URL, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context);
  return { run: (code) => vm.runInContext(code, context), node, values, intervals };
}
let passed = 0;
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }
const app = boot();
check('启动首页，默认休眠15分钟，尚未创建页面', () => {
  assert.equal(app.run('view'), 'home');
  assert.equal(app.run('settings.sleep'), '15');
  assert.equal(app.run('accounts.every(a => a.tabs.length === 0)'), true);
  assert.match(app.run('renderDashboard()'), /<h1>仪表盘<\/h1>/);
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<span>仪表盘<\/span>/);
  assert.match(html, /href="https:\/\/github.com\/jiajiayaofacai\/Muse-multiple" target="_blank" rel="noopener noreferrer"/);
});
check('Dashboard 只展示概况，不预加载账号或自动打开控制台', () => {
  app.run("navigate('dashboard')");
  assert.equal(app.run('dashboardStats().total'), 3);
  assert.equal(app.run('dashboardStats().tabs'), 0);
  assert.equal(app.run('dashboardStats().loaded'), 0);
  assert.equal(app.run('dashboardStats().sleeping'), 1);
  assert.equal(app.node('#console').hidden, true);
  assert.match(app.node('#view').innerHTML, /账号与页面状态/);
});
check('控制台独立开关，跨首页、Dashboard、账号页保持状态', () => {
  app.run('consoleOpen = true; renderConsole()');
  assert.equal(app.node('#console').hidden, false);
  app.run("navigate('home')");
  assert.equal(app.node('#console').hidden, false);
  app.run("navigate('dashboard')");
  assert.equal(app.node('#console').hidden, false);
  app.run("navigate('account', 'demo-work')");
  assert.equal(app.node('#console').hidden, false);
  app.run('consoleOpen = false; renderConsole()');
  assert.equal(app.node('#console').hidden, true);
});
check('A/B 标签分离，切回恢复认证标签', () => {
  app.run("navigate('account','demo-work'); openTab('auth');");
  const tab = app.run('current().activeTab');
  assert.equal(app.node('#console').hidden, true);
  app.run("navigate('account','demo-ideas')");
  assert.equal(app.run('current().tabs.length'), 1);
  app.run("navigate('account','demo-work')");
  assert.equal(app.run('current().activeTab'), tab);
  assert.equal(app.run('isProtected(current())'), true);
});
check('认证和草稿阻止自动休眠，超时普通后台页回收', () => {
  app.run("navigate('home'); accounts.find(a=>a.id==='demo-work').leftAt=Date.now()-16*60000; accounts.find(a=>a.id==='demo-ideas').leftAt=Date.now()-16*60000;");
  app.intervals[0]();
  assert.equal(app.run("accounts.find(a=>a.id==='demo-work').sleeping"), false);
  assert.equal(app.run("accounts.find(a=>a.id==='demo-ideas').sleeping"), true);
  app.run("navigate('account','demo-work'); closeTab(current().activeTab); selectedTab().draft='未发送'; navigate('home'); accounts.find(a=>a.id==='demo-work').leftAt=Date.now()-16*60000;");
  app.intervals[0]();
  assert.equal(app.run("accounts.find(a=>a.id==='demo-work').sleeping"), false);
});
check('唤醒重建页面，初始Muse标签也可关闭', () => {
  app.run("navigate('account','demo-ideas'); closeTab('main');");
  assert.equal(app.run('current().sleeping'), false);
  assert.equal(app.run('current().tabs.length'), 0);
  assert.equal(app.run('current().activeTab'), null);
  assert.match(app.node('#view').innerHTML, /标签已全部关闭/);
});
check('空标签状态重绘和切换账号后不会复活已关闭页面', () => {
  app.run("render(); navigate('account','demo-work'); navigate('account','demo-ideas');");
  assert.equal(app.run('current().tabs.length'), 0);
  assert.equal(app.run('accounts.length'), 3);
  app.run('reloadAccount(current())');
  assert.equal(app.run('current().tabs.length'), 0);
});
check('连续新建标签各有唯一ID，空态可重新打开Muse', () => {
  app.run("openTab('blank'); openTab('blank'); openTab('blank');");
  assert.equal(app.run('current().tabs.length'), 3);
  assert.equal(app.run('new Set(current().tabs.map(t=>t.id)).size'), 3);
  app.run('openMuse()');
  assert.equal(app.run('selectedTab().kind'), 'main');
});
check('多个Muse标签的草稿互不覆盖', () => {
  app.run("selectedTab().draft='第一份草稿'; openTab('blank'); openMuse();");
  assert.equal(app.run('selectedTab().draft'), '');
  app.run("selectedTab().draft='第二份草稿'");
  assert.equal(app.run("current().tabs.filter(t=>t.draft).length"), 2);
});
check('文章关闭返回来源标签，保留来源草稿', () => {
  const source = app.run('current().activeTab');
  app.run("openTab('article'); closeTab(current().activeTab)");
  assert.equal(app.run('current().activeTab'), source);
  assert.equal(app.run('selectedTab().draft'), '第二份草稿');
});
check('地址允许http/https及空白页，拒绝脚本/文件/凭据地址', () => {
  assert.equal(app.run("parseAddress('example.com/path').url"), 'https://example.com/path');
  assert.equal(app.run("parseAddress('about:blank').page"), 'blank');
  for (const value of ['', 'javascript:alert(1)', 'data:text/html,test', 'file:///C:/secret', 'https://user:pass@example.com']) {
    assert.equal(app.run(`parseAddress(${JSON.stringify(value)})`), null);
  }
});
check('导航历史恢复地址与标签标题', () => {
  app.run("openTab('blank'); navigateTab(selectedTab(),'web','https://example.com/one'); navigateTab(selectedTab(),'web','https://example.org/two'); selectedTab().position--; syncTab(selectedTab());");
  assert.equal(app.run('selectedTab().url'), 'https://example.com/one');
  assert.equal(app.run('selectedTab().title'), 'example.com');
  app.run('selectedTab().position++; syncTab(selectedTab())');
  assert.equal(app.run('selectedTab().url'), 'https://example.org/two');
});
check('关闭认证来源后完成认证，不报错、不复活来源', () => {
  const auth = boot();
  auth.run("navigate('account','demo-spare'); openTab('auth'); closeTab('main'); completeAuth();");
  assert.equal(auth.run('current().ready'), true);
  assert.equal(auth.run('current().tabs.length'), 0);
  auth.run('openMuse()');
  assert.equal(auth.run('selectedTab().history[selectedTab().position].page'), 'chat');
});
check('Dashboard 数量随标签新建关闭变化', () => {
  const before = app.run('dashboardStats().tabs');
  app.run("openTab('blank')");
  assert.equal(app.run('dashboardStats().tabs'), before + 1);
  app.run('closeTab(current().activeTab)');
  assert.equal(app.run('dashboardStats().tabs'), before);
});
check('只保存元数据和设置，不保存草稿、消息、网址、认证状态', () => {
  app.run("selectedTab().message='不应落盘'; openTab('auth'); save();");
  const value = app.values.get('muse-multiple.prototype.v1');
  for (const text of ['不应落盘', '第一份草稿', '第二份草稿', 'auth.muse.ai', 'example.org']) assert.equal(value.includes(text), false);
  assert.deepEqual(Object.keys(JSON.parse(value).accounts[0]).sort(), ['id', 'name', 'note', 'tone', 'usedAt']);
});
check('重新加载仍进首页，不恢复认证标签', () => {
  const second = boot(app.values.get('muse-multiple.prototype.v1'));
  assert.equal(second.run('view'), 'home');
  assert.equal(second.run('accounts.every(a=>a.tabs.length===0)'), true);
});
check('名称中的HTML作为文字呈现', () => {
  assert.equal(app.run("esc('<img src=x onerror=alert(1)>')"), '&lt;img src=x onerror=alert(1)&gt;');
});
check('损坏本地记录可恢复为示例数据', () => {
  const broken = boot('{broken');
  assert.equal(broken.run('accounts.length'), 3);
  assert.equal(broken.run('view'), 'home');
});
console.log(`\n${passed} prototype state checks passed. No real session or WebView tested.`);
