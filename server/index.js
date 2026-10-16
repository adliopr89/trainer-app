require('dotenv').config();
const path = require('path');
const express = require('express');
const { Bot, Keyboard } = require('grammy');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'webapp')));

// ID пользователя из initData Telegram.
// TODO: валидировать подпись initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
function tgUserId(req) {
  try {
    const raw = new URLSearchParams(req.headers['x-tg-init-data'] || '').get('user');
    return raw ? JSON.parse(raw).id : null;
  } catch {
    return null;
  }
}

// --- API ---

app.get('/api/levels', (req, res) => {
  res.json(db.LEVELS.map(l => ({
    ...l,
    programs: db.PROGRAMS.filter(p => p.levelId === l.id)
      .map(p => ({ id: p.id, title: p.title, weeks: p.weeks.length })),
  })));
});

app.get('/api/programs/:id', (req, res) => {
  const p = db.getProgram(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const logs = db.getUserLogs(tgUserId(req));
  const weekNum = db.currentWeekNum();
  const today = db.todayWeekday();
  res.json({
    id: p.id,
    title: db.currentMonthName(),
    weekNum,
    totalWeeks: p.weeks.length,
    today,
    weeks: p.weeks.map(w => ({
      num: w.num,
      locked: w.num > weekNum,
      days: w.workouts.map(wo => ({
        id: wo.id,
        weekday: wo.weekday,
        weekdayName: db.WEEKDAYS_FULL[wo.weekday - 1],
        title: wo.title,
        // внутри текущей недели дни открываются по календарю; прошлые недели — вся неделя открыта
        locked: w.num > weekNum || (w.num === weekNum && wo.weekday > today),
        opensIn: wo.weekday - today,
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
    const kb = new Keyboard();
    if (webappUrl) kb.webApp('Открыть тренировки', webappUrl);
    kb.resized();
    await ctx.reply('Привет! Твой онлайн-тренер в зале. Жми кнопку ниже.', { reply_markup: kb });
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
