const tg = window.Telegram?.WebApp;
tg?.expand();
tg?.ready();

const INIT_DATA = tg?.initData || '';

const fetchApi = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { 'x-tg-init-data': INIT_DATA, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  }).then(r => r.json());

// --- Локальный режим (статический хостинг): данные из window.APP_DATA, логи в localStorage ---
function localLogs() {
  try { return JSON.parse(localStorage.getItem('logs') || '{}'); } catch { return {}; }
}

function localApi(path, opts = {}) {
  const D = window.APP_DATA;
  const logs = localLogs();
  const today = ((new Date().getDay() + 6) % 7) + 1;
  const weekNum = Math.min(Math.floor((new Date().getDate() - 1) / 7) + 1, 4);

  if (path === '/api/levels') {
    return Promise.resolve(D.levels.map(l => ({
      ...l,
      programs: D.programs.filter(p => p.levelId === l.id)
        .map(p => ({ id: p.id, title: p.title, weeks: p.weeks.length })),
    })));
  }
  if (path.startsWith('/api/programs/')) {
    const p = D.programs.find(x => x.id === path.split('/').pop());
    if (!p) return Promise.resolve({ error: 'not found' });
    return Promise.resolve({
      id: p.id, title: D.months[new Date().getMonth()],
      weekNum, totalWeeks: p.weeks.length, today,
      weeks: p.weeks.map(w => ({
        num: w.num,
        locked: w.num > weekNum,
        days: w.workouts.map(wo => ({
          id: wo.id, weekday: wo.weekday,
          weekdayName: D.weekdaysFull[wo.weekday - 1],
          title: wo.title,
          locked: w.num > weekNum || (w.num === weekNum && wo.weekday > today),
          opensIn: wo.weekday - today,
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
    localStorage.setItem('logs', JSON.stringify(logs));
    return Promise.resolve({ ok: true });
  }
  return Promise.resolve({ error: 'unknown endpoint' });
}

const api = window.APP_DATA ? localApi : fetchApi;

const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');

let LEVELS = [];
let levelId = null;

// ---------- навигация ----------
// stack: [{view:'programs'|'program'|'workout'|'exercise', ...}]
let stack = [{ view: 'programs' }];
const nav = s => { stack.push(s); render(); };
const back = () => { stack.pop(); render(); };

// ---------- табы уровней ----------
function renderTabs() {
  $tabs.innerHTML = '';
  for (const l of LEVELS) {
    const b = document.createElement('button');
    b.textContent = l.title;
    b.className = l.id === levelId ? 'active' : '';
    b.onclick = () => { levelId = l.id; stack = [{ view: 'programs' }]; render(); };
    $tabs.appendChild(b);
  }
}

// ---------- экраны ----------
async function viewPrograms() {
  const level = LEVELS.find(l => l.id === levelId);
  $app.innerHTML = `<h1 class="page">${level.title}</h1><h2 class="sec">Программа</h2>`;
  for (const p of level.programs) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="t">Программа месяца</div><div class="s">${p.weeks} недели</div>`;
    el.onclick = () => nav({ view: 'program', id: p.id });
    $app.appendChild(el);
  }
}

// экран программы = текущий месяц, недели 1–4 (будущие заблокированы)
async function viewProgram(s) {
  const p = await api(`/api/programs/${s.id}`);
  $app.innerHTML = `<button class="back">‹ Назад</button>
    <h1 class="page">${p.title}</h1>
    <h2 class="sec">Сейчас идёт неделя ${p.weekNum} из ${p.totalWeeks}</h2>`;
  $app.querySelector('.back').onclick = back;
  for (const w of p.weeks) {
    const el = document.createElement('div');
    el.className = 'card' + (w.locked ? ' locked' : '');
    const done = w.days.reduce((a, d) => a + d.doneCount, 0);
    const total = w.days.reduce((a, d) => a + d.total, 0);
    const badge = w.locked ? '<span class="badge lock">🔒</span>'
      : w.num === p.weekNum ? '<span class="badge part">текущая</span>'
      : done === total && total > 0 ? '<span class="badge done">готово</span>' : '';
    el.innerHTML = `<div class="t">Неделя ${w.num} ${badge}</div>
      <div class="s">${w.locked ? 'Откроется позже' : `${done}/${total} упражнений`}</div>
      <div class="prog"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>`;
    el.onclick = w.locked
      ? () => tg?.HapticFeedback?.notificationOccurred('warning')
      : () => nav({ view: 'week', programId: p.id, num: w.num, isCurrent: w.num === p.weekNum });
    $app.appendChild(el);
  }
}

// экран недели = дни Пн–Вс (в текущей неделе будущие дни заблокированы)
async function viewWeek(s) {
  const p = await api(`/api/programs/${s.programId}`);
  const w = p.weeks.find(x => x.num === s.num);
  $app.innerHTML = `<button class="back">‹ Назад</button>
    <h1 class="page">${p.title} — неделя ${w.num}</h1>`;
  $app.querySelector('.back').onclick = back;
  for (const d of w.days) {
    const el = document.createElement('div');
    el.className = 'card' + (d.locked ? ' locked' : '');
    if (d.locked) {
      const when = d.opensIn === 1 ? 'завтра' : `через ${d.opensIn} дн.`;
      el.innerHTML = `<div class="t">${d.weekdayName} — ${d.title} <span class="badge lock">🔒</span></div>
        <div class="s">Откроется ${when}</div>`;
      el.onclick = () => tg?.HapticFeedback?.notificationOccurred('warning');
    } else {
      const badge = d.doneCount === d.total && d.total > 0 ? '<span class="badge done">готово</span>'
        : d.doneCount > 0 ? `<span class="badge part">${d.doneCount}/${d.total}</span>`
        : s.isCurrent && d.weekday === p.today ? '<span class="badge part">сегодня</span>' : '';
      el.innerHTML = `<div class="t">${d.weekdayName} — ${d.title} ${badge}</div>
        <div class="s">${d.total} упражнения</div>
        <div class="prog"><i style="width:${d.total ? (d.doneCount / d.total) * 100 : 0}%"></i></div>`;
      el.onclick = () => nav({ view: 'workout', id: d.id, title: `${d.weekdayName} — ${d.title}` });
    }
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
  renderTabs();
  const s = stack[stack.length - 1];
  if (s.view === 'programs') await viewPrograms();
  else if (s.view === 'program') await viewProgram(s);
  else if (s.view === 'week') await viewWeek(s);
  else if (s.view === 'workout') await viewWorkout(s);
}

// ---------- init ----------
(async () => {
  LEVELS = await api('/api/levels');
  levelId = LEVELS[0]?.id;
  await render();
})();
