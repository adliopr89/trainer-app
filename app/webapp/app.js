const tg = window.Telegram?.WebApp;
tg?.expand();
tg?.ready();
tg?.enableClosingConfirmation?.(); // подтверждение при закрытии — не потерять введённые данные
tg?.disableVerticalSwipes?.();     // свайп вниз не сворачивает мини-апп
tg?.BackButton?.onClick(() => back());

// Тема Telegram → палитра приложения (тёмная — фирменная, светлая — адаптированная).
// Подписаны на themeChanged: переключение темы на лету тоже отрабатывает.
function applyTheme() {
  const hex = tg?.themeParams?.bg_color;
  const n = hex && parseInt(hex.slice(1), 16);
  const tgLight = !!n && (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
  // ручной выбор в профиле (auto/dark/light) имеет приоритет над темой ТГ
  const pref = ls.get('theme', 'auto');
  const light = pref === 'light' || (pref === 'auto' && tgLight);
  const vars = light
    ? { '--bg': '#f6f4f5', '--text': '#1e1a1c', '--hint': '#8a8188', '--card': '#ffffff', '--line': '#e8e2e6', '--pink-dim': '#ffe3ec', '--pink-soft': '#e0447a' }
    : { '--bg': '#0a090b', '--text': '#ece7ea', '--hint': '#9a9199', '--card': '#141114', '--line': '#241d22', '--pink-dim': '#3d1523', '--pink-soft': '#ff8fab' };
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) r.setProperty(k, v);
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  const bg = light ? '#f6f4f5' : '#0a090b';
  tg?.setHeaderColor?.(bg);
  tg?.setBackgroundColor?.(bg);
}

