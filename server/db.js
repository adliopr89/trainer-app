// Простое JSON-хранилище для MVP. Потом заменим на SQLite/Supabase.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// --- Заглушки программ: 3 уровня, у каждого программа на 4 недели ---
// Каждая неделя — 7 слотов по дням недели (1=Пн … 7=Вс).
// Когда тренер даст реальный контент — заменим этот блок загрузкой из JSON/БД.
const LEVELS = [
  { id: 'beginner', title: 'Новичок' },
  { id: 'intermediate', title: 'Опытный' },
  { id: 'pro', title: 'Профи' },
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const DAY_TITLES = ['Ноги и ягодицы', 'Верх тела', 'Всё тело', 'Кардио и кор', 'Ноги и ягодицы', 'Верх тела', 'Лёгкая тренировка'];
const EXERCISES_POOL = {
  beginner: [
    ['Приседания с собственным весом', 3, 12, 0, 'Стопы на ширине плеч, спина прямая. Опускайся до параллели бёдер с полом, колени не заваливаются внутрь.'],
    ['Ягодичный мост', 3, 15, 0, 'Лёжа на спине, стопы на полу. Поднимай таз вверх, сжимая ягодицы в верхней точке на секунду.'],
    ['Отжимания с колен', 3, 8, 0, 'Ладони под плечами, корпус прямой от колен до головы. Опускайся до касания грудью пола.'],
  ],
  intermediate: [
    ['Приседания со штангой', 3, 10, 40, 'Гриф на верхней части трапеций. Вдох — вниз до параллели, выдох — вверх. Колени по направлению носков.'],
    ['Жим гантелей лёжа', 3, 10, 12, 'Лопатки сведены, гантели на уровне груди. Выжимай вверх без сведения рук в конце.'],
    ['Тяга в наклоне', 3, 10, 30, 'Наклон ~45°, спина прямая. Тяни гриф к низу живота, локти вдоль корпуса.'],
  ],
  pro: [
    ['Приседания со штангой', 4, 8, 70, 'Гриф на трапециях, полная амплитуда. Пауза в нижней точке, мощный выход без раскачки.'],
    ['Становая тяга', 4, 6, 80, 'Гриф над серединой стопы, спина нейтральная. Тяни за счёт ног и ягодиц, гриф скользит вдоль голени.'],
    ['Жим лёжа', 4, 8, 50, 'Лопатки сведены и опущены, прогиб естественный. Гриф к нижней части груди, выжим вверх-назад.'],
  ],
};

function buildPrograms() {
  return LEVELS.map(level => ({
    id: `${level.id}-m1`,
    levelId: level.id,
    title: 'Месяц 1 — Старт',
    weeks: Array.from({ length: 4 }, (_, w) => ({
      num: w + 1,
      workouts: DAY_TITLES.map((title, d) => ({
        id: `${level.id}-w${w + 1}-d${d + 1}`,
        weekday: d + 1, // 1=Пн … 7=Вс
        title,
        exercises: EXERCISES_POOL[level.id].map(([name, sets, reps, weight, tech], i) => ({
          id: `${level.id}-w${w + 1}-d${d + 1}-e${i + 1}`,
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
  logs[userId][exerciseId] = { ...entry, date: new Date().toISOString() };
  saveJson(LOGS_FILE, logs);
}

function getUserLogs(userId) {
  return userId ? (loadJson(LOGS_FILE, {})[userId] || {}) : {};
}

// --- Календарная логика ---

// JS getDay(): 0=Вс … 6=Сб → у нас 1=Пн … 7=Вс
function todayWeekday() {
  return ((new Date().getDay() + 6) % 7) + 1;
}

// Текущая неделя — по календарю: неделя месяца, счёт с первого дня месяца
// (дни 1–7 → неделя 1, 8–14 → неделя 2 и т.д., максимум 4)
function currentWeekNum() {
  return Math.min(Math.floor((new Date().getDate() - 1) / 7) + 1, 4);
}

function currentMonthName() {
  return MONTHS_RU[new Date().getMonth()];
}

function getProgram(programId) {
  return PROGRAMS.find(p => p.id === programId);
}

function findWorkout(workoutId) {
  for (const p of PROGRAMS)
    for (const w of p.weeks)
      for (const wo of w.workouts)
        if (wo.id === workoutId) return wo;
  return null;
}

module.exports = {
  LEVELS, WEEKDAYS, WEEKDAYS_FULL, MONTHS_RU, PROGRAMS,
  getProgram, findWorkout, getUser, saveLog, getUserLogs,
  todayWeekday, currentWeekNum, currentMonthName,
};
