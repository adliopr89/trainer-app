// Сборка статической версии Mini App в docs/ (для GitHub Pages).
// Зашивает данные из db.js в data.js + копирует webapp-файлы.
// Запуск: node server/build-static.js
const fs = require('fs');
const path = require('path');
const { WEEKDAYS, WEEKDAYS_FULL, MONTHS_RU, PROGRAMS, MENUS, GROUPS } = require('./db');

const OUT = path.join(__dirname, '..', '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

const data = {
  weekdays: WEEKDAYS,
  weekdaysFull: WEEKDAYS_FULL,
  months: MONTHS_RU,
  programs: PROGRAMS,
  menus: MENUS,
  groups: GROUPS,
};

fs.writeFileSync(path.join(OUT, 'data.js'), 'window.APP_DATA=' + JSON.stringify(data) + ';');

// index.html: инжектим ?v=<сборка> в ссылки на ассеты — иначе вебвью ТГ/браузер
// может долго отдавать старый app.js из кэша после выкладки на Pages.
const v = Date.now().toString(36);
const html = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'index.html'), 'utf8')
  .replace('<script src="app.js"></script>',
    `<script src="data.js?v=${v}"></script>\n<script src="app.js?v=${v}"></script>`)
  .replace('style.css', `style.css?v=${v}`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

for (const f of ['app.js', 'style.css']) {
  fs.copyFileSync(path.join(__dirname, '..', 'webapp', f), path.join(OUT, f));
}

console.log('docs/ собран: data.js + index.html + app.js + style.css');