// При открытой клавиатуре инпут мог уехать под шапку/край — доводим до центра экрана
document.addEventListener('focusin', e => {
  if (e.target.matches?.('input')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
});

const INIT_DATA = tg?.initData || '';

const fetchApi = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { 'x-tg-init-data': INIT_DATA, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(r => r.json());

// --- localStorage ---
// Ключи привязаны к tg id — два ТГ-аккаунта на одном устройстве не делят профиль/логи.
// Без initData (обычный браузер) — общие ключи, как раньше.
const TGID = tg?.initDataUnsafe?.user?.id || '';
const ls = {
  key: k => (TGID ? `${k}_${TGID}` : k),
  get(k, f) { try { return JSON.parse(localStorage.getItem(ls.key(k))) ?? f; } catch { return f; } },
  set(k, v) { localStorage.setItem(ls.key(k), JSON.stringify(v)); },
};

// --- Локальный режим (статический хостинг): данные из window.APP_DATA, логи в localStorage ---
function localApi(path, opts = {}) {
  const D = window.APP_DATA;
  const logs = ls.get('logs', {});
  const since = ls.get('profile')?.since || new Date().toISOString().slice(0, 10);
  // защита от кривой даты регистрации: NaN или будущее → считаем от сегодня
  const start = Date.parse(since);
  const startMs = Number.isFinite(start) && start <= Date.now() ? start : Date.now();
  const weekNumOf = total =>
    Math.min(Math.max(Math.floor((Date.now() - startMs) / 6048e5) + 1, 1), total);
  const opensIn = num =>
    Math.max(0, Math.ceil((startMs + (num - 1) * 7 * 864e5 - Date.now()) / 864e5));

  if (path === '/api/programs') {
    return Promise.resolve(D.programs.map(p => {
      const ex = p.weeks.flatMap(w => w.workouts.flatMap(wo => wo.exercises));
      return {
        id: p.id, title: p.title, desc: p.desc,
        level: p.level, packs: p.packs, group: p.group,
        weeks: p.weeks.length,
        total: ex.length,
        done: ex.filter(e => logs[e.id]?.done).length,
      };
    }));
  }
  if (path === '/api/groups') {
    return Promise.resolve(D.groups);
  }
  if (path === '/api/stats') {
    // агрегаты по логам для ачивок (зеркало db.statsFromLogs)
    const s = { doneEx: 0, doneWorkouts: 0, doneWeeks: 0, donePrograms: 0 };
    for (const p of D.programs) {
      let pDone = 0, pTotal = 0;
      for (const w of p.weeks) {
        let wDone = 0, wTotal = 0;
        for (const wo of w.workouts) {
          const d = wo.exercises.filter(e => logs[e.id]?.done).length;
          s.doneEx += d; wDone += d; pDone += d;
          wTotal += wo.exercises.length; pTotal += wo.exercises.length;
          if (wo.exercises.length && d === wo.exercises.length) s.doneWorkouts++;
        }
        if (wTotal && wDone === wTotal) s.doneWeeks++;
      }
      if (pTotal && pDone === pTotal) s.donePrograms++;
    }
    return Promise.resolve(s);
  }
  if (path === '/api/menus') {
    return Promise.resolve(D.menus.map(m => ({ id: m.id, title: m.title, desc: m.desc, kbju: m.kbju })));
  }
  if (path.startsWith('/api/menus/')) {
    const m = D.menus.find(x => x.id === path.split('/').pop());
    return Promise.resolve(m || { error: 'not found' });
  }
  if (path === '/api/me' && opts.method === 'POST') {
    const u = tg?.initDataUnsafe?.user;
    if (u) ls.set('account', { user_name: u.username || '', first_name: u.first_name || '', seen: new Date().toISOString() });
    return Promise.resolve({ ok: true, userId: u?.id || null, startDate: since });
  }
  if (path.startsWith('/api/programs/')) {
    const p = D.programs.find(x => x.id === path.split('/').pop());
    if (!p) return Promise.resolve({ error: 'not found' });
    const weekNum = weekNumOf(p.weeks.length);
    return Promise.resolve({
      id: p.id, title: p.title, desc: p.desc,
      weekNum, totalWeeks: p.weeks.length,
      weeks: p.weeks.map(w => ({
        num: w.num,
        locked: w.num > weekNum,
        opensIn: opensIn(w.num),
        workouts: w.workouts.map(wo => ({
          id: wo.id, num: wo.num, title: wo.title,
          doneCount: wo.exercises.filter(e => logs[e.id]?.done).length,
          total: wo.exercises.length,
        })),
      })),
    });
  }
  if (path.startsWith('/api/workouts/')) {
    const id = path.split('/').pop();
    for (const p of D.programs)
      for (const w of p.weeks)
        for (const wo of w.workouts)
          if (wo.id === id)
            return Promise.resolve({ ...wo, exercises: wo.exercises.map(e => ({ ...e, log: logs[e.id] || null })) });
    return Promise.resolve({ error: 'not found' });
  }
  if (path === '/api/log' && opts.method === 'POST') {
    const { exerciseId, sets, done } = JSON.parse(opts.body);
    const prev = logs[exerciseId];
    // история: последние 5 записей по упражнению (самая свежая — первая)
    const hist = [prev && { sets: prev.sets, date: prev.date }, ...(prev?.hist || [])]
      .filter(Boolean).slice(0, 5);
    logs[exerciseId] = { sets, done: !!done, date: new Date().toISOString(), hist };
    ls.set('logs', logs);
    return Promise.resolve({ ok: true });
  }
  return Promise.resolve({ error: 'unknown endpoint' });
}

const api = window.APP_DATA ? localApi : fetchApi;

// тема: читаем выбор из localStorage (ls уже объявлен), следим за сменой темы ТГ
applyTheme();
tg?.onEvent?.('themeChanged', applyTheme);

// --- Профиль пользователя (localStorage; серверная БД клиентов — этап 2) ---
const getProfile = () => ls.get('profile', null);

// Тарифные пакеты. Пока заглушка: при онбординге выдаётся «Старт» на 30 дней;
// после оплаты (этап 2) пакет и срок будут приходить с сервера.
const PACKS = {
  start: { title: 'Старт', emoji: '⭐' },
  sure:  { title: 'Уверенная', emoji: '🥜' },
  vip:   { title: 'VIP', emoji: '👑' },
};

function getPack(p) {
  if (!p.pack) {
    p.pack = { id: 'start', until: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) };
    ls.set('profile', p);
  }
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = Math.ceil((Date.parse(p.pack.until) - Date.parse(today)) / 864e5);
  return { ...PACKS[p.pack.id], until: p.pack.until, daysLeft, expired: daysLeft < 0 };
}

// Тост «Сохранено» и т.п. — визуальный отклик там, где хаптики не работают (браузер)
let toastTimer;
function toast(text) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}



function saveWeight(w, d) {
  const p = getProfile();
  const ex = p.weights.find(x => x.d === d);
  if (ex) ex.w = w; // одна запись на дату — перезаписываем
  else p.weights.push({ d, w });
  p.weights.sort((a, b) => (a.d < b.d ? -1 : 1));
  ls.set('profile', p);
}

function delWeight(d) {
  const p = getProfile();
  p.weights = p.weights.filter(x => x.d !== d);
  ls.set('profile', p);
}

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
const $head = document.getElementById('head');

// ---------- закреплённая шапка: пакет · имя · вес · аватар (на всех страницах) ----------
function renderHead() {
  const p = getProfile();
  if (!p) { $head.style.display = 'none'; return; }
  $head.style.display = '';
  const pack = getPack(p);
  const last = p.weights[p.weights.length - 1];
  const leftTxt = pack.daysLeft > 0 ? `${pack.daysLeft} дн.` : pack.daysLeft === 0 ? 'последний день' : 'истёк';
  const ava = tg?.initDataUnsafe?.user?.photo_url;
  const initial = (esc(p.name.trim()[0] || '?')).toUpperCase();
  $head.innerHTML = `
    <button class="h-pack">${pack.emoji} ${pack.title}<span> · ${leftTxt}</span></button>
    <div class="h-name">${esc(p.name)}, ${p.age}</div>
    <div class="h-weight">${last ? last.w : '—'}<small> кг</small></div>
    <div class="h-ava">${ava ? `<img src="${ava}" alt="" width="42" height="42">` : initial}</div>`;
  const toProfile = () => { tab = 'profile'; stack = [{ view: 'profile' }]; render(); };
  $head.querySelector('.h-pack').onclick = toProfile;
  $head.querySelector('.h-name').onclick = toProfile; // имя и аватарка — переход в профиль
  $head.querySelector('.h-ava').onclick = toProfile;
}

