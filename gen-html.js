'use strict';
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'chan-models.json'), 'utf8');
const data = JSON.parse(raw);
const models = data.data || [];

// ===== 网关密钥：生成时读取本地密钥文件，内嵌为默认值（仅本机使用，不外发） =====
// --publish 模式：不内嵌本机密钥（供 GitHub 发布版使用），页面引导使用者填自己的网关密钥
const PUBLISH = process.argv.includes('--publish');
let DEFAULT_KEY = '';
try {
  const keyFile = path.join(os.homedir(), '.dsh', 'openai-gateway', 'api-key');
  if (!PUBLISH && fs.existsSync(keyFile)) {
    DEFAULT_KEY = fs.readFileSync(keyFile, 'utf8').trim();
    console.log('loaded api-key from local file: ' + DEFAULT_KEY.length + ' chars');
  } else if (PUBLISH) {
    console.log('publish mode: api-key NOT embedded');
  }
} catch (e) { console.log('warn: cannot read api-key: ' + e.message); }

// ===== 权威调研补全的上下文数据 =====
let OVERRIDE = {};
const ovPath = path.join(__dirname, 'ctx-override.json');
if (fs.existsSync(ovPath)) {
  OVERRIDE = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
  console.log('loaded ctx-override.json: ' + Object.keys(OVERRIDE).length + ' rules');
}

const EFFORT_ORDER = ['none', 'off', 'disabled', 'low', 'balanced', 'medium', 'high', 'xhigh', 'max', 'deep', 'on'];
function effortRank(c) { const i = EFFORT_ORDER.indexOf(c); return i === -1 ? 5 : i; }

// ===== 连通性 / 速度实测快照（由 probe.js 生成，可为空）=====
let PROBE = null, PROBE_MAP = {};
const prPath = path.join(__dirname, 'probe-results.json');
if (fs.existsSync(prPath)) {
  PROBE = JSON.parse(fs.readFileSync(prPath, 'utf8'));
  for (const e of (PROBE.entries || [])) PROBE_MAP[e.id] = e;
  console.log('loaded probe-results.json: ' + PROBE.entries.length + ' entries @ ' + PROBE.generated);
}
// 实测结果归一化：连通=HTTP 200 且 body 可解析；未测=null
function probeOf(id) {
  const e = PROBE_MAP[id];
  if (!e) return { ok: null, status: null, ms: null, rate: null, gen: PROBE ? PROBE.generated : null };
  return { ok: !!(e.status === 200), status: e.status || null, ms: e.ttfb_ms || e.total_ms, rate: e.rate, gen: PROBE.generated };
}

// ===== 渠道大白话中文名 =====
const CH_ZH = {
  'our-free-model': '插件免费池（免密白嫖道）',
  'our-free-model-region': '免费池·地区受限',
  'lobsterai': '有道 LobsterAI（网易）',
  'workbuddy-ai': '腾讯 WorkBuddy·AI档',
  'workbuddy': '腾讯 WorkBuddy（白嫖主力）',
  'buddy': '腾讯 Buddy（同腾讯系）',
  'qoder': '阿里 Qoder（国际版积分）',
  'qodercn': '阿里 Qoder 中国版（积分）',
  'loomy': '讯飞 Loomy（讯飞星火系）',
  'codearts': '华为云 CodeArts（华为）',
  'trae': '字节 Trae（国内版）',
  'trae-global': '字节 Trae（国际版）',
  'raccoon': '商汤 Raccoon（SenseNova系）',
  'deepseek-account': 'DeepSeek·个人号额度',
  'deepseek-official': 'DeepSeek·官方API',
  'meituan': '美团 LongCat（美团）',
  'minimax': 'MiniMax 官方',
  'cline': 'Cline 编码工具（仅展示免费模型）',
  'sensenova': '商汤 SenseNova（官方直连）',
  'sensenova-2': '商汤 SenseNova-2（官方直连v2）',
  'internai': '蚂蚁 InternAI',
  'internai-2': '蚂蚁 InternAI-2',
  'catpaw': '猫手 CatPaw（本地代理）',
  'zcode': 'Z.ai ZCode（智谱官方）'
};

// ===== 权威家族档位（tier 3-6）=====
function modelTier(name, id) {
  const s = (name + ' ' + id).toLowerCase();
  if (/lite|nano|mini\b|small|xs\b|\b7b|\b8b|\b9b|12b|27b|31b|hy3|exo-free|lfm-2\.5|laguna-xs|north-mini/.test(s)) return 3;
  if (/opus|ultra|(^|[^a-z])max(?!.*flash)|astra|premier|ultimate|pro(?!.*view)|terra|sensenova-6-8(?!-lite)/.test(s) && !/lite|nano|mini|flash|haiku/.test(s)) return 6;
  if (/\bgpt-6|kimi.?k3|glm-5\.3(?!-flash)|deepseek-v4-pro|qwen3\.8-max|grok-4\.7|claude-(opus|sonnet)-5|claude-fable|gemini-3\.1-pro|qwen3\.7-max/.test(s)) return 6;
  if (/\bpro\b|-pro\b|sonnet|grok-4|gpt-5\.[56]|kimi-k2\.8|glm-5\.2|minimax-m3|nova-2|mistral-large|step-5|hy4/.test(s)) return 5;
  if (/flash(?!.*vision)|plus|standard|default|balanced|primary|qwen3\.7|glm-5\.1|kimi-k2\.[567]|deepseek-v4\.1|mimo-v2\.6|longcat|spark|gemini-3|glm-5v/.test(s)) return 4;
  return 4;
}

const TIER_BASE = { 3: 30, 4: 42, 5: 56, 6: 70 };

