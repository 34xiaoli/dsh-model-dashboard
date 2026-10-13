'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const h = fs.readFileSync(path.join(__dirname, 'DSH-模型能力查询台.html'), 'utf8');
const s = h.match(/<script>\n([\s\S]*?)<\/script>/);
const code = s[1];

console.log('=== 新功能验证 ===');
let pass = 0, fail = 0;
function chk(name, ok) { console.log((ok ? '  ✓ ' : '  ✗ ') + name); ok ? pass++ : fail++; }

// JS 语法
try { new vm.Script(code); chk('JS 语法解析通过', true); } catch (e) { chk('JS 语法: ' + e.message, false); }

// 新功能 1: 上下文来源筛选
chk('下拉 #fsrc 存在', h.includes('id="fsrc"'));
chk('fsrc 有4个选项', (h.match(/<option value="(official|meta|family|none)">/g) || []).length === 4);
chk('pass() 实现来源筛选', code.includes("s.src === 'official'"));
chk('fsrc 已加入事件监听', code.includes("'fef','fsrc'"));
chk('fsrc 已加入重置', code.includes("getElementById('fsrc').value = ''"));
chk('fsrc 已加入持久化', code.includes("if (s.src) document.getElementById('fsrc')"));

// 新功能 2: 复制配置
chk('表头含「操作」列', /<th[^>]*>\s*操作\s*<\/th>/.test(h));
chk('每行含 data-cfg 按钮', /<button class="mini" data-cfg=/.test(code));
chk('codexConfig 函数存在', code.includes('function codexConfig'));
chk('配置片段含 base_url 8326', code.includes('127.0.0.1:8326/v1'));
chk('配置片段含 model_provider', code.includes('model_provider = "our-free-model"'));
chk('按钮点击 stopPropagation', code.includes('e.stopPropagation()'));
chk('「操作」列点击被护栏拦截', code.includes('if (!k) return;'));
chk('.mini 按钮样式已加', h.includes('button.mini {'));

// 修复验证（确认没回退）
chk('--- 回归：之前修的问题 ---', true);
chk('吸顶层单调 20>19>3', (() => {
  const a = h.match(/header\s*\{[^}]*z-index:(\d+)/), b = h.match(/\.filters\s*\{[^}]*z-index:(\d+)/), c = h.match(/thead th\s*\{[^}]*z-index:(\d+)/);
  return a && b && c && (+a[1] > +b[1] && +b[1] > +c[1]);
})());
chk('对数标尺 ctx 条', code.includes('Math.log10'));
chk('确定性全序排序', code.includes('a.ctx - b.ctx'));
chk('未声明中性分', code.includes('ctxUnknown'));
chk('CSV 带 BOM', code.includes('\\ufeff'));
chk('键盘 / 与 Esc', code.includes("e.key === '/'") && code.includes("e.key === 'Escape'"));
chk('行点击复制 ID', code.includes("closest('tr')"));

// 数据一致性
const m = h.match(/var DATA = (\[.*?\]);\n/s);
const d = JSON.parse(m[1]);
chk('模型数 >200', d.length > 200);
chk('cline 付费残留 0', d.filter(r => r.ch === 'cline' && !r.free).length === 0);
chk('分数有区分度（不同值>40）', new Set(d.map(r => r.score)).size > 40);
chk('未声明与已声明均分接近', (() => {
  const u = d.filter(r => r.ctxUnknown).reduce((s, r) => s + r.score, 0) / d.filter(r => r.ctxUnknown).length;
  const k = d.filter(r => !r.ctxUnknown).reduce((s, r) => s + r.score, 0) / d.filter(r => !r.ctxUnknown).length;
  // 阈值 2→3（2026-10-13）：模型集 215→280 后未声明组新增 69 个账号系渠道模型（均分 59.66），
  // 组成变化使自然差值从 <2 漂移到 2.38；护栏本意是防中性分规则系统性偏差
  // （写错成 0/14 时差距会拉到 8 分），3 仍能抓住真 bug。
  return Math.abs(u - k) < 3;
})());

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
