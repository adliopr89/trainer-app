// smoke.mjs — e2e-тест Mini App «Онлайн тренер» в отладочном Chrome (порт 9222).
//
//   node app/test/smoke.mjs
//
// Что делает: поднимает docs/ на :8094, открывает вкладку в отладочном Chrome
// и прогоняет сценарий: онбординг → программы (фильтры) → неделя → занятие →
// лог упражнения → профиль (вес: добавление и удаление) → питание.
// Перед запуском нужен отладочный Chrome: chrome.exe --remote-debugging-port=9222
// --user-data-dir=%LOCALAPPDATA%\Temp\chrome-debug

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs');
const PORT = 8094;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

// ---------- статический сервер docs/ ----------
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

// ---------- CDP ----------
const targets = await (await fetch('http://localhost:9222/json')).json()
  .catch(() => { console.log('ERR: отладочный Chrome не отвечает на :9222'); process.exit(1); });
const tab = await (await fetch(`http://localhost:9222/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let _id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++_id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}

let passed = 0, failed = 0;
async function check(name, expr, expect) {
  const v = await ev(expr);
  const ok = expect === undefined ? !!v : v === expect;
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} — получено: ${JSON.stringify(v)}, ждали: ${JSON.stringify(expect)}`); }
}
// ждёт, пока выражение станет truthy (до 5 сек)
async function waitFor(expr) {
  for (let i = 0; i < 25; i++) { if (await ev(expr)) return true; await sleep(200); }
  return false;
}

