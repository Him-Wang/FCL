// 从会话 jsonl 中提取用户消息（prompt），用于生成交付文档
const fs = require('fs');

const src = process.argv[2];
const out = process.argv[3];

const lines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean);
const prompts = [];

for (const line of lines) {
  let obj;
  try { obj = JSON.parse(line); } catch (e) { continue; }
  if (obj.type !== 'message' || obj.role !== 'user') continue;
  const c = obj.content;
  let text = '';
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    text = c.filter((p) => p && p.type === 'input_text' && p.text).map((p) => p.text).join('\n');
  }
  if (!text) continue;
  // 去掉系统注入块，只保留 <user_query> 正文
  text = text.replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\[SYSTEM NOTIFICATION[\s\S]*?\n/g, '');
  const m = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (m) text = m[1];
  text = text.trim();
  if (!text) continue;
  prompts.push({ ts: obj.timestamp, text });
}

fs.writeFileSync(out, prompts.map((p, i) => `[${i + 1}] ${p.ts || ''}\n${p.text}`).join('\n\n'), 'utf8');
console.log('extracted ' + prompts.length + ' user messages -> ' + out);