// ---------- навигация ----------
const TABS = [
  { id: 'programs', title: 'Программы' },
  { id: 'nutrition', title: 'Питание' },
  { id: 'profile', title: 'Мой профиль' },
];
let tab = 'programs';
// stack: [{view:'programs'|'program'|'week'|'workout'|'menus'|'menu'|'profile', ..., scroll}]
let stack = [{ view: 'programs' }];
const nav = s => { stack[stack.length - 1].scroll = window.scrollY; stack.push(s); render(); };
const back = () => { stack.pop(); render(); };

// ---------- табы ----------
function renderTabs() {
  $tabs.innerHTML = '';
  for (const t of TABS) {
    const b = document.createElement('button');
    b.textContent = t.title;
    b.className = t.id === tab ? 'active' : '';
    b.onclick = () => {
      tab = t.id;
      stack = [{ view: tab === 'nutrition' ? 'menus' : tab }];
      render();
    };
    $tabs.appendChild(b);
  }
}

// ---------- онбординг: имя, возраст, вес ----------
function viewOnboarding() {
  $tabs.style.display = 'none';
  $head.style.display = 'none';
  document.body.classList.add('nohead');
  $app.innerHTML = `
    <h1 class="page">Давай познакомимся</h1>
    <div class="lead">Заполни данные — по ним соберём нагрузку и питание.</div>
    <div class="card form">
      <label>Имя<input id="f-name" type="text" placeholder="Как тебя зовут" value="${esc(tg?.initDataUnsafe?.user?.first_name || '')}"></label>
      <div class="err" id="e-name"></div>
      <label>Возраст<input id="f-age" type="number" inputmode="numeric" min="14" max="99" placeholder="30"></label>
      <div class="err" id="e-age"></div>
      <label>Вес, кг<input id="f-weight" type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="65"></label>
      <div class="err" id="e-weight"></div>
      <button class="btn" id="f-go">Начать</button>
    </div>`;
  const setErr = (f, msg) => {
    $app.querySelector('#e-' + f).textContent = msg;
    $app.querySelector('#f-' + f).classList.toggle('bad', !!msg);
  };
  $app.querySelector('#f-go').onclick = () => {
    const name = $app.querySelector('#f-name').value.trim();
    const age = parseInt($app.querySelector('#f-age').value) || 0;
    const w = parseFloat($app.querySelector('#f-weight').value) || 0;
    setErr('name', name ? '' : 'Как тебя зовут?');
    setErr('age', age >= 14 && age <= 99 ? '' : 'Возраст от 14 до 99');
    setErr('weight', w >= 30 && w <= 300 ? '' : 'Вес от 30 до 300 кг');
    if (!name || age < 14 || age > 99 || w < 30 || w > 300) {
      tg?.HapticFeedback?.notificationOccurred('error');
      return;
    }
    $app.querySelector('#f-go').disabled = true;
    const today = new Date().toISOString().slice(0, 10);
    ls.set('profile', {
      name, age, since: today,
      weights: [{ d: today, w }],
      pack: { id: 'start', until: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) },
    });
    checkUnlocks(); // 🌱 «Первый шаг»
    tg?.HapticFeedback?.notificationOccurred('success');
    $tabs.style.display = '';
    document.body.classList.remove('nohead');
    renderHead();
    render();
  };
  // Enter в любом поле = «Начать»
  for (const inp of $app.querySelectorAll('#f-name, #f-age, #f-weight'))
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') $app.querySelector('#f-go').click(); });
  $app.querySelector('#f-name').focus();
}

// ---------- Программы ----------
// фильтры: пакет · «доступное мне» · группа тренировок
const F = { pack: 'all', onlyMine: true, group: 'all' };