let rows = models.map(m => {
  const input = m.input || ['text'];
  const hasImage = input.includes('image');
  const hasAudio = input.includes('audio');
  const efforts = (m.reasoning && m.reasoning.efforts)
    ? m.reasoning.efforts.map(e => e.canonical || e.id) : [];

  // 倍率：仅匹配 "· x0.05" / 行首 x20 这类形式，避免误匹配单词里的 x
  let mult = null;
  const mm = (m.name || '').match(/(?:^|[\s·])x(\d+(?:\.\d+)?)(?![0-9a-z])/i);
  if (mm) mult = parseFloat(mm[1]);

  const free = /免费|Free now|限时免费|· 免费|^Free$/i.test(m.name || '') || m.id.includes('cline-free');
  // cline 渠道：只保留免费标记的模型，付费模型（消耗 Cline 订阅额度）不展示
  if (m.owned_by === 'cline' && !free) return null;

  // ===== 上下文：元数据 → 调研补全 =====
  let ctx = 0, ctxSrc = '网关元数据（/v1/models 官方声明）', ctxKind = 'none';
  if (m.description) {
    const mk = m.description.match(/([\d.]+)\s*K\s*context/i);
    const mM = m.description.match(/([\d.]+)\s*M\s*context/i);
    if (mk) { ctx = Math.round(parseFloat(mk[1]) * 1000); ctxKind = 'meta'; }
    else if (mM) { ctx = Math.round(parseFloat(mM[1]) * 1000000); ctxKind = 'meta'; }
  }
  let maxOut = 0;
  if (!ctx || ctx < 32000) {
    const idl = m.id.toLowerCase();
    const namel = (m.name || '').toLowerCase();
    for (const key of Object.keys(OVERRIDE)) {
      if (idl.includes(key) || namel.includes(key)) {
        const o = OVERRIDE[key];
        if (o.ctx && o.ctx > ctx) {
          ctx = o.ctx;
          ctxKind = (o.conf === '官方调研') ? 'official' : 'family';
          ctxSrc = (o.conf || '调研') + '：' + (o.src || '');
        }
        if (o.maxOut) maxOut = o.maxOut;
        break;
      }
    }
  }
  // 未声明上下文的模型：评分给中性值，避免因文档不可达被无端压到榜尾
  const ctxUnknown = !ctx;
  const ctxScore = ctxUnknown ? 6 : Math.min(14, ctx / 1000000 * 14);

  // ===== 评分（满分 100，保留 1 位小数）=====
  const tier = modelTier(m.name || '', m.id);
  let score = TIER_BASE[tier] || 42;          // 档位 30/42/56/70
  score += hasImage ? 6 : 0;                  // 图片 +6
  score += hasAudio ? 2 : 0;                  // 音频 +2
  score += ctxScore;                          // 上下文 ≤14
  score += efforts.length ? Math.min(8, efforts.length * 2) : 0;  // 推理 ≤8
  score = Math.round(Math.min(100, score) * 10) / 10;

  const maxEffort = efforts.reduce((a, b) => (effortRank(b) > effortRank(a) ? b : a), 'none');
  const pr = probeOf(m.id);
  return {
    id: m.id, ch: m.owned_by, chzh: CH_ZH[m.owned_by] || m.owned_by, n: m.name || m.id,
    img: hasImage ? 1 : 0, aud: hasAudio ? 1 : 0,
    ctx, ctxKind, ctxSrc, ctxUnknown: ctxUnknown ? 1 : 0, maxOut,
    ef: efforts, efN: efforts.length, efMax: maxEffort, def: (m.reasoning && m.reasoning.default) || '',
    mult, free: free ? 1 : 0, tier, score,
    probeOk: pr.ok === null ? null : (pr.ok ? 1 : 0),
    probeMs: pr.ms, probeRate: pr.rate, probeStatus: pr.status, probeGen: pr.gen
  };
});

rows = rows.filter(Boolean);

// 确定性全序：分数 → 上下文 → 最大输出 → 推理档位 → 档位 → id
function cmp(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.ctx !== a.ctx) return b.ctx - a.ctx;
  if (b.maxOut !== a.maxOut) return b.maxOut - a.maxOut;
  if (b.efN !== a.efN) return b.efN - a.efN;
  if (b.tier !== a.tier) return b.tier - a.tier;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
rows.sort(cmp);

// 各渠道模型数（按数量降序，供下拉框标注）
const chCount = {};
for (const r of rows) chCount[r.ch] = (chCount[r.ch] || 0) + 1;
const channels = Object.keys(chCount).sort((a, b) => chCount[b] - chCount[a]);

