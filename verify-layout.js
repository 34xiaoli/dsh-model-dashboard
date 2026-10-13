'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const h = fs.readFileSync(path.join(__dirname, 'DSH-模型能力查询台.html'), 'utf8');
const s = h.match(/<script>\n([\s\S]*?)<\/script>/);
const code = s[1];
let pass = 0, fail = 0;
function chk(name, ok) { console.log((ok ? '  ✓ ' : '  ✗ ') + name); ok ? pass++ : fail++; }

console.log('=== 布局修复验证（模型列不再消失）===');

// 1) 媒体查询不得隐藏第2/3列（模型ID/名称）
const medias = h.match(/@media[^{]+\{[^}]*\}/g) || [];
const hidesModelCol = medias.some(m => /nth-child\([23]\)/.test(m));
chk('媒体查询未隐藏模型 ID/名称列 (nth-child 2/3)', !hidesModelCol);
console.log('     媒体查询内容: ' + medias.map(m => m.replace(/\s+/g, ' ').slice(0, 78)).join(' | '));

// 2) ID / 名称列有最小宽度下限（禁止坍塌）
chk('模型 ID 列有 min-width 下限', /th\[data-k="id"\],\s*td\.id\s*\{[^}]*min-width:\s*\d+px/.test(h));
chk('名称列有 min-width 下限', /th\[data-k="name"\],\s*td\.name\s*\{[^}]*min-width:\s*\d+px/.test(h));
const idMin = (h.match(/th\[data-k="id"\],\s*td\.id\s*\{[^}]*min-width:(\d+)px/) || [])[1];
const nmMin = (h.match(/th\[data-k="name"\],\s*td\.name\s*\{[^}]*min-width:(\d+)px/) || [])[1];
console.log('     ID 列下限: ' + idMin + 'px | 名称列下限: ' + nmMin + 'px | 两者合计: ' + (+idMin + +nmMin) + 'px');

// 3) 思考档位列现在可压缩（吸收挤压，而非挤压模型列）
chk('思考档位列可压缩(有 max-width)', /td\.effcell\s*\{[^}]*max-width:\s*\d+px/.test(h));
chk('思考档位列有 min-width 地板', /td\.effcell\s*\{[^}]*min-width:\s*\d+px/.test(h));
chk('思考档位格带完整链路 tooltip', code.includes('class="effcell" title='));

// 4) 表格容器可横向滚动（列宽不足时滚动而非坍塌）
chk('tablewrap 可横向滚动 overflow:auto', /\.tablewrap\s*\{[^}]*overflow:\s*auto/.test(h));

// 5) 关键列在 DOM 中确实渲染（防止只渲染渠道列这类退化）
const heads = (h.match(/<th[^>]*>([^<]*)<\/th>/g) || []).map(x => x.replace(/<[^>]*>/g, '').trim());
console.log('     表头: ' + heads.join(' | '));
chk('表头含 模型 ID', heads.some(x => x.includes('模型 ID')));
chk('表头含 名称', heads.some(x => x === '名称'));
chk('表头含 渠道', heads.some(x => x === '渠道'));
chk('表头含 操作', heads.some(x => x === '操作'));
chk('表头共 12 列（含实测）', heads.length === 12);

// 6) 行渲染确实输出 id/name 单元格
chk('行模板输出 td.id', code.includes('<td class="id"'));
chk('行模板输出 td.name', code.includes('<td class="name"'));

// 7) 回归：其余功能未破坏
try { new vm.Script(code); chk('JS 语法通过', true); } catch (e) { chk('JS 语法: ' + e.message, false); }
chk('来源筛选 fsrc 仍在', h.includes('id="fsrc"'));
chk('复制配置按钮仍在', code.includes('data-cfg'));
chk('吸顶层单调 20>19>3', (() => {
  const a = h.match(/header\s*\{[^}]*z-index:(\d+)/), b = h.match(/\.filters\s*\{[^}]*z-index:(\d+)/), c = h.match(/thead th\s*\{[^}]*z-index:(\d+)/);
  return a && b && c && (+a[1] > +b[1] && +b[1] > +c[1]);
})());
const m = h.match(/var DATA = (\[.*?\]);\n/s);
const d = JSON.parse(m[1]);
chk('数据 >200 条', d.length > 200);

// 8) 最小可用宽度估算
const others = [60, 50, 90, 150, 80, 50, 320, 90]; // 能力分/档位/输入/上下文/最大输出/倍率/思考/操作
const sumMin = others.slice(0, 6).reduce((a, b) => a + b, 0) + 150 + 90 + (+idMin) + (+nmMin);
console.log('     表格最小宽度估算: ' + sumMin + 'px（低于此宽度则横向滚动，模型列始终可见）');
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
