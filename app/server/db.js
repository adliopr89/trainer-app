// Простое JSON-хранилище для MVP. Потом заменим на SQLite/Supabase.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// --- Заглушки программ: 2 программы по 4 недели ---
// Неделя = weekPlan[N] занятий, каждое — список упражнений из пула.
// Когда тренер даст реальный контент — заменим этот блок загрузкой из JSON/БД.

const WORKOUT_TITLES = {
  power: ['Ноги и ягодицы', 'Верх тела', 'Всё тело', 'Кор и спина', 'Силовая', 'Лёгкая'],
  burn: ['Кардио', 'Всё тело', 'Интервалы', 'Ноги и кор', 'Лёгкая', 'Кардио+'],
};

// Группы тренировок (фильтры на вкладке «Программы»)
const GROUPS = [
  { id: 'form', title: 'Формы' },
  { id: 'burn', title: 'Похудение' },
  { id: 'mass', title: 'Набор массы' },
];

// packs: в каких пакетах доступна программа (одна программа может быть в нескольких)
const PROGRAMS_META = [
  {
    id: 'oreh',
    title: 'Крепкий орех',
    desc: 'Силовая программа: базовые движения, мышцы и рельеф',
    level: 'Опытный',
    packs: ['sure', 'vip'],
    group: 'form',
    pool: 'power',
    weekPlan: [4, 5, 5, 6], // занятий в каждой неделе
  },
  {
    id: 'hudeyu',
    title: 'Хуяе как худею',
    desc: 'Жиросжигание: больше повторов, меньше веса, короткий отдых',
    level: 'Новичок',
    packs: ['start', 'sure', 'vip'],
    group: 'burn',
    pool: 'burn',
    weekPlan: [4, 5, 5, 6],
  },
];

const EXERCISES_POOL = {
  power: [
    ['Приседания со штангой', 4, 8, 50, 'Гриф на верхней части трапеций. Вдох — вниз до параллели, выдох — вверх. Колени по направлению носков.'],
    ['Становая тяга', 4, 6, 60, 'Гриф над серединой стопы, спина нейтральная. Тяни за счёт ног и ягодиц, гриф скользит вдоль голени.'],
    ['Жим гантелей лёжа', 4, 8, 12, 'Лопатки сведены, гантели на уровне груди. Выжимай вверх без сведения рук в конце.'],
  ],
  burn: [
    ['Приседания с собственным весом', 4, 20, 0, 'Стопы на ширине плеч, спина прямая. Темп средний, без пауз вверху.'],
    ['Выпады назад', 4, 15, 0, 'Шаг назад, колено задней ноги почти касается пола. Корпус вертикально, работаем поочерёдно.'],
    ['Берпи', 3, 10, 0, 'Из упора лёжа — прыжок вверх с хлопком над головой. Отдых между подходами 60 секунд.'],
  ],
};

function buildPrograms() {
  return PROGRAMS_META.map(meta => ({
    id: meta.id,
    title: meta.title,
    desc: meta.desc,
    level: meta.level,
    packs: meta.packs,
    group: meta.group,
    weeks: meta.weekPlan.map((count, w) => ({
      num: w + 1,
      workouts: Array.from({ length: count }, (_, s) => ({
        id: `${meta.id}-w${w + 1}-s${s + 1}`,
        num: s + 1,
        title: WORKOUT_TITLES[meta.pool][s % WORKOUT_TITLES[meta.pool].length],
        exercises: EXERCISES_POOL[meta.pool].map(([name, sets, reps, weight, tech], i) => ({
          id: `${meta.id}-w${w + 1}-s${s + 1}-e${i + 1}`,
          name,
          sets,
          reps,
          weight,
          tech,
          video: '', // сюда вставим ссылки на видео техники
        })),
      })),
    })),
  }));
}

const PROGRAMS = buildPrograms();

