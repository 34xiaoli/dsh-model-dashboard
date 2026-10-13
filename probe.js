'use strict';
/**
 * 连通性 / 速度探测脚本  v2（并发控制已修正）
 * 输出: probe-results.json  (字段: id, name, status, ttfb_ms, total_ms, rate, ok, err)
 *
 * 用法:
 *   node probe.js              全量扫描（215 个模型，最小请求 max_tokens=1）
 *   node probe.js --limit 20   只扫前 20 个（冒烟）
 */
const http = require('http');
const https = require('https');
const fs = require('fs');

const GATEWAY = '127.0.0.1:8326';
const KEY = fs.readFileSync(require('path').join(require('os').homedir(), '.dsh', 'openai-gateway', 'api-key'), 'utf8').trim();
if (!KEY) { console.error('未找到密钥文件'); process.exit(1); }

const TIMEOUT_MS = 12000;
const CONCURRENCY = 8;
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const raw = JSON.parse(fs.readFileSync('chan-models.json', 'utf8'));
const all = raw.data || [];
const isFree = (m) => m.owned_by === 'cline'
  ? (/免费|Free now|限时免费|· 免费|^Free$/i.test(m.name || '') || /cline-free/.test(m.id || ''))
  : true;
const models = all.filter(isFree).map(m => ({ id: m.id, name: m.name || m.id }));
const targets = LIMIT === Infinity ? models : models.slice(0, LIMIT);

function req(model) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const payload = JSON.stringify({
      model: model.id,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1, temperature: 0, stream: false
    });
    const r = http.request({
      host: '127.0.0.1', port: 8326, path: '/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
        'Connection': 'keep-alive'
      },
      timeout: TIMEOUT_MS
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let ok = false, n = 0;
        if (res.statusCode === 200 && body) {
          try {
            const j = JSON.parse(body);
            const msg = j.choices && j.choices[0] && j.choices[0].message;
            if (msg && typeof msg.content === 'string') {
              ok = true; // HTTP 200 且 body 可解析即视为连通；思考模型 max_tokens=1 时正文可能为空但仍是 200
              n = msg.content.length;
            }
          } catch (e) {}
        }
        const total = Date.now() - t0;
        resolve({ id: model.id, name: model.name, status: res.statusCode, ttfb_ms: total, total_ms: total, ok, n, rate: n > 0 ? +(n / (total / 1000)).toFixed(1) : 0, err: null });
      });
    });
    r.on('timeout', () => { r.destroy(); resolve({ id: model.id, name: model.name, status: null, ttfb_ms: Date.now() - t0, total_ms: Date.now() - t0, ok: false, n: 0, rate: 0, err: 'timeout' }); });
    r.on('error', (e) => { resolve({ id: model.id, name: model.name, status: null, ttfb_ms: null, total_ms: Date.now() - t0, ok: false, n: 0, rate: 0, err: e.code || e.message }); });
    r.write(payload); r.end();
  });
}

// 通用并发池
async function mapLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

(async () => {
  const t0 = Date.now();
  console.log(`开始扫描 ${targets.length} 个模型，并发 ${CONCURRENCY}，超时 ${TIMEOUT_MS}ms...`);
  const results = await mapLimit(targets, CONCURRENCY, req);
  const ok = results.filter(r => r.status === 200 && r.ok);
  const err = results.filter(r => r.status !== 200 || !r.ok);
  console.log(`\n完成：${results.length} 个，可用 ${ok.length}，异常 ${err.length}，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (err.length) console.log('  异常状态分布:', JSON.stringify(err.reduce((a, r) => { const k = r.err ? 'ERR' : String(r.status); a[k] = (a[k] || 0) + 1; return a; }, {})));
  const sorted = ok.sort((a, b) => a.ttfb_ms - b.ttfb_ms);
  console.log('\n  TOP 10 最快（首字延迟）:');
  sorted.slice(0, 10).forEach(r => console.log(`   ${String(r.ttfb_ms).padStart(5)}ms  ${r.name.padEnd(28)} ${r.id}`));
  fs.writeFileSync('probe-results.json', JSON.stringify({ generated: new Date().toISOString(), gateway: GATEWAY, total: results.length, ok: ok.length, err: err.length, entries: results }, null, 2));
  console.log('\n已保存 probe-results.json');
})();
