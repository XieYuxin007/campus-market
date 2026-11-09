const path = require('path');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(path.join(__dirname, 'campus.db'));

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes }); });
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

async function initDatabase() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student')`);
  await dbRun(`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, description TEXT DEFAULT '', image_url TEXT DEFAULT '', seller_id INTEGER, seller_name TEXT, status TEXT NOT NULL DEFAULT '在售', created_at TEXT DEFAULT (datetime('now','localtime')))`);

  if (!await dbGet(`SELECT id FROM users WHERE username = 'admin'`)) {
    await dbRun(`INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'admin')`);
  }
  if (!await dbGet(`SELECT id FROM users WHERE username = 'student'`)) {
    await dbRun(`INSERT INTO users (username, password, role) VALUES ('student', '123456', 'student')`);
  }
  if ((await dbGet(`SELECT COUNT(*) AS c FROM items`)).c === 0) {
    const demo = [
      ['九成新 Kindle Paperwhite 4', 399, '自用一年，屏幕无划痕，带原装保护套，可校内面交。', 'https://images.unsplash.com/photo-1592434134753-a70baf7979d5?w=600'],
      ['罗技 M590 无线鼠标', 89, '静音款，手感很好，因为换了新鼠标闲置，配件齐全。', 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=600']
    ];
    for (const [title, price, desc, img] of demo) {
      await dbRun(`INSERT INTO items (title, price, description, image_url, seller_id, seller_name, status) VALUES (?,?,?,?,?,?, '在售')`, [title, price, desc, img, 2, 'student']);
    }
  }
  console.log('✅ 数据库初始化完成');
}

function mockDescription(title) {
  const t = (title || '这件闲置好物').trim();
  return `【${t}】自用闲置，成色九成新，功能完好无暗病，一直精心爱护。现低价转让给需要的同学，校内可面交验货，价格可小刀，有意私聊～`;
}

app.post('/api/register', async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  if (await dbGet(`SELECT id FROM users WHERE username = ?`, [username])) return res.status(400).json({ success: false, message: '该用户名已被注册' });
  const result = await dbRun(`INSERT INTO users (username, password, role) VALUES (?,?,?)`, [username, password, role === 'admin' ? 'admin' : 'student']);
  res.json({ success: true, user: { id: result.lastID, username, role } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await dbGet(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password]);
  if (!user) return res.status(401).json({ success: false, message: '用户名或密码错误' });
  res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/items', async (req, res) => {
  const rows = await dbAll(`SELECT * FROM items ORDER BY id DESC`);
  res.json({ success: true, data: rows });
});

app.post('/api/items', async (req, res) => {
  const { title, price, description, image_url, seller_id, seller_name } = req.body || {};
  const result = await dbRun(`INSERT INTO items (title, price, description, image_url, seller_id, seller_name, status) VALUES (?,?,?,?,?,?, '在售')`, [title, Number(price), description || '', image_url || '', seller_id, seller_name]);
  const item = await dbGet(`SELECT * FROM items WHERE id = ?`, [result.lastID]);
  res.json({ success: true, data: item });
});

app.post('/api/items/:id/buy', async (req, res) => {
  const item = await dbGet(`SELECT * FROM items WHERE id = ?`, [req.params.id]);
  if (!item) return res.status(404).json({ success: false, message: '商品不存在' });
  if (item.status !== '在售') return res.status(400).json({ success: false, message: '已预定' });
  await dbRun(`UPDATE items SET status = '已预定' WHERE id = ?`, [item.id]);
  res.json({ success: true, wechat: `${item.seller_name}_wx` });
});

app.delete('/api/items/:id', async (req, res) => {
  if (req.query.role !== 'admin') return res.status(403).json({ success: false, message: '无权限' });
  await dbRun(`DELETE FROM items WHERE id = ?`, [req.params.id]);
  res.json({ success: true });
});

app.post('/api/polish', async (req, res) => {
  const name = (req.body.title || '').trim();
  if (!name) return res.status(400).json({ success: false, message: '请先填写商品名称' });
  const apiKey = process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || '';
  if (!apiKey) return res.json({ success: true, description: mockDescription(name) });

  try {
    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'glm-4-flash', messages: [{ role: 'user', content: `为二手商品“${name}”写一段50字左右的吸引人的交易描述。` }] })
    });
    const data = await resp.json();
    res.json({ success: true, description: data.choices[0].message.content.trim() });
  } catch (e) {
    res.json({ success: true, description: mockDescription(name) });
  }
});

initDatabase().then(() => {
  app.listen(PORT, () => console.log(`🚀 启动成功：http://localhost:${PORT}/login.html`));
});