async function viewPrograms() {
  $app.innerHTML = '<div class="empty">Загрузка…</div>';
  const [programs, groups] = await Promise.all([api('/api/programs'), api('/api/groups')]);
  // истёкший пакет = нет доступа: программы показываем, но все под замком
  const prof = getProfile();
  const myPack = prof && !getPack(prof).expired ? prof.pack.id : null;
  const list = programs.filter(p =>
    (F.pack === 'all' || p.packs.includes(F.pack)) &&
    (!F.onlyMine || p.packs.includes(myPack)) &&
    (F.group === 'all' || p.group === F.group));

  $app.innerHTML = `
    <h1 class="page">Программы</h1>
    <div class="filters">
      <div class="frow" id="f-packs"></div>
      <label class="chk"><input type="checkbox" id="f-mine"${F.onlyMine ? ' checked' : ''}> Доступное мне</label>
      <div class="frow" id="f-groups"></div>
    </div>
    <div id="plist"></div>`;

  const mkChips = (sel, items, isOn, onclick) => {
    const box = $app.querySelector(sel);
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'chip' + (isOn(it.id) ? ' active' : '');
      b.textContent = it.t;
      b.onclick = () => { onclick(it.id); render(); };
      box.appendChild(b);
    }
  };
  mkChips('#f-packs',
    [{ id: 'all', t: 'Все' }, ...Object.entries(PACKS).map(([id, p]) => ({ id, t: `${p.emoji} ${p.title}` }))],
    id => F.pack === id, id => { F.pack = id; });
  mkChips('#f-groups',
    [{ id: 'all', t: 'Все' }, ...groups.map(g => ({ id: g.id, t: g.title }))],
    id => F.group === id, id => { F.group = id; });
  $app.querySelector('#f-mine').onchange = e => { F.onlyMine = e.target.checked; render(); };

  const $list = $app.querySelector('#plist');
  if (!list.length) {
    $list.innerHTML = '<div class="empty">Под эти фильтры программ нет.<br>Попробуй снять «Доступное мне» или выбрать другую группу.</div>';
    return;
  }
  for (const p of list) {
    const mine = p.packs.includes(myPack);
    const packTxt = p.packs.map(id => `${PACKS[id]?.emoji || ''} ${PACKS[id]?.title || id}`).join(' · ');
    const groupTxt = groups.find(g => g.id === p.group)?.title || '';
    const el = document.createElement('div');
    el.className = 'card' + (mine ? '' : ' locked');
    const passedBadge = p.total && p.done === p.total ? ' <span class="badge done">🏁 пройдена</span>' : '';
    el.innerHTML = `<div class="t">${p.title}${mine ? '' : ' <span class="badge lock">🔒</span>'}${passedBadge}</div>
      <div class="meta">${p.level} · ${packTxt} · ${p.weeks} недели</div>
      <div class="s">${p.desc}</div>
      <div class="tags">${groupTxt}</div>
      ${p.total ? `<div class="prog"><i style="width:${(p.done / p.total) * 100}%"></i></div>
        <div class="s">${p.done}/${p.total} упражнений</div>` : ''}`;
    el.onclick = mine
      ? () => nav({ view: 'program', id: p.id })
      : () => tg?.HapticFeedback?.notificationOccurred('warning');
    $list.appendChild(el);
  }
}

// экран программы = все недели видны; неделя N открывается через 7·(N−1) дней от регистрации
async function viewProgram(s) {
  $app.innerHTML = '<div class="empty">Загрузка…</div>';
  const p = await api(`/api/programs/${s.id}`);
  $app.innerHTML = `<button class="back">‹ Назад</button>
    <h1 class="page">${p.title}</h1>
    <h2 class="sec">Идёт неделя ${p.weekNum} из ${p.totalWeeks}</h2>`;
  $app.querySelector('.back').onclick = back;
  for (const w of p.weeks) {
    const el = document.createElement('div');
    el.className = 'card' + (w.locked ? ' locked' : '');
    const done = w.workouts.reduce((a, d) => a + d.doneCount, 0);
    const total = w.workouts.reduce((a, d) => a + d.total, 0);
    const badge = w.locked ? '<span class="badge lock">🔒</span>'
      : done === total && total > 0 ? '<span class="badge done">готово</span>'
      : w.num === p.weekNum ? '<span class="badge part">текущая</span>' : '';
    const when = w.opensIn === 1 ? 'завтра' : `через ${w.opensIn} дн.`;
    el.innerHTML = `<div class="t">Неделя ${w.num} ${badge}</div>
      <div class="s">${w.locked ? `Откроется ${when}` : `${w.workouts.length} занятий · ${done}/${total} упражнений`}</div>
      <div class="prog"><i style="width:${total && !w.locked ? (done / total) * 100 : 0}%"></i></div>`;
    el.onclick = w.locked
      ? () => tg?.HapticFeedback?.notificationOccurred('warning')
      : () => nav({ view: 'week', programId: p.id, title: p.title, num: w.num });
    $app.appendChild(el);
  }
}

// экран недели = занятия 1..N (все доступны, пока неделя открыта)
async function viewWeek(s) {
  $app.innerHTML = '<div class="empty">Загрузка…</div>';
  const p = await api(`/api/programs/${s.programId}`);
  const w = p.weeks.find(x => x.num === s.num);
  $app.innerHTML = `<button class="back">‹ Назад</button>
    <h1 class="page">${s.title} — неделя ${w.num}</h1>`;
  $app.querySelector('.back').onclick = back;
  const nextId = w.workouts.find(d => d.doneCount < d.total)?.id;
  for (const d of w.workouts) {
    const el = document.createElement('div');
    el.className = 'card';
    const badge = d.doneCount === d.total && d.total > 0 ? '<span class="badge done">готово</span>'
      : d.id === nextId ? '<span class="badge part">следующее</span>'
      : d.doneCount > 0 ? `<span class="badge part">${d.doneCount}/${d.total}</span>` : '';
    el.innerHTML = `<div class="t">Занятие ${d.num} — ${d.title} ${badge}</div>
      <div class="s">${d.total} упражнения</div>
      <div class="prog"><i style="width:${d.total ? (d.doneCount / d.total) * 100 : 0}%"></i></div>`;
    el.onclick = () => nav({ view: 'workout', id: d.id, title: `Занятие ${d.num} — ${d.title}` });
    $app.appendChild(el);
  }
}

