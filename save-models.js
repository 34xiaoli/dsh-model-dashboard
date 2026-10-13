const http = require('http');
const fs = require('fs');

const KEY = fs.readFileSync(require('path').join(require('os').homedir(), '.dsh', 'openai-gateway', 'api-key'), 'utf8').trim();
const done = [];
let allData = [];

const r = http.request({
  host: '127.0.0.1',
  port: 8326,
  path: '/v1/models',
  method: 'GET',
  headers: { 'Authorization': 'Bearer ' + KEY }
}, res => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const body = chunks.join('');
    const j = JSON.parse(body);
    const models = j.data || [];
    console.log('Fetched ' + models.length + ' models from gateway');
    
    // Save to chan-models.json
    fs.writeFileSync('chan-models.json', JSON.stringify({ data: models }, null, 0));
    console.log('Saved to chan-models.json');
    
    // Show channel distribution
    const ch = {};
    models.forEach(m => { ch[m.owned_by] = (ch[m.owned_by] || 0) + 1; });
    console.log('\nChannels:');
    Object.entries(ch).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k + ' = ' + v));
  });
});
r.end();