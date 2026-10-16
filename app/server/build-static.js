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

for (const f of ['index.html', 'app.js', 'style.css']) {
  fs.copyFileSync(path.join(__dirname, '..', 'webapp', f), path.join(OUT, f));
}

console.log('docs/ собран: data.js + index.html + app.js + style.css');