async function viewWorkout(s) {
  $app.innerHTML = '<div class="empty">Загрузка…</div>';
  const wo = await api(`/api/workouts/${s.id}`);
  $app.innerHTML = `<button class="back">‹ Назад</button><h1 class="page">${s.title}</h1>`;
  $app.querySelector('.back').onclick = back;
  wo.exercises.forEach((e, i) => {
    const saved = e.log;
    const mark = saved?.done ? '<span class="badge done">✓</span>' : '';
    const el = document.createElement('div');
    el.className = 'card ex';
    el.innerHTML = `
      <div class="ex-head">
        <div class="t">${i + 1}. ${e.name} ${mark}</div>
        <div class="s">План: ${e.sets} подхода × ${e.reps}${e.weight ? ' × ' + e.weight + ' кг' : ''}</div>
      </div>
      <div class="ex-body">
        <div class="video-box">${e.video ? videoHtml(e.video) : 'Видео техники скоро появится'}</div>
        ${e.tech ? `<div class="tech">${e.tech}</div>` : ''}
        <div class="plan-box">
          <span class="plan-lbl">План</span>
          <b>${e.weight ? e.weight + ' кг · ' : 'свой вес · '}${e.sets} подх. × ${e.reps} повт.</b>
        </div>
        <div class="plan"><b>Факт — сколько сделала:</b></div>
        <table class="sets">
          <tr><th>Подход</th><th>Вес, кг</th><th>Повторы</th></tr>
          ${Array.from({ length: e.sets }, (_, j) => {
            const sv = saved?.sets?.[j] || {};
            return `<tr>
              <td>${j + 1}</td>
              <td><input type="number" inputmode="decimal" data-j="${j}" data-f="w" value="${sv.w ?? ''}" placeholder="${e.weight || 'свой'}"></td>
              <td><input type="number" inputmode="numeric" data-j="${j}" data-f="r" value="${sv.r ?? ''}" placeholder="${e.reps || 0}"></td>
            </tr>`;
          }).join('')}
        </table>
        <button class="btn save">${saved?.done ? 'Обновить результат' : 'Отметить выполненным'}</button>
        ${saved?.done ? '<button class="btn ghost und">Снять отметку</button>' : ''}
        ${saved ? `<div class="hist"><b>Последняя запись:</b><div>${formatSets(saved.sets)} · ${fmtShort(saved.date)}</div>
          ${saved.hist?.length ? `<b>Предыдущие:</b>${saved.hist.slice(0, 4).map(h =>
            `<div>${formatSets(h.sets)} · ${fmtShort(h.date)}</div>`).join('')}` : ''}</div>` : ''}
      </div>`;
    // тап по шапке — разворачивает/сворачивает; клики внутри тела не сворачивают
    el.querySelector('.ex-head').onclick = ev => {
      ev.stopPropagation();
      el.classList.toggle('open');
    };
    el.querySelector('.ex-body').onclick = ev => ev.stopPropagation();
    el.querySelector('.save').onclick = async () => {
      const btn = el.querySelector('.save');
      btn.disabled = true; // антидвойной тап — лог не улетит дважды
      const sets = [...el.querySelectorAll('input[data-f="w"]')].map(inp => ({
        w: parseFloat(inp.value) || 0,
        r: parseInt(el.querySelector(`input[data-j="${inp.dataset.j}"][data-f="r"]`).value) || 0,
      }));
      await api('/api/log', { method: 'POST', body: JSON.stringify({ exerciseId: e.id, sets, done: true }) });
      tg?.HapticFeedback?.notificationOccurred('success');
      toast('Сохранено');
      checkUnlocks();
      await render();
      // автопереход: раскрываем следующее упражнение и подвозим к нему
      const next = $app.querySelectorAll('.card.ex')[i + 1];
      next?.classList.add('open');
      next?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    // «Снять отметку» — отмена случайного выполнения
    const und = el.querySelector('.und');
    if (und) und.onclick = async () => {
      und.disabled = true;
      await api('/api/log', { method: 'POST', body: JSON.stringify({ exerciseId: e.id, sets: saved.sets, done: false }) });
      tg?.HapticFeedback?.impactOccurred('light');
      render();
    };
    $app.appendChild(el);
  });
}

// ---------- Питание ----------
async function viewMenus() {
  $app.innerHTML = '<div class="empty">Загрузка…</div>';
  const menus = await api('/api/menus');
  $app.innerHTML = '<h1 class="page">Питание</h1>';
  for (const m of menus) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="t">${m.title}</div><div class="s">${m.desc}</div>`;
    el.onclick = () => nav({ view: 'menu', id: m.id });
    $app.appendChild(el);
  }
}

async function viewMenu(s) {
  $app.innerHTML = '<div class="empty">Загрузка…</div>';
  const m = await api(`/api/menus/${s.id}`);
  const had = ls.get('menuSeen');
  ls.set('menuSeen', true); // для ачивки «Заглянула в питание»
  if (!had) checkUnlocks();
  $app.innerHTML = `<button class="back">‹ Назад</button>
    <h1 class="page">${m.title}</h1>
    <div class="lead">${m.desc}${m.kbju ? ` · ${m.kbju}` : ''}</div>`;
  $app.querySelector('.back').onclick = back;
  for (const meal of m.meals) {
    const el = document.createElement('div');
    el.className = 'card meal';
    el.innerHTML = `<div class="t">${meal.name}${meal.kcal ? `<span class="kcal"> ~${meal.kcal} ккал</span>` : ''}</div><div class="s">${meal.dish}</div>`;
    $app.appendChild(el);
  }
}

// ---------- Ачивки ----------
// Условия считаются от того, что уже есть в данных: записи веса, выполненные
// упражнения/занятия/недели/программы, дни с регистрации, открытие меню, пакет.
const ACHIEVES = [
  { id: 'start',   e: '🌱', t: 'Первый шаг',       d: 'Профиль заполнен',              c: x => true },
  { id: 'w1',      e: '⚖️', t: 'На весах',         d: 'Добавила запись веса',          c: x => x.weights.length > 1 },
  { id: 'w5',      e: '📈', t: 'Динамика',         d: '5 записей веса',                c: x => x.weights.length >= 5 },
  { id: 'w2kg',    e: '🎯', t: 'Движение есть',    d: 'Вес изменился на 2+ кг',        c: x => x.dW >= 2 },
  { id: 'tr1',     e: '💪', t: 'Первая тренировка', d: 'Первое занятие целиком',       c: x => x.doneWorkouts >= 1 },
  { id: 'tr3',     e: '🔥', t: 'Разогрелась',      d: '3 занятия целиком',             c: x => x.doneWorkouts >= 3 },
  { id: 'ex10',    e: '🏅', t: 'Десятка',          d: '10 выполненных упражнений',     c: x => x.doneEx >= 10 },
  { id: 'week',    e: '🏋️', t: 'Неделя закрыта',   d: 'Все занятия недели выполнены',  c: x => x.doneWeeks >= 1 },
  { id: 'prog',    e: '🏁', t: 'Программа пройдена', d: '100% упражнений программы',   c: x => x.donePrograms >= 1 },
  { id: 'menu',    e: '🍽️', t: 'Вкусно и точка',   d: 'Заглянула в питание',           c: x => x.menuSeen },
  { id: 'week7',   e: '📅', t: 'Неделя с нами',    d: '7 дней после регистрации',      c: x => x.days >= 7 },
  { id: 'vip',     e: '👑', t: 'VIP',              d: 'Активен VIP-пакет',             c: x => x.packId === 'vip' },
];

async function evalAchieves() {
  const stats = await api('/api/stats');
  const p = getProfile();
  const ctx = {
    ...stats,
    weights: p?.weights || [],
    dW: p?.weights?.length > 1
      ? Math.abs(p.weights[p.weights.length - 1].w - p.weights[0].w) : 0,
    days: p ? Math.max(0, Math.floor((Date.now() - Date.parse(p.since)) / 864e5)) : 0,
    packId: p && !getPack(p).expired ? p.pack.id : null,
    menuSeen: !!ls.get('menuSeen'),
  };
  return ACHIEVES.map(a => ({ ...a, on: !!p && !!a.c(ctx) }));
}

// Тост при новой разблокировке; открытые храним в ls('ach'), чтобы не спамить
async function checkUnlocks() {
  if (!getProfile()) return;
  const got = new Set(ls.get('ach', []));
  const fresh = (await evalAchieves()).filter(a => a.on && !got.has(a.id));
  if (!fresh.length) return;
  ls.set('ach', [...got, ...fresh.map(a => a.id)]);
  toast(`${fresh[0].e} Ачивка: ${fresh[0].t}${fresh.length > 1 ? ` и ещё ${fresh.length - 1}` : ''}`);
}

// ---------- Мой профиль ----------
let wFormOpen = false; // форма «Внести данные» — держим открытой между рендерами
let pFormOpen = false; // форма «Изменить имя/возраст» — то же

async function viewProfile() {
  const p = getProfile();
  const last = p.weights[p.weights.length - 1];
  const first = p.weights[0];
  const diff = last && first ? +(last.w - first.w).toFixed(1) : 0;
  const diffTxt = diff < 0 ? `${diff}` : diff > 0 ? `+${diff}` : '±0';
  const today = new Date().toISOString().slice(0, 10);
  $app.innerHTML = `
    <h2 class="sec">График веса</h2>
    <div class="card chart-card">
      ${last
        ? `<div class="s start-line">Старт: ${first.w} кг · ${fmtDate(first.d)} · дельта ${diffTxt} кг</div>${chartHtml(p.weights)}`
        : '<div class="s">Записей нет — внеси первый вес</div>'}
    </div>
    <button class="btn ghost" id="w-toggle">${wFormOpen ? 'Скрыть' : 'Внести данные'}</button>
    <div class="card form" id="w-form" style="display:${wFormOpen ? '' : 'none'}">
      <label>Дата<input id="new-date" type="date" max="${today}" value="${today}"></label>
      <label>Вес, кг<input id="new-weight" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="${last?.w ?? ''}"></label>
      <div class="err" id="w-err"></div>
      <button class="btn" id="add-w">Сохранить</button>
      <div id="w-list"></div>
    </div>
    <button class="btn ghost" id="p-toggle">${pFormOpen ? 'Скрыть' : 'Изменить имя/возраст'}</button>
    <div class="card form" id="p-form" style="display:${pFormOpen ? '' : 'none'}">
      <label>Имя<input id="p-name" type="text" value="${esc(p.name)}"></label>
      <div class="err" id="e-pname"></div>
      <label>Возраст<input id="p-age" type="number" inputmode="numeric" min="14" max="99" value="${p.age}"></label>
      <div class="err" id="e-page"></div>
      <button class="btn" id="p-save">Сохранить</button>
    </div>
    <div class="s" style="margin:14px 0 6px">Тема</div>
    <div class="frow" id="t-chips"></div>
    <h2 class="sec">Достижения <span id="ach-count"></span></h2>
    <div class="ach-grid" id="ach-grid"></div>`;
  // выбор темы: авто = следует за Telegram, тёмная/светлая — принудительно
  const cur = ls.get('theme', 'auto');
  for (const [id, t] of [['auto', 'Авто'], ['dark', 'Тёмная'], ['light', 'Светлая']]) {
    const b = document.createElement('button');
    b.className = 'chip' + (cur === id ? ' active' : '');
    b.textContent = t;
    b.onclick = () => { ls.set('theme', id); applyTheme(); render(); };
    $app.querySelector('#t-chips').appendChild(b);
  }
  // сетка ачивок: открытые цветные, закрытые — приглушённые с условием
  const ach = await evalAchieves();
  const $ag = $app.querySelector('#ach-grid');
  $app.querySelector('#ach-count').textContent = `· ${ach.filter(a => a.on).length}/${ach.length}`;
  for (const a of ach) {
    const el = document.createElement('div');
    el.className = 'ach' + (a.on ? ' on' : '');
    el.innerHTML = `<div class="ach-e">${a.e}</div><div class="ach-t">${a.t}</div><div class="ach-d">${a.d}</div>`;
    $ag.appendChild(el);
  }
  $app.querySelector('#p-toggle').onclick = () => {
    pFormOpen = !pFormOpen;
    $app.querySelector('#p-form').style.display = pFormOpen ? '' : 'none';
    $app.querySelector('#p-toggle').textContent = pFormOpen ? 'Скрыть' : 'Изменить имя/возраст';
  };
  $app.querySelector('#p-save').onclick = () => {
    const name = $app.querySelector('#p-name').value.trim();
    const age = parseInt($app.querySelector('#p-age').value) || 0;
    $app.querySelector('#e-pname').textContent = name ? '' : 'Как тебя зовут?';
    $app.querySelector('#e-page').textContent = age >= 14 && age <= 99 ? '' : 'Возраст от 14 до 99';
    if (!name || age < 14 || age > 99) {
      tg?.HapticFeedback?.notificationOccurred('error');
      return;
    }
    const pr = getProfile();
    pr.name = name; pr.age = age;
    ls.set('profile', pr);
    tg?.HapticFeedback?.notificationOccurred('success');
    toast('Сохранено');
    renderHead();
    render();
  };
  const $wl = $app.querySelector('#w-list');
  for (const e of [...p.weights].reverse().slice(0, 7)) {
    const row = document.createElement('div');
    row.className = 'wrow';
    row.innerHTML = `<span>${fmtDate(e.d)}</span><b>${e.w} кг</b><button class="wdel" title="Удалить запись">×</button>`;
    row.querySelector('.wdel').onclick = () => {
      delWeight(e.d);
      tg?.HapticFeedback?.impactOccurred('light');
      renderHead();
      render();
    };
    $wl.appendChild(row);
  }
  $app.querySelector('#w-toggle').onclick = () => {
    wFormOpen = !wFormOpen;
    $app.querySelector('#w-form').style.display = wFormOpen ? '' : 'none';
    $app.querySelector('#w-toggle').textContent = wFormOpen ? 'Скрыть' : 'Внести данные';
  };
  $app.querySelector('#add-w').onclick = () => {
    const w = parseFloat($app.querySelector('#new-weight').value);
    const d = $app.querySelector('#new-date').value;
    if (!(w >= 30 && w <= 300)) {
      $app.querySelector('#w-err').textContent = 'Вес должен быть от 30 до 300 кг.';
      tg?.HapticFeedback?.notificationOccurred('error');
      return;
    }
    if (!d || d > today) { // руками можно ввести дату «в будущее» мимо max
      $app.querySelector('#w-err').textContent = 'Дата не позже сегодняшней.';
      tg?.HapticFeedback?.notificationOccurred('error');
      return;
    }
    $app.querySelector('#add-w').disabled = true;
    saveWeight(w, d);
    tg?.HapticFeedback?.notificationOccurred('success');
    toast('Сохранено');
    checkUnlocks();
    renderHead();
    render();
  };
}

// SVG-график изменения веса (x — по реальным датам, не по индексам)
function chartHtml(weights) {
  const W = 320, H = 160, PL = 38, PR = 12, PT = 16, PB = 24;
  const ws = weights.map(x => x.w);
  const pad = ws.length > 1 ? Math.max(0.5, (Math.max(...ws) - Math.min(...ws)) * 0.15) : 1;
  const min = Math.min(...ws) - pad, max = Math.max(...ws) + pad;
  const n = weights.length;
  const d0 = Date.parse(weights[0].d), d1 = Date.parse(weights[n - 1].d);
  const x = i => (n === 1 || d1 === d0)
    ? (PL + W - PR) / 2
    : PL + ((Date.parse(weights[i].d) - d0) / (d1 - d0)) * (W - PL - PR);
  const y = w => PT + ((max - w) * (H - PT - PB)) / (max - min);

  const grid = [min + pad, max - pad].map(v =>
    `<line x1="${PL}" y1="${y(v)}" x2="${W - PR}" y2="${y(v)}" class="grid"/>
     <text x="${PL - 6}" y="${y(v) + 4}" class="lbl" text-anchor="end">${+v.toFixed(1)}</text>`).join('');

  const pts = weights.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
  // подписи дат прореживаем — иначе при 15+ точках налезают друг на друга
  const lblStep = Math.ceil(n / 7);
  const dots = weights.map((p, i) =>
    `<circle cx="${x(i)}" cy="${y(p.w)}" r="3.5" class="dot"/>` +
    (i % lblStep === 0 || i === n - 1
      ? `<text x="${x(i)}" y="${H - 6}" class="lbl" text-anchor="middle">${fmtShort(p.d)}</text>` : '')
  ).join('');

  // значения веса у первой и последней точки
  const valAt = i =>
    `<text x="${x(i)}" y="${Math.max(10, y(weights[i].w) - 8)}" class="lbl val" text-anchor="middle">${weights[i].w}</text>`;
  const vals = n === 1 ? valAt(0) : valAt(0) + valAt(n - 1);

  return `<svg viewBox="0 0 ${W} ${H}" class="chart">
    ${grid}
    ${n > 1 ? `<polyline points="${pts}" class="line"/>` : ''}
    ${dots}
    ${vals}
    ${n === 1 ? `<text x="${W / 2}" y="${PT + 10}" class="lbl" text-anchor="middle">Первая запись — продолжай взвешиваться</text>` : ''}
  </svg>`;
}

const esc = s => String(s).replace(/[<>&"]/g, '');
const fmtDate = iso => new Date(iso).toLocaleDateString('ru');
const fmtShort = iso => new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'numeric' });

function videoHtml(url) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]+)/);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe>`;
  return `<video src="${url}" controls playsinline></video>`;
}

function formatSets(sets) {
  // «—×12» для упражнений со своим весом вместо «0×12»
  return (sets || []).map(s => `${s.w || '—'}×${s.r}`).join(' · ');
}

// ---------- render ----------
async function render() {
  renderHead();
  renderTabs();
  // системная кнопка «назад» Telegram на вложенных экранах
  if (tg?.BackButton) stack.length > 1 ? tg.BackButton.show() : tg.BackButton.hide();
  const s = stack[stack.length - 1];
  try {
    if (s.view === 'programs') await viewPrograms();
    else if (s.view === 'program') await viewProgram(s);
    else if (s.view === 'week') await viewWeek(s);
    else if (s.view === 'workout') await viewWorkout(s);
    else if (s.view === 'menus') await viewMenus();
    else if (s.view === 'menu') await viewMenu(s);
    else if (s.view === 'profile') await viewProfile();
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="empty">Не удалось загрузить данные — проверь соединение.</div>
      <button class="btn" id="retry">Повторить</button>`;
    $app.querySelector('#retry').onclick = () => render();
  }
  window.scrollTo(0, s.scroll || 0); // возвращаемся туда, где остановились
}

// ---------- init ----------
(async () => {
  api('/api/me', { method: 'POST', body: '{}' }); // регистрация в базе аккаунтов
  if (!getProfile()) viewOnboarding();
  else { renderHead(); render(); }
})();
