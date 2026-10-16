// Автотуннель для разработки: держит ssh -R к localhost.run,
// при обрыве переподнимает, ловит новый домен, обновляет .env
// и перевешивает кнопку меню в боте.
// Запуск: node server/tunnel.js
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ENV_FILE = path.join(__dirname, '..', '.env');

function setMenuButton(url) {
  const token = process.env.BOT_TOKEN;
  if (!token) return;
  fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_button: { type: 'web_app', text: 'Тренировки', web_app: { url } } }),
  })
    .then(r => r.json())
    .then(r => console.log(r.ok ? 'Menu button -> ' + url : 'Menu button error: ' + JSON.stringify(r)))
    .catch(e => console.error('Menu button error:', e.message));
}

function updateEnv(url) {
  let env = fs.readFileSync(ENV_FILE, 'utf8');
  env = env.replace(/^WEBAPP_URL=.*$/m, 'WEBAPP_URL=' + url);
  fs.writeFileSync(ENV_FILE, env);
  console.log('.env updated: WEBAPP_URL=' + url);
}

function startTunnel() {
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=2',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', `80:localhost:${PORT}`,
    'nokey@localhost.run',
  ]);

  ssh.stdout.on('data', chunk => {
    const text = chunk.toString();
    const m = text.match(/https:\/\/[\w.-]+\.lhr\.life/);
    if (m) {
      const url = m[0];
      if (url !== process.env.WEBAPP_URL) {
        process.env.WEBAPP_URL = url;
        updateEnv(url);
        setMenuButton(url);
      }
    }
    process.stdout.write(text);
  });
  ssh.stderr.on('data', d => process.stderr.write(d));
  ssh.on('exit', code => {
    console.log(`\n[tunnel] ssh exited (${code}), переподключаю через 3 сек...`);
    setTimeout(startTunnel, 3000);
  });
}

startTunnel();