// --- Меню питания (раздел «Питание») ---
const MENUS = [
  {
    id: 'menu-deficit',
    title: 'Похудение · ~1500 ккал',
    desc: 'Плавный дефицит без голодовок. Белок в каждом приёме пищи.',
    kbju: 'Б 110 · Ж 50 · У 150',
    meals: [
      { name: 'Завтрак', dish: 'Овсянка на молоке + яйцо + яблоко', kcal: 380 },
      { name: 'Перекус', dish: 'Творог 5% + горсть ягод', kcal: 180 },
      { name: 'Обед', dish: 'Куриная грудка + гречка + салат из овощей с маслом', kcal: 480 },
      { name: 'Перекус', dish: 'Кефир + цельнозерновой хлебец', kcal: 160 },
      { name: 'Ужин', dish: 'Запечённая рыба + овощи на пару', kcal: 300 },
    ],
  },
  {
    id: 'menu-support',
    title: 'Поддержание · ~2000 ккал',
    desc: 'Держим форму: баланс белков, жиров и углеводов.',
    kbju: 'Б 130 · Ж 65 · У 220',
    meals: [
      { name: 'Завтрак', dish: 'Яичница из 2 яиц + тост с авокадо + кофе', kcal: 450 },
      { name: 'Перекус', dish: 'Греческий йогурт + орехи', kcal: 260 },
      { name: 'Обед', dish: 'Говядина + рис + тушёные овощи', kcal: 620 },
      { name: 'Перекус', dish: 'Бутерброд с сыром + помидор', kcal: 270 },
      { name: 'Ужин', dish: 'Индейка + булгур + салат', kcal: 400 },
    ],
  },
  {
    id: 'menu-mass',
    title: 'Набор массы · ~2500 ккал',
    desc: 'Профицит калорий для роста мышц. 5–6 приёмов пищи.',
    kbju: 'Б 160 · Ж 85 · У 270',
    meals: [
      { name: 'Завтрак', dish: 'Омлет из 3 яиц + овсянка с бананом и мёдом', kcal: 620 },
      { name: 'Перекус', dish: 'Творог + мюсли + молоко', kcal: 400 },
      { name: 'Обед', dish: 'Паста с курицей в сливочном соусе + салат', kcal: 700 },
      { name: 'Перекус', dish: 'Протеиновый коктейль + орехи', kcal: 350 },
      { name: 'Ужин', dish: 'Лосось + картофель + брокколи', kcal: 430 },
    ],
  },
];

// --- JSON helpers ---

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
const saveJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// --- Пользователи: { userId: { startDate } } ---

function getUser(userId) {
  if (!userId) return { startDate: new Date().toISOString() };
  const users = loadJson(USERS_FILE, {});
  if (!users[userId]) {
    users[userId] = { startDate: new Date().toISOString() };
    saveJson(USERS_FILE, users);
  }
  return users[userId];
}

// --- Логи: { userId: { exerciseId: { sets, done, date } } } ---

function saveLog(userId, exerciseId, entry) {
  const logs = loadJson(LOGS_FILE, {});
  logs[userId] = logs[userId] || {};
  const prev = logs[userId][exerciseId];
  // история: последние 5 записей по упражнению (самая свежая — первая)
  const hist = [prev && { sets: prev.sets, date: prev.date }, ...(prev?.hist || [])]
    .filter(Boolean).slice(0, 5);
  logs[userId][exerciseId] = { ...entry, hist, date: new Date().toISOString() };
  saveJson(LOGS_FILE, logs);
}

function getUserLogs(userId) {
  return userId ? (loadJson(LOGS_FILE, {})[userId] || {}) : {};
}

// --- Аккаунты: { tgId: { user_name, first_name, created, seen } } ---
// Мини-база клиентов до этапа 2 (оплата/доступы).

function saveAccount(tgUser) {
  if (!tgUser?.id) return;
  const acc = loadJson(ACCOUNTS_FILE, {});
  const prev = acc[tgUser.id] || {};
  acc[tgUser.id] = {
    user_name: tgUser.username || prev.user_name || '',
    first_name: tgUser.first_name || prev.first_name || '',
    photo_url: tgUser.photo_url || prev.photo_url || '', // есть только из Mini App initData
    created: prev.created || new Date().toISOString(),
    seen: new Date().toISOString(),
  };
  saveJson(ACCOUNTS_FILE, acc);
}

function getAccount(tgId) {
  return loadJson(ACCOUNTS_FILE, {})[tgId] || null;
}

// --- Календарная логика ---

// Текущая неделя считается от даты регистрации: неделя 1 сразу,
// неделя 2 через 7 дней и т.д. (максимум — число недель программы)
function currentWeekNum(startISO, totalWeeks = 4) {
  const start = Date.parse(startISO);
  const days = Number.isFinite(start) && start <= Date.now()
    ? Math.floor((Date.now() - start) / 864e5) : 0;
  return Math.min(Math.max(Math.floor(days / 7) + 1, 1), totalWeeks);
}

// Через сколько дней открывается неделя num (0 — уже открыта)
function weekOpensIn(startISO, num) {
  let start = Date.parse(startISO);
  if (!Number.isFinite(start) || start > Date.now()) start = Date.now();
  return Math.max(0, Math.ceil((start + (num - 1) * 7 * 864e5 - Date.now()) / 864e5));
}

function getProgram(programId) {
  return PROGRAMS.find(p => p.id === programId);
}

function getMenu(menuId) {
  return MENUS.find(m => m.id === menuId);
}

function findWorkout(workoutId) {
  for (const p of PROGRAMS)
    for (const w of p.weeks)
      for (const wo of w.workouts)
        if (wo.id === workoutId) return wo;
  return null;
}

module.exports = {
  PROGRAMS, MENUS, GROUPS,
  getProgram, getMenu, findWorkout, getUser, saveLog, getUserLogs,
  saveAccount, getAccount, currentWeekNum, weekOpensIn,
};