const statFam = rows.filter(r => r.ctxKind === 'family').length;
const statOff = rows.filter(r => r.ctxKind === 'official').length;
const statMeta = rows.filter(r => r.ctxKind === 'meta').length;
const statNone = rows.filter(r => r.ctxUnknown).length;
const statProbeOk = rows.filter(r => r.probeOk === 1).length;
const statProbeFail = rows.filter(r => r.probeOk === 0).length;
const statProbeNo = rows.filter(r => r.probeOk === null).length;
const PROBE_GEN = PROBE ? PROBE.generated.slice(0, 16).replace('T', ' ') + ' (UTC)' : '';
const PROBE_FASTEST = rows.filter(r => r.probeOk === 1).sort((a, b) => (a.probeMs || 0) - (b.probeMs || 0))[0] || null;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DATA_JSON = JSON.stringify(rows).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DSH Our Free Model 模型能力查询（${rows.length} 个）</title>
<style>
:root { --bg:#0f1419; --panel:#1a212b; --panel2:#232d3b; --panel3:#2b3646; --fg:#e6edf3; --dim:#8b98a9; --acc:#4da3ff; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --line:#2d3743; --hh:110px; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif; }
header { padding:14px 20px 12px; background:var(--panel); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:20; }
h1 { margin:0 0 4px; font-size:17px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
h1 .lnk { color:var(--acc); font-size:12px; font-weight:400; cursor:pointer; text-decoration:none; border:1px solid var(--line); border-radius:5px; padding:1px 7px; }
h1 .lnk:hover { background:var(--panel3); }
.sub { color:var(--dim); font-size:12px; }
.formula { margin-top:8px; padding:9px 11px; background:var(--panel2); border:1px solid var(--line); border-radius:6px; font-size:11.5px; color:var(--dim); display:none; line-height:1.7; }
.formula.show { display:block; }
.formula b { color:var(--fg); }
.filters { display:flex; flex-wrap:wrap; gap:8px; padding:10px 20px; background:var(--panel); border-bottom:1px solid var(--line); align-items:center; position:sticky; top:var(--hh); z-index:19; }
input[type=search], select { background:var(--panel2); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:7px 10px; font-size:13px; }
input[type=search] { flex:1; min-width:190px; }
input[type=search]:focus, select:focus { outline:1px solid var(--acc); }
label.chk { display:flex; align-items:center; gap:5px; font-size:13px; color:var(--dim); cursor:pointer; user-select:none; background:var(--panel2); border:1px solid var(--line); border-radius:6px; padding:7px 10px; white-space:nowrap; }
label.chk input { accent-color:var(--acc); }
.btn { background:var(--panel2); color:var(--dim); border:1px solid var(--line); border-radius:6px; padding:7px 11px; font-size:13px; cursor:pointer; white-space:nowrap; }
.btn:hover { color:var(--fg); border-color:var(--acc); }
.btn.pri { color:var(--acc); border-color:#2a4a70; }
button.mini { background:var(--panel2); color:var(--acc); border:1px solid var(--line); border-radius:5px; padding:3px 9px; font-size:11.5px; cursor:pointer; white-space:nowrap; }
button.mini:hover { background:var(--panel3); border-color:var(--acc); }
.presets { display:flex; gap:6px; align-items:center; padding:0 20px 10px; background:var(--panel); border-bottom:1px solid var(--line); flex-wrap:wrap; position:sticky; top:calc(var(--hh) + 46px); z-index:18; }
.presets .lbl { color:var(--dim); font-size:12px; margin-right:2px; }
.presets .btn { padding:4px 10px; font-size:12px; border-radius:14px; }
.stats { padding:9px 20px; color:var(--dim); font-size:12px; background:var(--bg); border-bottom:1px solid var(--line); }
.stats b { color:var(--acc); }
.stats .sep { color:var(--line); margin:0 6px; }
.tablewrap { margin:0 20px 30px; max-height:calc(100vh - var(--hh) - 176px); overflow:auto; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; }
th, td { padding:8px 10px; text-align:left; border-bottom:1px solid var(--line); white-space:nowrap; }
thead th { background:var(--panel3); position:sticky; top:0; z-index:3; cursor:pointer; user-select:none; font-size:12px; color:var(--dim); border-bottom:1px solid var(--line); }
thead th:hover { color:var(--fg); }
thead th.sorted { color:var(--acc); }
tbody tr:hover { background:#1e2733; }
tbody tr { cursor:copy; }
/* 关键防护：模型 ID / 名称列强制最小宽度，避免被挤压 */
th[data-k="id"], td.id { width:340px; min-width:300px; max-width:340px; }
th[data-k="name"], td.name { width:210px; min-width:170px; max-width:210px; }
th[data-k="efN"], td.effcell { min-width:150px; max-width:320px; }
td.id { font-family:Consolas,"Cascadia Mono",monospace; font-size:12px; color:var(--acc); }
td.id, td.name, td.effcell { overflow:hidden; text-overflow:ellipsis; }
td.ch { line-height:1.25; }
td.ch .en { color:var(--dim); font-size:11px; font-family:Consolas,monospace; }
td.ch .zh { font-size:12px; }
td.num { font-family:Consolas,monospace; text-align:right; font-variant-numeric:tabular-nums; }
.unknown { color:#6b7684; font-size:12px; }
.tag { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; white-space:nowrap; }
.tag.img { background:#1f3d2a; color:var(--ok); }
.tag.txt { background:#2d3138; color:var(--dim); }
.tag.free { background:#3d2f14; color:var(--warn); font-weight:600; }
.tag.aud { background:#2a2a3d; color:#a8a8ff; }
.tag.t6 { background:#3d1a2e; color:#ff9ee0; font-weight:700; }
.tag.t5 { background:#1f3d2a; color:var(--ok); }
.tag.t4 { background:#1f2d3d; color:var(--acc); }
.tag.t3 { background:#2d3138; color:var(--dim); }
.dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:4px; vertical-align:middle; }
.dot.meta { background:var(--ok); }
.dot.official { background:var(--acc); }
.dot.family { background:var(--warn); }
.dot.none { background:#5a6472; }
.ctxbar { display:inline-block; height:7px; background:var(--acc); border-radius:4px; vertical-align:middle; margin-right:6px; opacity:.65; }
.eff { color:var(--dim); font-size:11px; font-family:Consolas,monospace; }
.eff b { color:var(--fg); font-weight:700; }
.score { font-weight:700; color:var(--ok); font-variant-numeric:tabular-nums; }
.rank { color:var(--dim); font-size:12px; font-variant-numeric:tabular-nums; }
/* 实测列 */
.pdot { display:inline-block; width:16px; height:16px; line-height:16px; text-align:center; border-radius:50%; font-size:11px; font-weight:700; }
.pok { background:#0f3d24; color:#3fb950; }
.pbad { background:#3d1013; color:#f85149; }
.pno { background:#2a323c; color:#8b98a9; }
.pms { font-variant-numeric:tabular-nums; color:var(--ok); font-size:12px; }
td.probe { min-width:86px; }
.ok2 { color:var(--ok); } .bad2 { color:var(--bad); }
.mono { font-family:Consolas,monospace; font-size:11.5px; }
/* 实时测速 */
h1 .lnk.run { color:var(--warn); pointer-events:none; border-color:#4a3a12; }
.pprobe { animation:ppulse 1s linear infinite; }
@keyframes ppulse { 0%,100%{ opacity:.35; } 50%{ opacity:1; } }
#dlgkey { position:fixed; inset:0; background:rgba(6,10,16,.68); z-index:60; display:none; align-items:center; justify-content:center; padding:20px; }
.dlg { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px 20px 14px; width:min(480px, 92vw); box-shadow:0 14px 44px rgba(0,0,0,.55); }
.dlgtitle { font-size:15px; font-weight:700; margin-bottom:8px; }
.dlgtext { color:var(--dim); font-size:12.5px; line-height:1.7; margin-bottom:10px; }
.dlgtext b { color:var(--acc); }
#gwkey { width:100%; background:var(--panel2); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:9px 11px; font-size:13px; font-family:Consolas,monospace; }
#gwkey:focus { outline:1px solid var(--acc); }
.dlgerr { color:var(--bad); font-size:12px; min-height:16px; margin-top:6px; }
.dlgbtns { display:flex; gap:8px; justify-content:flex-end; margin-top:2px; }
.dlgfoot { color:var(--dim); font-size:11.5px; margin-top:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; }
.dlgfoot a { color:var(--acc); cursor:pointer; }
.dlgfoot a:hover { text-decoration:underline; }
.empty { padding:40px; text-align:center; color:var(--dim); }
#toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%) translateY(20px); background:#0b3d20; color:#d7ffe6; border:1px solid #1f7a45; padding:9px 16px; border-radius:8px; font-size:13px; opacity:0; pointer-events:none; transition:.22s; z-index:50; max-width:80vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
.legend { display:flex; gap:14px; flex-wrap:wrap; align-items:center; font-size:11.5px; color:var(--dim); margin-top:6px; }
/* 窄屏只隐藏次要列，模型 ID / 名称 / 实测永不隐藏 */
@media (max-width:980px){ th:nth-child(8), td:nth-child(8), th:nth-child(9), td:nth-child(9){ display:none; } }
@media (max-width:760px){ th:nth-child(6), td:nth-child(6), th:nth-child(11), td:nth-child(11){ display:none; } .tablewrap{ margin:0 8px 20px; } header,.filters,.presets,.stats{ padding-left:10px; padding-right:10px; } }
</style>
</head>
<body>
<header>
  <h1>DSH Our Free Model · 模型能力查询台
    <a class="lnk" id="liveBtn" title="浏览器直连渠道网关，对当前筛选命中的模型逐个发 1-token 最小请求，实测连通与速度">⚡ 实时测速</a>
    <a class="lnk" id="fbtn">评分公式?</a>
    <a class="lnk" id="exportBtn">导出 CSV</a>
  </h1>
  <div class="sub">渠道网关 8326 · <b>${rows.length}</b> 个可用模型（cline 仅保留免费档）· 数据源 chan-models.json 实测 + 权威调研补全 · 上下文/最大输出为纯数字 tokens<span id="probesnap"></span></div>
  <div class="formula" id="formula">
    <b>评分（满分 100，1 位小数）</b> = 家族档位（轻量 30 / 标准 42 / 高配 56 / 旗舰 70）
    + 图片输入 6 + 音频 2 + 上下文 ≤14（按 ctx/1,000,000×14 折算）+ 推理档位 ≤8（每档 2 分）<br>
    <b>排序为确定性全序</b>：分数 → 上下文 → 最大输出 → 推理档位数 → 档位 → 模型 ID，同分不会乱序<br>
    <b>未声明上下文的模型</b>给 6 分中性值（不因厂商文档不可达而被压到榜尾），列内仍显示"未声明"<br>
    <b>上下文来源</b>：<span class="dot meta"></span>网关元数据（官方声明）
    · <span class="dot official"></span>官方调研（厂商文档核实）
    · <span class="dot family"></span>家族参考（同家族标准值推定）
    · <span class="dot none"></span>未声明
  </div>
  <div class="legend">
    <span>💡 单击行可复制模型 ID · <kbd>/</kbd> 聚焦搜索 · <kbd>Esc</kbd> 清空筛选 · 设置会自动记住</span>
  </div>
</header>

<div class="filters">
  <input type="search" id="q" placeholder="🔍 搜模型名/ID/渠道，支持中文（如 讯飞、腾讯、kimi、glm、qoder）">
  <select id="fch"><option value="">全部渠道（${channels.length}）</option>${channels.map(c => `<option value="${esc(c)}">${esc(c)}（${esc(CH_ZH[c] || c)}）· ${chCount[c]}</option>`).join('')}</select>
  <select id="fctx">
    <option value="0">任意上下文</option>
    <option value="128000">≥ 128,000</option>
    <option value="256000">≥ 256,000</option>
    <option value="500000">≥ 500,000</option>
    <option value="1000000">≥ 1,000,000</option>
  </select>
  <select id="ftier">
    <option value="">任意档位</option>
    <option value="6">旗舰</option>
    <option value="5">高配及以上</option>
    <option value="4">标准及以上</option>
  </select>
  <select id="fef">
    <option value="">任意思考档位</option>
    <option value="1">支持思考</option>
    <option value="0">不支持思考</option>
    <option value="xhigh">最高 ≥ xhigh</option>
    <option value="max">最高 ≥ max</option>
  </select>
  <select id="fsrc" title="只显示特定来源的上下文数据（权威排行请选「仅官方」）">
    <option value="">任意上下文来源</option>
    <option value="official">仅官方（元数据+调研）</option>
    <option value="meta">仅网关元数据</option>
    <option value="family">仅家族参考（推定）</option>
    <option value="none">仅未声明</option>
  </select>
  <select id="fprobe" title="按连通性快照筛选：只挑实测能连通的模型">
    <option value="">实测：全部</option>
    <option value="ok">仅实测连通 ✓</option>
    <option value="fail">仅实测失败 ✗</option>
    <option value="no">仅未实测 ⏳</option>
  </select>
  <label class="chk"><input type="checkbox" id="fimg"> 仅图片输入</label>
  <label class="chk"><input type="checkbox" id="ffree"> 仅免费</label>
  <button class="btn" id="resetBtn">重置</button>
</div>

<div class="presets">
  <span class="lbl">快捷筛选：</span>
  <button class="btn" data-p="freeimg">免费 + 图片</button>
  <button class="btn" data-p="long">1M 上下文</button>
  <button class="btn" data-p="flag">旗舰档</button>
  <button class="btn" data-p="think">支持深度思考</button>
  <button class="btn" data-p="cheap">只看免费/低倍率</button>
  <button class="btn" data-p="live">仅实测连通 ✓</button>
  <button class="btn" data-p="freech">仅免费渠道</button>
</div>

<div class="stats" id="stats"></div>

<div class="tablewrap">
<table>
<thead><tr>
  <th data-k="score" class="sorted">能力分 ↓</th>
  <th data-k="id">模型 ID</th>
  <th data-k="n">名称</th>
  <th data-k="ch">渠道</th>
  <th data-k="tier">档位</th>
  <th data-k="img">输入</th>
  <th data-k="ctx">上下文（tokens）</th>
  <th data-k="maxOut">最大输出</th>
  <th data-k="mult">倍率</th>
  <th data-k="probeMs">实测</th>
  <th data-k="efN">思考档位</th>
  <th>操作</th>
</tr></thead>
<tbody id="tb"></tbody>
</table>
<div class="empty" id="empty" style="display:none">没有匹配的模型，试试放宽筛选条件</div>
</div>

<div id="dlgkey" role="dialog" aria-modal="true" aria-label="实时测速设置">
  <div class="dlg">
    <div class="dlgtitle">⚡ 实时测速</div>
    <div class="dlgtext">浏览器直连 <span class="mono" id="dlggw">…</span>，对 <b id="dlgN">0</b> 个模型各发 1 条 <span class="mono">max_tokens=1</span> 的最小请求（并发 6，单个 15 秒超时），实测连通与速度，结果就地更新并记入本机缓存。</div>
    <label class="chk" style="margin-bottom:8px; display:inline-flex;"><input type="checkbox" id="gwAllModels" checked> 全部模型（忽略筛选，含免费渠道）</label>
    <input type="password" id="gwkey" placeholder="粘贴渠道网关 API Key" autocomplete="off" spellcheck="false">
    <label class="chk" style="margin-top:8px; display:inline-flex;"><input type="checkbox" id="gwremember" checked> 记住密钥到本机 localStorage（仅此页使用，不外发）</label>
    <div class="dlgerr" id="dlgerr"></div>
    <div class="dlgbtns">
      <button class="btn" id="dlgcancel">取消</button>
      <button class="btn pri" id="dlgstart">开始测速</button>
    </div>
    <div class="dlgfoot"><span id="dlgfoot"></span><a id="dlgclear" style="display:none">清除已记密钥与测速缓存</a></div>
  </div>
</div>

<div id="toast"></div>

<script>
var DATA = ${DATA_JSON};
var DEFAULT_KEY = ${DEFAULT_KEY ? "'" + DEFAULT_KEY + "'" : "''"};
var TIER_TXT = { 6:'旗舰', 5:'高配', 4:'标准', 3:'轻量' };
var SRC_TXT = { meta:'网关元数据，官方声明', official:'官方调研，厂商文档核实', family:'家族参考，同家族标准值推定', none:'未声明' };
var EF_ORDER = ['none','off','disabled','low','balanced','medium','high','xhigh','max','deep','on'];
var sortKey = 'score', sortDesc = true;

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n){ return n ? n.toLocaleString('en-US') : ''; }
function maxEff(ef){ var m='none'; for (var i=0;i<ef.length;i++){ if (EF_ORDER.indexOf(ef[i]) > EF_ORDER.indexOf(m)) m = ef[i]; } return m; }
/* 固定对数标尺：条长跨筛选条件可比（0 → 4px，1M+ → 52px） */
function ctxBarWidth(ctx){
  if (!ctx) return 0;
  var w = Math.log10(ctx / 1000) / Math.log10(2000) * 52;
  return Math.max(4, Math.min(52, Math.round(w)));
}

function getState(){
  return {
    q: document.getElementById('q').value.trim().toLowerCase(),
    ch: document.getElementById('fch').value,
    minCtx: +document.getElementById('fctx').value,
    minTier: +document.getElementById('ftier').value,
    efMode: document.getElementById('fef').value,
    src: document.getElementById('fsrc').value,
    probe: document.getElementById('fprobe').value,
    img: document.getElementById('fimg').checked,
    free: document.getElementById('ffree').checked
  };
}

function pass(r, s){
  if (s.q && r.id.toLowerCase().indexOf(s.q) === -1 && r.n.toLowerCase().indexOf(s.q) === -1
      && r.ch.indexOf(s.q) === -1 && r.chzh.toLowerCase().indexOf(s.q) === -1) return false;
  if (s.ch && r.ch !== s.ch) return false;
  if (s.minCtx && r.ctx < s.minCtx) return false;
  if (s.minTier && r.tier < s.minTier) return false;
  if (s.efMode === '1' && !r.efN) return false;
  if (s.efMode === '0' && r.efN) return false;
  if (s.efMode === 'xhigh' && ['xhigh','max','deep'].indexOf(r.efMax) === -1) return false;
  if (s.efMode === 'max' && ['max','deep'].indexOf(r.efMax) === -1) return false;
  if (s.src === 'official' && r.ctxKind !== 'meta' && r.ctxKind !== 'official') return false;
  if (s.src === 'meta' && r.ctxKind !== 'meta') return false;
  if (s.src === 'family' && r.ctxKind !== 'family') return false;
  if (s.src === 'none' && !r.ctxUnknown) return false;
  if (s.probe === 'ok' && r.probeOk !== 1) return false;
  if (s.probe === 'fail' && r.probeOk !== 0) return false;
  if (s.probe === 'no' && r.probeOk !== null) return false;
  if (s.img && !r.img) return false;
  if (s.free && !(r.free || (r.mult !== null && r.mult <= 0.1))) return false;
  return true;
}

function compare(a, b){
  var va, vb;
  if (sortKey === 'efN'){ va = a.efN; vb = b.efN; }
  else { va = a[sortKey]; vb = b[sortKey]; }
  if (sortKey === 'ch'){ va = a.ch; vb = b.ch; }
  if (va === null || va === undefined) va = -1;
  if (vb === null || vb === undefined) vb = -1;
  var d;
  if (typeof va === 'string') d = va.localeCompare(vb);
  else d = va - vb;
  if (d === 0) d = a.ctx - b.ctx || a.efN - b.efN;
  return sortDesc ? -d : d;
}

function currentList(){
  var s = getState();
  var list = DATA.filter(function(r){ return pass(r, s); });
  list.sort(compare);
  return list;
}

function render(){
  var s = getState();
  var list = DATA.filter(function(r){ return pass(r, s); });
  list.sort(compare);

  document.getElementById('stats').innerHTML =
    '命中 <b>' + list.length + '</b> / ' + DATA.length + ' 个模型' +
    '<span class="sep">|</span>图片 <b>' + list.filter(function(r){return r.img;}).length + '</b>' +
    '<span class="sep">|</span>支持思考 <b>' + list.filter(function(r){return r.efN;}).length + '</b>' +
    '<span class="sep">|</span>免费标记 <b>' + list.filter(function(r){return r.free;}).length + '</b>' +
    '<span class="sep">|</span>上下文来源：官方 <b>' + list.filter(function(r){return r.ctxKind==='meta'||r.ctxKind==='official';}).length + '</b>' +
    ' · 推定 <b>' + list.filter(function(r){return r.ctxKind==='family';}).length + '</b>' +
    ' · 未声明 <b>' + list.filter(function(r){return r.ctxUnknown;}).length + '</b>' +
    '<span class="sep">|</span>实测 ✓ <b class="ok2">' + list.filter(function(r){return r.probeOk===1;}).length + '</b>' +
    ' ✗ <b class="bad2">' + list.filter(function(r){return r.probeOk===0;}).length + '</b>';

  var html = list.map(function(r, i){
    var ef = r.efN
      ? '<span class="eff">' + r.ef.map(function(e){ return e === r.efMax ? '<b>' + esc(e) + '</b>' : esc(e); }).join('→') + '</span>'
      : '<span class="unknown">无</span>';
    var ctxCell;
    if (r.ctx){
      ctxCell = '<span class="ctxbar" style="width:' + ctxBarWidth(r.ctx) + 'px"></span>' +
                '<span title="来源：' + esc(SRC_TXT[r.ctxKind] || '') + (r.ctxSrc && r.ctxKind !== 'meta' ? '｜' + esc(r.ctxSrc) : '') + '">' +
                fmt(r.ctx) + '</span>';
    } else {
      ctxCell = '<span class="unknown" title="厂商文档不可达，未获取到数值（评分按中性值计）">未声明</span>';
    }
    var mult = r.free ? '<span class="tag free">免费</span>' : (r.mult !== null ? '×' + r.mult : '—');
    var tierTag = '<span class="tag t' + r.tier + '">' + TIER_TXT[r.tier] + '</span>';
    var inputTag = (r.img ? '<span class="tag img">图片</span>' : '<span class="tag txt">文本</span>')
                  + (r.aud ? ' <span class="tag aud">音频</span>' : '');
    var probeCell = probeCellHtml(r);
    return '<tr data-id="' + esc(r.id) + '">' +
      '<td class="rank">' + (i + 1) + ' <span class="score">' + r.score.toFixed(1) + '</span></td>' +
      '<td class="id" title="' + esc(r.id) + '（单击复制）">' + esc(r.id) + '</td>' +
      '<td class="name" title="' + esc(r.n) + '">' + esc(r.n) + '</td>' +
      '<td class="ch" title="' + esc(r.ch) + '"><span class="en">' + esc(r.ch) + '</span><br><span class="zh">' + esc(r.chzh) + '</span></td>' +
      '<td>' + tierTag + '</td>' +
      '<td>' + inputTag + '</td>' +
      '<td class="num">' + ctxCell + '</td>' +
      '<td class="num">' + (r.maxOut ? fmt(r.maxOut) : '<span class="unknown">—</span>') + '</td>' +
      '<td>' + mult + '</td>' +
      '<td class="probe">' + probeCell + '</td>' +
      '<td class="effcell" title="' + esc(r.ef.join(' → ')) + '">' + ef + '</td>' +
      '<td><button class="mini" data-cfg="' + esc(r.id) + '" title="复制 Codex CLI 配置片段（含模型行与网关地址）">复制配置</button></td></tr>';
  }).join('');

  document.getElementById('tb').innerHTML = html;
  document.getElementById('empty').style.display = list.length ? 'none' : 'block';
  saveState();
}

/* ---- 复制模型 ID ---- */
var toastTimer = null;
function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 1600);
}
/* ---- 复制 Codex CLI 配置片段（拿去找模型/填进 config.toml） ---- */
function codexConfig(id){
  return '[model_providers.our-free-model]\\n' +
    'name = "our-free-model"\\n' +
    'base_url = "http://127.0.0.1:8326/v1"\\n' +
    'api_key = "替换为你的渠道网关 Key（设置页查看）"\\n' +
    'wire_api = "chat"\\n\\n' +
    '[model_selector]\\n' +
    'model = "' + id + '"\\n' +
    'model_provider = "our-free-model"';
}
document.getElementById('tb').addEventListener('click', function(e){
  var btn = e.target.closest('button[data-cfg]');
  if (btn){
    e.stopPropagation();
    var snippet = codexConfig(btn.getAttribute('data-cfg'));
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(snippet).then(function(){ toast('已复制 Codex 配置'); },
        function(){ fallbackCopy(snippet); });
    } else { fallbackCopy(snippet); }
    return;
  }
  var tr = e.target.closest('tr');
  if (!tr || !tr.dataset.id) return;
  var id = tr.dataset.id;
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(id).then(function(){ toast('已复制：' + id); },
      function(){ fallbackCopy(id); });
  } else { fallbackCopy(id); }
});
function fallbackCopy(text){
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('已复制：' + text); }
  catch (err) { toast('复制失败，请手动选择'); }
  document.body.removeChild(ta);
}

/* ---- 导出 CSV（当前筛选结果） ---- */
document.getElementById('exportBtn').addEventListener('click', function(){
  var list = currentList();
  var head = ['排名','能力分','模型ID','名称','渠道','渠道中文','档位','图片','音频','上下文tokens','上下文来源','最大输出','倍率','免费','思考档位','默认档位','实测ms','实测状态'];
  var lines = [head.join(',')];
  list.forEach(function(r, i){
    var srcTxt = r.ctxUnknown ? '未声明' : (r.ctxKind === 'meta' ? '网关元数据' : (r.ctxKind === 'official' ? '官方调研' : '家族参考'));
    var cells = [i + 1, r.score.toFixed(1), r.id, r.n, r.ch, r.chzh, TIER_TXT[r.tier],
      r.img ? '是' : '否', r.aud ? '是' : '否', r.ctx || '', srcTxt, r.maxOut || '',
      r.free ? '免费' : (r.mult !== null ? r.mult : ''), r.free ? '是' : '否', r.efMax, r.def,
      r.probeMs || '',
      (r.probeOk === null ? '' : (r.probeOk === 1 ? '连通 ' + (r.probeStatus || 200) : (r.probeStatus ? 'HTTP ' + r.probeStatus : '连接失败')))];
    lines.push(cells.map(function(c){
      var s = String(c);
      return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','));
  });
  var blob = new Blob(['\\ufeff' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'DSH模型清单_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('已导出 ' + list.length + ' 行 CSV');
});

/* ---- 表头排序 ---- */
Array.prototype.forEach.call(document.querySelectorAll('thead th'), function(th){
  th.addEventListener('click', function(){
    var k = th.dataset.k;
    if (!k) return; /* 「操作」列不可排序 */
    if (sortKey === k) sortDesc = !sortDesc; else { sortKey = k; sortDesc = true; }
    Array.prototype.forEach.call(document.querySelectorAll('thead th'), function(t){
      t.classList.remove('sorted');
      t.textContent = t.textContent.replace(/\\s*[↓↑]\\s*$/, '');
    });
    th.classList.add('sorted');
    th.textContent = th.textContent.replace(/\\s*[↓↑]\\s*$/, '') + (sortDesc ? ' ↓' : ' ↑');
    render();
  });
});

/* ---- 筛选事件 ---- */
['q','fch','fctx','ftier','fef','fsrc','fprobe','fimg','ffree'].forEach(function(id){
  var el = document.getElementById(id);
  el.addEventListener('input', render);
  el.addEventListener('change', render);
});

/* ---- 快捷筛选 ---- */
document.querySelector('.presets').addEventListener('click', function(e){
  var b = e.target.closest('button[data-p]');
  if (!b) return;
  resetFilters(true);
  var p = b.dataset.p;
  if (p === 'freeimg'){ document.getElementById('fimg').checked = true; document.getElementById('ffree').checked = true; }
  if (p === 'long'){ document.getElementById('fctx').value = '1000000'; }
  if (p === 'flag'){ document.getElementById('ftier').value = '6'; }
  if (p === 'think'){ document.getElementById('fef').value = 'xhigh'; }
  if (p === 'cheap'){ document.getElementById('ffree').checked = true; }
  if (p === 'live'){ document.getElementById('fprobe').value = 'ok'; }
  if (p === 'freech'){ document.getElementById('fch').value = 'our-free-model'; }
  render();
});

function resetFilters(keepQuiet){
  document.getElementById('q').value = '';
  document.getElementById('fch').value = '';
  document.getElementById('fctx').value = '0';
  document.getElementById('ftier').value = '';
  document.getElementById('fef').value = '';
  document.getElementById('fsrc').value = '';
  document.getElementById('fprobe').value = '';
  document.getElementById('fimg').checked = false;
  document.getElementById('ffree').checked = false;
  if (!keepQuiet) render();
}
document.getElementById('resetBtn').addEventListener('click', function(){ resetFilters(); });

/* ---- 公式折叠 ---- */
document.getElementById('fbtn').addEventListener('click', function(){
  document.getElementById('formula').classList.toggle('show');
  syncOffsets();
});

/* ---- 状态持久化 ---- */
var LS_KEY = 'dsh-model-table-v2';
function saveState(){
  try {
    var s = getState();
    s.sortKey = sortKey; s.sortDesc = sortDesc;
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch (e) {}
}
function loadState(){
  try {
    var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!s) return;
    if (s.q) document.getElementById('q').value = s.q;
    if (s.ch) document.getElementById('fch').value = s.ch;
    if (s.minCtx) document.getElementById('fctx').value = String(s.minCtx);
    if (s.minTier) document.getElementById('ftier').value = String(s.minTier);
    if (s.efMode) document.getElementById('fef').value = s.efMode;
    if (s.src) document.getElementById('fsrc').value = s.src;
    document.getElementById('fimg').checked = !!s.img;
    document.getElementById('ffree').checked = !!s.free;
    if (s.sortKey){ sortKey = s.sortKey; sortDesc = !!s.sortDesc; }
  } catch (e) {}
}

/* ---- 实时测速（浏览器直连网关；CORS 已由网关放行，file:// 或 ?gw= 均可直接用 fetch） ---- */
var GW = (function(){
  try {
    var p = new URLSearchParams(location.search).get('gw');
    if (p && p.slice(0, 4).toLowerCase() === 'http') return p.replace(/[/]+$/, '');
  } catch (e) {}
  return 'http://127.0.0.1:8326';
})();
var LS_GWKEY = 'dsh-model-table-gwkey';
var LS_PROBE = 'dsh-model-table-probe-v1';
var PROBE_GEN_LABEL = ${PROBE ? "'" + PROBE_GEN + "'" : "''"};
var probing = false;

function byId(id){
  for (var i = 0; i < DATA.length; i++) if (DATA[i].id === id) return DATA[i];
  return null;
}
function probeStats(){
  var ok = 0, fail = 0, no = 0, fast = null;
  for (var i = 0; i < DATA.length; i++){
    var r = DATA[i];
    if (r.probeOk === 1){ ok++; if (!fast || (r.probeMs || 1e9) < (fast.probeMs || 1e9)) fast = r; }
    else if (r.probeOk === 0) fail++;
    else no++;
  }
  return { ok: ok, fail: fail, no: no, fast: fast };
}
function refreshProbeSnap(mode, done, total, okN, failN){
  var el = document.getElementById('probesnap');
  if (!el) return;
  if (mode === 'run'){
    el.innerHTML = ' · 测速中 <b>' + done + '</b>/' + total + '：✓ <b class="ok2">' + okN + '</b> / ✗ <b class="bad2">' + failN + '</b>';
    return;
  }
  var s = probeStats();
  if (!s.ok && !s.fail){
    el.innerHTML = ' · 实测快照：无（点右上「⚡ 实时测速」可实测连通与速度）';
    return;
  }
  var fastTxt = s.fast ? ' · 最快 ' + esc(s.fast.n) + '（' + s.fast.probeMs + 'ms）' : '';
  el.innerHTML = ' · 实测快照 ' + (PROBE_GEN_LABEL || '（未生成）') + '：连通 <b class="ok2">' + s.ok + '</b> / 失败 <b class="bad2">' + s.fail + '</b> / 未测 ' + s.no + fastTxt;
}
function probeCellHtml(r){
  if (r._probeRun) return '<span class="pdot pno pprobe" title="测速中…">⏳</span>';
  if (r.probeOk === null) return '<span class="pdot pno" title="本次未实测">⏳</span>';
  if (r.probeOk === 1){
    var rateTxt = r.probeRate ? ' · ' + r.probeRate + ' 字/秒' : '';
    return '<span class="pdot pok" title="连通 · HTTP ' + (r.probeStatus || 200) + rateTxt + '">✓</span> <b class="pms">' + r.probeMs + 'ms</b>';
  }
  var st = r.probeStatus, hint = '';
  if (st === 401 || st === 403) hint = '（密钥无效？）';
  else if (st === 429) hint = '（限流）';
  else if (st === 402) hint = '（额度不足）';
  else if (st && st >= 500) hint = '（上游不可用）';
  return '<span class="pdot pbad" title="不可用 · ' + (st ? 'HTTP ' + st + hint : '连接失败') + '">✗</span>';
}
function paintProbe(r){
  var trs = document.querySelectorAll('#tb tr');
  for (var i = 0; i < trs.length; i++){
    if (trs[i].getAttribute('data-id') === r.id){
      var td = trs[i].querySelector('td.probe');
      if (td) td.innerHTML = probeCellHtml(r);
      return;
    }
  }
}
function getStoredKey(){ try { return localStorage.getItem(LS_GWKEY) || ''; } catch (e) { return ''; } }
function saveProbeCache(){
  try {
    var m = {};
    for (var i = 0; i < DATA.length; i++){
      var r = DATA[i];
      if (r.probeOk === null) continue;
      m[r.id] = { ok: r.probeOk, ms: r.probeMs, st: r.probeStatus, rate: r.probeRate };
    }
    localStorage.setItem(LS_PROBE, JSON.stringify({ gen: PROBE_GEN_LABEL, m: m }));
  } catch (e) {}
}
(function loadProbeCache(){
  try {
    var c = JSON.parse(localStorage.getItem(LS_PROBE) || 'null');
    if (c && c.m){
      for (var id in c.m){
        var r = byId(id);
        if (r){ r.probeOk = c.m[id].ok ? 1 : 0; r.probeMs = c.m[id].ms; r.probeStatus = c.m[id].st; r.probeRate = c.m[id].rate || null; r.probeGen = c.gen || 'cache'; }
      }
      if (c.gen) PROBE_GEN_LABEL = c.gen;
      refreshProbeSnap();
    }
  } catch (e) {}
})();

function probeOne(key, r){
  var t0 = performance.now();
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function(){ try { ctrl.abort(); } catch (e) {} }, 15000) : null;
  var settle = function(fn){
    if (timer) clearTimeout(timer);
    return fn(performance.now() - t0);
  };
  return fetch(GW + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: r.id, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, temperature: 0, stream: false }),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function(res){
    return res.json().catch(function(){ return null; }).then(function(body){
      return settle(function(ms){
        var ok = res.status === 200 && !!body && typeof body === 'object';
        var rate = null;
        if (ok && ms > 0){
          var ch = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
          if (typeof ch === 'string' && ch.length) rate = Math.round(ch.length / (ms / 1000));
        }
        return { ok: ok ? 1 : 0, st: res.status, ms: Math.round(ms), rate: rate };
      });
    });
  }).catch(function(){
    return settle(function(ms){ return { ok: 0, st: null, ms: Math.round(ms), rate: null }; });
  });
}

function startLiveProbe(key, allModels){
  if (probing) return;
  var s = getState();
  var targets = allModels ? DATA.slice() : DATA.filter(function(r){ return pass(r, s); });
  if (!targets.length){ toast('没有可测的模型，先放宽筛选'); return; }
  probing = true;
  var btn = document.getElementById('liveBtn');
  btn.classList.add('run');
  btn.textContent = '⏳ 测速中…';
  var total = targets.length, done = 0, okN = 0, failN = 0, idx = 0, CONC = 6;
  refreshProbeSnap('run', 0, total, 0, 0);
  function finish(){
    probing = false;
    btn.classList.remove('run');
    btn.textContent = '⚡ 实时测速';
    var d = new Date();
    PROBE_GEN_LABEL = '实时 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.toTimeString().slice(0, 5);
    refreshProbeSnap();
    saveProbeCache();
    render();
    toast('实时测速完成：连通 ' + okN + ' / 失败 ' + failN + '（结果已记入本机缓存）');
  }
  function next(){
    if (idx >= total) return;
    var r = targets[idx++];
    r._probeRun = 1;
    paintProbe(r);
    probeOne(key, r).then(function(res){
      r._probeRun = 0;
      r.probeOk = res.ok; r.probeStatus = res.st; r.probeMs = res.ms; r.probeRate = res.rate; r.probeGen = 'live';
      if (res.ok) okN++; else failN++;
      done++;
      paintProbe(r);
      refreshProbeSnap('run', done, total, okN, failN);
      if (done === total) finish(); else next();
    });
  }
  for (var i = 0; i < CONC; i++) next();
}

/* ---- 实时测速弹窗 ---- */
var dlgEl = document.getElementById('dlgkey');
function dlgIsOpen(){ return dlgEl.style.display === 'flex'; }
function openDlg(){
  var n = document.getElementById('gwAllModels').checked ? DATA.length : DATA.filter(function(r){ return pass(r, getState()); }).length;
  document.getElementById('dlgN').textContent = n;
  document.getElementById('dlggw').textContent = GW + '/v1/chat/completions';
  var stored = getStoredKey();
  document.getElementById('gwkey').value = stored || DEFAULT_KEY || '';
  document.getElementById('dlgerr').textContent = '';
  document.getElementById('dlgclear').style.display = stored ? 'inline' : 'none';
  var src = stored ? '已记住密钥' : (DEFAULT_KEY ? '已配置密钥（本机默认）' : '未配置密钥');
  document.getElementById('dlgfoot').textContent = stored
    ? '已记住密钥（' + stored.length + ' 位）· 留空直接点「开始测速」即可'
    : (DEFAULT_KEY
      ? '已使用本机默认密钥（' + DEFAULT_KEY.length + ' 位）· 点「开始测速」即可，勾选「记住」可持久化'
      : '密钥可在 DSH 设置页（渠道网关）复制；仅存本机 localStorage，不外发');
  dlgEl.style.display = 'flex';
  setTimeout(function(){ document.getElementById('gwkey').focus(); document.getElementById('gwkey').select(); }, 30);
}
function closeDlg(){ dlgEl.style.display = 'none'; }
function startFromDlg(){
  var k = document.getElementById('gwkey').value.trim() || getStoredKey() || DEFAULT_KEY;
  if (!k){ document.getElementById('dlgerr').textContent = '请先粘贴网关密钥（DSH 设置页可复制）'; return; }
  if (document.getElementById('gwremember').checked){ try { localStorage.setItem(LS_GWKEY, k); } catch (e) {} }
  else { try { localStorage.removeItem(LS_GWKEY); } catch (e) {} }
  var allModels = document.getElementById('gwAllModels').checked;
  closeDlg();
  startLiveProbe(k, allModels);
}
document.getElementById('liveBtn').addEventListener('click', openDlg);
document.getElementById('dlgcancel').addEventListener('click', closeDlg);
document.getElementById('dlgstart').addEventListener('click', startFromDlg);
document.getElementById('gwkey').addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); startFromDlg(); } });
document.getElementById('gwAllModels').addEventListener('change', function(){
  var n = document.getElementById('gwAllModels').checked ? DATA.length : DATA.filter(function(r){ return pass(r, getState()); }).length;
  document.getElementById('dlgN').textContent = n;
});
document.getElementById('dlgclear').addEventListener('click', function(){
  try { localStorage.removeItem(LS_GWKEY); localStorage.removeItem(LS_PROBE); } catch (e) {}
  toast('已清除本机记忆的密钥与测速缓存');
  closeDlg();
});
dlgEl.addEventListener('click', function(e){ if (e.target === dlgEl) closeDlg(); });
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && dlgIsOpen()) closeDlg(); }, true);

/* ---- 键盘快捷键 ---- */
document.addEventListener('keydown', function(e){
  var tag = (e.target.tagName || '').toLowerCase();
  var typing = tag === 'input' || tag === 'select' || tag === 'textarea';
  if (e.key === '/' && !typing){ e.preventDefault(); document.getElementById('q').focus(); }
  if (e.key === 'Escape'){ if (typing && e.target.value){ e.target.value = ''; render(); } else if (typing) { e.target.blur(); } }
});

/* ---- 吸顶偏移同步（修复表头与页头重叠） ---- */
function syncOffsets(){
  var h = document.querySelector('header').offsetHeight;
  document.documentElement.style.setProperty('--hh', h + 'px');
}
window.addEventListener('resize', syncOffsets);

loadState();
syncOffsets();
refreshProbeSnap();
render();
setTimeout(syncOffsets, 60);
</script>
</body>
</html>`;

const out = path.join(__dirname, 'DSH-模型能力查询台.html');
fs.writeFileSync(out, html, 'utf8');
const withCtx = rows.filter(r => r.ctx).length;
console.log('OK -> ' + out);
console.log('models: ' + rows.length + ', channels: ' + channels.length + ', size: ' + fs.statSync(out).size + ' bytes');
console.log('ctx: 元数据 ' + statMeta + ' / 官方调研 ' + statOff + ' / 家族参考 ' + statFam + ' / 未声明 ' + statNone);
console.log('free-marked: ' + rows.filter(r => r.free).length + ', image: ' + rows.filter(r => r.img).length);
console.log('probe(embedded snapshot): 连通 ' + statProbeOk + ' / 失败 ' + statProbeFail + ' / 未测 ' + statProbeNo + (PROBE_FASTEST ? ' / 最快 ' + PROBE_FASTEST.probeMs + 'ms' : ''));
