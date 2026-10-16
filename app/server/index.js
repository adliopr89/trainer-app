require('dotenv').config();
const path = require('path');
const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'webapp')));

// Пользователь из initData Telegram.
// TODO: валидировать подпись initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
function tgUser(req) {
  try {
    const raw = new URLSearchParams(req.headers['x-tg-init-data'] || '').get('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
const tgUserId = req => tgUser(req)?.id || null;

// --- API ---

app.get('/api/programs', (req, res) => {
  res.json(db.PROGRAMS.map(p => ({
    id: p.id, title: p.title, desc: p.desc,
    level: p.level, packs: p.packs, group: p.group,
    weeks: p.weeks.length,
  })));
});

app.get('/api/groups', (req, res) => res.json(db.GROUPS));

// Регистрация входа в Mini App: пишем аккаунт в базу (accounts.json)
app.post('/api/me', (req, res) => {
  const u = tgUser(req);
  if (u) db.saveAccount(u);
  const userId = u?.id || null;
  res.json({ ok: true, userId, startDate: userId ? db.getUser(userId).startDate : null });
});

app.get('/api/menus', (req, res) => {
  res.json(db.MENUS.map(m => ({ id: m.id, title: m.title, desc: m.desc })));
});

app.get('/api/menus/:id', (req, res) => {
  const m = db.getMenu(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  res.json(m);
});

app.get('/api/programs/:id', (req, res) => {
  const p = db.getProgram(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const logs = db.getUserLogs(tgUserId(req));
  const startDate = db.getUser(tgUserId(req)).startDate;
  const weekNum = db.currentWeekNum(startDate, p.weeks.length);
  res.json({
    id: p.id,
    title: p.title,
    desc: p.desc,
    weekNum,
    totalWeeks: p.weeks.length,
    weeks: p.weeks.map(w => ({
      num: w.num,
      locked: w.num > weekNum,
      opensIn: db.weekOpensIn(startDate, w.num),
      workouts: w.workouts.map(wo => ({
        id: wo.id,
        num: wo.num,
        title: wo.title,
        doneCount: wo.exercises.filter(e => logs[e.id]?.done).length,
        total: wo.exercises.length,
      })),
    })),
  });
});

app.get('/api/workouts/:id', (req, res) => {
  const wo = db.findWorkout(req.params.id);
  if (!wo) return res.status(404).json({ error: 'not found' });
  const logs = db.getUserLogs(tgUserId(req));
  res.json({ ...wo, exercises: wo.exercises.map(e => ({ ...e, log: logs[e.id] || null })) });
});

app.post('/api/log', (req, res) => {
  const userId = tgUserId(req);
  if (!userId) return res.status(401).json({ error: 'no user' });
  const { exerciseId, sets, done } = req.body;
  if (!exerciseId) return res.status(400).json({ error: 'exerciseId required' });
  db.saveLog(userId, exerciseId, { sets, done: !!done });
  res.json({ ok: true });
});

// --- Сервер ---

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WebApp + API: http://localhost:${PORT}`));

// --- Бот ---

if (process.env.BOT_TOKEN) {
  const bot = new Bot(process.env.BOT_TOKEN);
  const webappUrl = process.env.WEBAPP_URL;

  bot.command('start', async ctx => {
    db.saveAccount(ctx.from); // база аккаунтов: user_name + имя
    const kb = new InlineKeyboard();
    if (webappUrl) kb.webApp('Открыть приложение', webappUrl).row();
    kb.text('Оплатить', 'pay');
    await ctx.reply(`Привет, ${ctx.from.first_name || 'подруга'}! Я твой онлайн-тренер.\nОткрой приложение с программами тренировок или оплати доступ:`, { reply_markup: kb });
  });

  bot.callbackQuery('pay', async ctx => {
    // TODO: оплата (Telegram Stars / Prodamus / YooKassa) + выдача доступа — этап 2
    await ctx.answerCallbackQuery({ text: 'Оплата скоро появится — раздел в разработке' });
  });

  bot.catch(e => console.error('Bot error:', e));
  (async () => {
    if (webappUrl) {
      try {
        await bot.api.setChatMenuButton({
          menu_button: { type: 'web_app', text: 'Тренировки', web_app: { url: webappUrl } },
        });
        console.log('Menu button -> ' + webappUrl);
      } catch (e) {
        console.error('setChatMenuButton failed:', e.message);
      }
    }
    bot.start(); // polling; promise резолвится при остановке
    console.log('Bot polling started');
  })();
} else {
  console.log('BOT_TOKEN не задан — бот не запущен, работает только webapp/API.');
}
