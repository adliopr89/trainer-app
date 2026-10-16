const tg = window.Telegram?.WebApp;
tg?.expand();
tg?.ready();

const INIT_DATA = tg?.initData || '';

const fetchApi = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { 'x-tg-init-data': INIT_DATA, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(r => r.json());

// --- localStorage ---
const ls = {
  get(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

// --- Локальный режим (статический хостинг): данные из window.APP_DATA, логи в localStorage ---
function localApi(path, opts = {}) {
  const D = window.APP_DATA;
  const logs = ls.get('logs', {});
  const since = ls.get('profile')?.since || new Date().toISOString().slice(0, 10);
  const weekNumOf = total =>
    Math.min(Math.max(Math.floor((Date.now() - Date.parse(since)) / 6048e5) + 1, 1), total);
  const opensIn = num =>
    Math.max(0, Math.ceil((Date.parse(since) + (num - 1) * 7 * 864e5 - Date.now()) / 864e5));

  if (path === '/api/programs') {
    return Promise.resolve(D.programs.map(p => ({
      id: p.id, title: p.title, desc: p.desc,
      level: p.level, packs: p.packs, group: p.group,
      weeks: p.weeks.length,
    })));
  }
  if (path === '/api/groups') {
    return Promise.resolve(D.groups);
  }
  if (path === '/api/menus') {
    return Promise.resolve(D.menus.map(m => ({ id: m.id, title: m.title, desc: m.desc })));
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
    logs[exerciseId] = { sets, done: !!done, date: new Date().toISOString() };
    ls.set('logs', logs);
    return Promise.resolve({ ok: true });
  }
  return Promise.resolve({ error: 'unknown endpoint' });
}

const api = window.APP_DATA ? localApi : fetchApi;

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
  return { ...PACKS[p.pack.id], until: p.pack.until };
}



function saveWeight(w, d) {
  const p = getProfile();
  const ex = p.weights.find(x => x.d === d);
  if (ex) ex.w = w; // одна запись на дату — перезаписываем
  else p.weights.push({ d, w });
  p.weights.sort((a, b) => (a.d < b.d ? -1 : 1));
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
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = Math.ceil((Date.parse(pack.until) - Date.parse(today)) / 864e5);
  const leftTxt = daysLeft > 0 ? `${daysLeft} дн.` : daysLeft === 0 ? 'последний день' : 'истёк';
  const ava = tg?.initDataUnsafe?.user?.photo_url;
  const initial = (p.name.trim()[0] || '?').toUpperCase();
  $head.innerHTML = `
    <button class="h-pack">${pack.emoji} ${pack.title}<span> · ${leftTxt}</span></button>
    <button class="h-prof">Профиль</button>
    <div class="h-name">${p.name}, ${p.age}</div>
    <div class="h-weight">${last.w}<small> кг</small></div>
    <div class="h-ava">${ava ? `<img src="${ava}" alt="">` : initial}</div>`;
  const toProfile = () => { tab = 'profile'; stack = [{ view: 'profile' }]; render(); };
  $head.querySelector('.h-pack').onclick = toProfile;
  $head.querySelector('.h-prof').onclick = toProfile;
}

// ---------- навигация ----------
const TABS = [
  { id: 'programs', title: 'Программы' },
  { id: 'nutrition', title: 'Питание' },
  { id: 'profile', title: 'Мой профиль' },
];
let tab = 'programs';
// stack: [{view:'programs'|'program'|'week'|'workout'|'menus'|'menu'|'profile', ...}]
let stack = [{ view: 'programs' }];
const nav = s => { stack.push(s); render(); };
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
      <label>Имя<input id="f-name" type="text" placeholder="Как тебя зовут"></label>
      <label>Возраст<input id="f-age" type="number" inputmode="numeric" min="14" max="99" placeholder="30"></label>
      <label>Вес, кг<input id="f-weight" type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="65"></label>
      <div class="err" id="f-err"></div>
      <button class="btn" id="f-go">Начать</button>
    </div>`;
  $app.querySelector('#f-go').onclick = () => {
    const name = $app.querySelector('#f-name').value.trim();
    const age = parseInt($app.querySelector('#f-age').value) || 0;
    const w = parseFloat($app.querySelector('#f-weight').value) || 0;
    if (!name || age < 14 || age > 99 || w < 30 || w > 300) {
      $app.querySelector('#f-err').textContent = 'Проверь данные: имя, возраст 14–99, вес 30–300 кг.';
      tg?.HapticFeedback?.notificationOccurred('error');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    ls.set('profile', {
      name, age, since: today,
      weights: [{ d: today, w }],
      pack: { id: 'start', until: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) },
    });
    tg?.HapticFeedback?.notificationOccurred('success');
    $tabs.style.display = '';
    document.body.classList.remove('nohead');
    renderHead();
    render();
  };
}

// ---------- Программы ----------
// фильтры: пакет · «доступное мне» · группа тренировок
const F = { pack: 'all', onlyMine: false, group: 'all' };

async function viewPrograms() {
  const [programs, groups] = await Promise.all([api('/api/programs'), api('/api/groups')]);
  const myPack = getProfile()?.pack?.id;
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
    $list.innerHTML = '<div class="empty">Под эти фильтры программ нет</div>';
    return;
  }
  for (const p of list) {
    const mine = p.packs.includes(myPack);
    const packTxt = p.packs.map(id => `${PACKS[id]?.emoji || ''} ${PACKS[id]?.title || id}`).join(' · ');
    const groupTxt = groups.find(g => g.id === p.group)?.title || '';
    const el = document.createElement('div');
    el.className = 'card' + (mine ? '' : ' locked');
    el.innerHTML = `<div class="t">${p.title}${mine ? '' : ' <span class="badge lock">🔒</span>'}</div>
      <div class="meta">${p.level} · ${packTxt} · ${p.weeks} недели</div>
      <div class="s">${p.desc}</div>
      <div class="tags">${groupTxt}</div>`;
    el.onclick = mine
      ? () => nav({ view: 'program', id: p.id })
      : () => tg?.HapticFeedback?.notificationOccurred('warning');
    $list.appendChild(el);
  }
}

// экран программы = все недели видны; неделя N открывается через 7·(N−1) дней от регистрации
async function viewProgram(s) {
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
      : w.num === p.weekNum ? '<span class="badge part">текущая</span>'
      : done === total && total > 0 ? '<span class="badge done">готово</span>' : '';
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
  const p = await api(`/api/programs/${s.programId}`);
  const w = p.weeks.find(x => x.num === s.num);
  $app.innerHTML = `<button class="back">‹ Назад</button>
    <h1 class="page">${s.title} — неделя ${w.num}</h1>`;
  $app.querySelector('.back').onclick = back;
  for (const d of w.workouts) {
    const el = document.createElement('div');
    el.className = 'card';
    const badge = d.doneCount === d.total && d.total > 0 ? '<span class="badge done">готово</span>'
      : d.doneCount > 0 ? `<span class="badge part">${d.doneCount}/${d.total}</span>` : '';
    el.innerHTML = `<div class="t">Занятие ${d.num} — ${d.title} ${badge}</div>
      <div class="s">${d.total} упражнения</div>
      <div class="prog"><i style="width:${d.total ? (d.doneCount / d.total) * 100 : 0}%"></i></div>`;
    el.onclick = () => nav({ view: 'workout', id: d.id, title: `Занятие ${d.num} — ${d.title}` });
    $app.appendChild(el);
  }
}

async function viewWorkout(s) {
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
              <td><input type="number" inputmode="decimal" data-j="${j}" data-f="w" value="${sv.w ?? ''}" placeholder="${e.weight || 0}"></td>
              <td><input type="number" inputmode="numeric" data-j="${j}" data-f="r" value="${sv.r ?? ''}" placeholder="${e.reps || 0}"></td>
            </tr>`;
          }).join('')}
        </table>
        <button class="btn save">${saved?.done ? 'Обновить результат' : 'Отметить выполненным'}</button>
        ${saved ? `<div class="hist"><b>Последняя запись:</b><div>${formatSets(saved.sets)} · ${new Date(saved.date).toLocaleDateString('ru')}</div></div>` : ''}
      </div>`;
    // тап по шапке — разворачивает/сворачивает; клики внутри тела не сворачивают
    el.querySelector('.ex-head').onclick = ev => {
      ev.stopPropagation();
      el.classList.toggle('open');
    };
    el.querySelector('.ex-body').onclick = ev => ev.stopPropagation();
    el.querySelector('.save').onclick = async () => {
      const sets = [...el.querySelectorAll('input[data-f="w"]')].map(inp => ({
        w: parseFloat(inp.value) || 0,
        r: parseInt(el.querySelector(`input[data-j="${inp.dataset.j}"][data-f="r"]`).value) || 0,
      }));
      await api('/api/log', { method: 'POST', body: JSON.stringify({ exerciseId: e.id, sets, done: true }) });
      tg?.HapticFeedback?.notificationOccurred('success');
      render();
    };
    $app.appendChild(el);
  });
}

// ---------- Питание ----------
async function viewMenus() {
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
  const m = await api(`/api/menus/${s.id}`);
  $app.innerHTML = `<button class="back">‹ Назад</button>
    <h1 class="page">${m.title}</h1>
    <div class="lead">${m.desc}</div>`;
  $app.querySelector('.back').onclick = back;
  for (const meal of m.meals) {
    const el = document.createElement('div');
    el.className = 'card meal';
    el.innerHTML = `<div class="t">${meal.name}</div><div class="s">${meal.dish}</div>`;
    $app.appendChild(el);
  }
}

// ---------- Мой профиль ----------
async function viewProfile() {
  const p = getProfile();
  const last = p.weights[p.weights.length - 1];
  const first = p.weights[0];
  const diff = +(last.w - first.w).toFixed(1);
  const diffTxt = diff < 0 ? `${diff}` : diff > 0 ? `+${diff}` : '±0';
  const today = new Date().toISOString().slice(0, 10);
  $app.innerHTML = `
    <h2 class="sec">График веса</h2>
    <div class="card chart-card">
      <div class="s start-line">Старт: ${first.w} кг · ${fmtDate(first.d)} · дельта ${diffTxt} кг</div>
      ${chartHtml(p.weights)}
    </div>
    <button class="btn ghost" id="w-toggle">Внести данные</button>
    <div class="card form" id="w-form" style="display:none">
      <label>Дата<input id="new-date" type="date" max="${today}" value="${today}"></label>
      <label>Вес, кг<input id="new-weight" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="${last.w}"></label>
      <div class="err" id="w-err"></div>
      <button class="btn" id="add-w">Сохранить</button>
    </div>`;
  $app.querySelector('#w-toggle').onclick = () => {
    const f = $app.querySelector('#w-form');
    const open = f.style.display !== 'none';
    f.style.display = open ? 'none' : '';
    $app.querySelector('#w-toggle').textContent = open ? 'Внести данные' : 'Скрыть';
  };
  $app.querySelector('#add-w').onclick = () => {
    const w = parseFloat($app.querySelector('#new-weight').value);
    const d = $app.querySelector('#new-date').value;
    if (!(w >= 30 && w <= 300)) {
      $app.querySelector('#w-err').textContent = 'Вес должен быть от 30 до 300 кг.';
      tg?.HapticFeedback?.notificationOccurred('error');
      return;
    }
    if (!d) {
      $app.querySelector('#w-err').textContent = 'Выбери дату.';
      tg?.HapticFeedback?.notificationOccurred('error');
      return;
    }
    saveWeight(w, d);
    tg?.HapticFeedback?.notificationOccurred('success');
    renderHead();
    render();
  };
}

// SVG-график изменения веса
function chartHtml(weights) {
  const W = 320, H = 160, PL = 38, PR = 12, PT = 16, PB = 24;
  const ws = weights.map(x => x.w);
  const pad = ws.length > 1 ? Math.max(0.5, (Math.max(...ws) - Math.min(...ws)) * 0.15) : 1;
  const min = Math.min(...ws) - pad, max = Math.max(...ws) + pad;
  const n = weights.length;
  const x = i => n === 1 ? (PL + W - PR) / 2 : PL + (i * (W - PL - PR)) / (n - 1);
  const y = w => PT + ((max - w) * (H - PT - PB)) / (max - min);

  const grid = [min + pad, max - pad].map(v =>
    `<line x1="${PL}" y1="${y(v)}" x2="${W - PR}" y2="${y(v)}" class="grid"/>
     <text x="${PL - 6}" y="${y(v) + 4}" class="lbl" text-anchor="end">${+v.toFixed(1)}</text>`).join('');

  const pts = weights.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
  const dots = weights.map((p, i) =>
    `<circle cx="${x(i)}" cy="${y(p.w)}" r="3.5" class="dot"/>
     <text x="${x(i)}" y="${H - 6}" class="lbl" text-anchor="middle">${fmtShort(p.d)}</text>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="chart">
    ${grid}
    ${n > 1 ? `<polyline points="${pts}" class="line"/>` : ''}
    ${dots}
    ${n === 1 ? `<text x="${W / 2}" y="${PT + 10}" class="lbl" text-anchor="middle">Первая запись — продолжай взвешиваться</text>` : ''}
  </svg>`;
}

const fmtDate = iso => new Date(iso).toLocaleDateString('ru');
const fmtShort = iso => new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'numeric' });

function videoHtml(url) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]+)/);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe>`;
  return `<video src="${url}" controls playsinline></video>`;
}

function formatSets(sets) {
  return (sets || []).map(s => `${s.w}×${s.r}`).join(' · ');
}

// ---------- render ----------
async function render() {
  renderHead();
  renderTabs();
  const s = stack[stack.length - 1];
  if (s.view === 'programs') await viewPrograms();
  else if (s.view === 'program') await viewProgram(s);
  else if (s.view === 'week') await viewWeek(s);
  else if (s.view === 'workout') await viewWorkout(s);
  else if (s.view === 'menus') await viewMenus();
  else if (s.view === 'menu') await viewMenu(s);
  else if (s.view === 'profile') await viewProfile();
}

// ---------- init ----------
(async () => {
  api('/api/me', { method: 'POST', body: '{}' }); // регистрация в базе аккаунтов
  if (!getProfile()) viewOnboarding();
  else { renderHead(); render(); }
})();