try {
  await send('Page.enable');
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await sleep(1200);
  await ev(`localStorage.clear()`);
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  if (!await waitFor(`!!document.querySelector('#f-go')`)) throw new Error('страница не загрузилась');

  console.log('Онбординг:');
  await check('форма онбординга', `!!document.querySelector('#f-name')`, true);
  await ev(`document.querySelector('#f-go').click()`); // пустая форма → ошибки по полям
  await check('ошибка у поля имени', `document.querySelector('#e-name').textContent.length > 0`, true);
  await check('поле имени подсвечено', `document.querySelector('#f-name').classList.contains('bad')`, true);
  await ev(`
    document.querySelector('#f-name').value = 'Тест';
    document.querySelector('#f-age').value = '30';
    document.querySelector('#f-weight').value = '60';
    document.querySelector('#f-go').click();
  `);
  await waitFor(`!!document.querySelector('.h-pack')`);
  await check('шапка с пакетом', `document.querySelector('.h-pack').textContent.includes('Старт')`, true);
  await check('вес в шапке', `document.querySelector('.h-weight').textContent.trim()`, '60 кг');

  console.log('Программы:');
  await check('«Доступное мне» включено', `document.querySelector('#f-mine').checked`, true);
  await check('доступна 1 программа (Старт)', `document.querySelectorAll('#plist .card').length`, 1);
  await ev(`document.querySelector('#f-mine').click()`);
  await waitFor(`document.querySelectorAll('#plist .card').length === 2`);
  await check('без фильтра — 2 программы', `document.querySelectorAll('#plist .card').length`, 2);
  await check('«Крепкий орех» закрыт замком', `[...document.querySelectorAll('#plist .card')].some(c => c.classList.contains('locked'))`, true);
  await check('прогресс на карточке', `!!document.querySelector('#plist .card .prog')`, true);
  // фильтр группы «Формы» → остаётся только Крепкий орех
  await ev(`[...document.querySelectorAll('#f-groups .chip')].find(c => c.textContent === 'Формы').click()`);
  await waitFor(`document.querySelectorAll('#plist .card').length === 1`);
  await check('фильтр группы «Формы»', `document.querySelector('#plist .card .t').textContent.includes('Крепкий орех')`, true);
  await ev(`[...document.querySelectorAll('#f-groups .chip')].find(c => c.textContent === 'Все').click()`);
  await sleep(400);

  console.log('Программа → неделя → занятие:');
  await ev(`[...document.querySelectorAll('#plist .card')].find(c => c.textContent.includes('Хуяе как худею')).click()`);
  await waitFor(`document.querySelectorAll('.card').length === 4`);
  await check('видны все 4 недели', `document.querySelectorAll('.card').length`, 4);
  await check('неделя 2 закрыта', `[...document.querySelectorAll('.card')].some(c => c.classList.contains('locked'))`, true);
  await check('в неделе 1 — 4 занятия', `document.querySelector('.card .s').textContent.includes('4 занятий')`, true);
  await ev(`document.querySelector('.card:not(.locked)').click()`);
  await waitFor(`document.querySelectorAll('.card').length === 4`);
  await check('«следующее» занятие помечено', `document.querySelector('.badge.part').textContent`, 'следующее');
  await ev(`document.querySelectorAll('.card')[0].click()`);
  await waitFor(`document.querySelectorAll('.card.ex').length === 3`);

  console.log('Упражнение:');
  await ev(`document.querySelector('.card.ex .ex-head').click()`);
  await ev(`document.querySelector('.card.ex input[data-f="w"]').value = '20'; document.querySelector('.card.ex input[data-f="r"]').value = '12';`);
  await ev(`document.querySelector('.card.ex .save').click()`);
  await waitFor(`!!document.querySelector('.badge.done')`);
  await check('упражнение отмечено', `!!document.querySelector('.badge.done')`, true);
  await check('автопереход: 2-е упражнение раскрыто', `document.querySelectorAll('.card.ex')[1].classList.contains('open')`, true);
  await ev(`document.querySelectorAll('.card.ex')[0].querySelector('.ex-head').click()`);
  await sleep(300);
  await check('карточка раскрылась, запись на месте', `document.querySelectorAll('.card.ex')[0].querySelector('.hist').textContent.includes('20×12')`, true);

  console.log('Профиль:');
  await ev(`document.querySelector('.h-pack').click()`);
  await waitFor(`!!document.querySelector('.chart')`);
  await check('клик по пакету → профиль, график есть', `!!document.querySelector('.chart')`, true);
  await check('метки значений на графике', `document.querySelectorAll('.lbl.val').length >= 1`, true);
  await ev(`document.querySelector('#w-toggle').click()`);
  await ev(`
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10); // вчера — иначе перезапишет сегодняшнюю запись
    document.querySelector('#new-date').value = y;
    document.querySelector('#new-weight').value = '59.5';
    document.querySelector('#add-w').click();
  `);
  await waitFor(`document.querySelectorAll('.wrow').length === 2`);
  await check('вес сохранён, строки в списке', `document.querySelectorAll('.wrow').length`, 2);
  await check('вес в шапке обновился', `document.querySelector('.h-weight').textContent.trim()`, '60 кг');
  await ev(`document.querySelectorAll('.wrow')[0].querySelector('.wdel').click()`);
  await waitFor(`document.querySelectorAll('.wrow').length === 1`);
  await check('запись веса удалена', `document.querySelectorAll('.wrow').length`, 1);
  await check('вес в шапке откатился на вчерашний', `document.querySelector('.h-weight').textContent.trim()`, '59.5 кг');

  console.log('Питание:');
  await ev(`[...document.querySelectorAll('#tabs button')].find(b => b.textContent === 'Питание').click()`);
  await waitFor(`document.querySelectorAll('.card').length === 3`);
  await ev(`document.querySelectorAll('.card')[0].click()`);
  await waitFor(`!!document.querySelector('.meal .kcal')`);
  await check('ккал у приёмов пищи', `document.querySelectorAll('.meal .kcal').length`, 5);
  await check('КБЖУ меню', `document.querySelector('.lead').textContent.includes('Б 110')`, true);

  console.log('Навигация «назад»:');
  await ev(`document.querySelector('.back').click()`);
  await sleep(400);
  await check('вернулись в список меню', `document.querySelectorAll('.card').length`, 3);
} catch (e) {
  failed++;
  console.log('  ✗ ОШИБКА:', e.message);
}

console.log(`\n${failed ? `ПРОВАЛЕНО: ${failed}` : 'Все проверки пройдены'} (${passed} ок)`);
ws.close();
await fetch(`http://localhost:9222/json/close/${tab.id}`).catch(() => {});
server.close();
process.exit(failed ? 1 : 0);
