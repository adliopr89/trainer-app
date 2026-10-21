# Переезд на хостинг — инструкция

## Что понадобится

- VPS с Ubuntu 22.04/24.04 (Timeweb / Selectel / Beget / любой) — минимальный тариф (1 CPU / 1 ГБ) достаточно.
- Домен, привязанный к IP сервера (A-запись). Например `app.trainer.ru`. **Без домена Mini App работать не будет** — Telegram требует HTTPS.
- Доступ по SSH.

## Быстрый путь (автоматом)

1. Скопируй папку `app/` на сервер:
   ```bash
   scp -r "app" user@IP_СЕРВЕРА:~/
   ```
2. Зайди на сервер и запусти установщик:
   ```bash
   ssh user@IP_СЕРВЕРА
   cd ~/app
   sudo bash ../deploy/deploy.sh ТВОЙ_ДОМЕН BOT_TOKEN
   ```
   Скрипт поставит Node.js, зависимости, pm2 (автозапуск), nginx и бесплатный HTTPS через certbot.
3. Готово — бот сам перевесит кнопку меню на новый домен при старте.

## Ручной путь (по шагам)

### 1. Node.js и зависимости
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx
cd ~/app && npm ci --omit=dev
```

### 2. .env
```bash
cp .env.example .env
nano .env
```
```
BOT_TOKEN=токен_из_BotFather
WEBAPP_URL=https://ТВОЙ_ДОМЕН
PORT=3000
```

### 3. Автозапуск (systemd или pm2)

Вариант А — systemd (файл `trainer.service` лежит рядом):
```bash
sudo cp ../deploy/trainer.service /etc/systemd/system/
sudo systemctl enable --now trainer
```

Вариант Б — pm2:
```bash
sudo npm i -g pm2
pm2 start server/index.js --name trainer
pm2 save && pm2 startup
```

### 4. nginx + HTTPS
```bash
sudo cp ../deploy/nginx.conf /etc/nginx/sites-available/trainer
sudo nano /etc/nginx/sites-available/trainer   # замени ТВОЙ_ДОМЕН
sudo ln -s /etc/nginx/sites-available/trainer /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ТВОЙ_ДОМЕН
```

### 5. Проверка
- `https://ТВОЙ_ДОМЕН/api/levels` должен вернуть JSON.
- Перезапусти приложение — в логах будет `Menu button -> https://ТВОЙ_ДОМЕН`.
- Открой бота → кнопка «Тренировки» → Mini App.

## Перенос данных пользователей

Логи и даты старта лежат в `app/data/` (`users.json`, `logs.json`). Скопируй на сервер — прогресс пользователей сохранится:
```bash
scp -r app/data user@IP_СЕРВЕРА:~/app/
```

## После переезда

- GitHub Pages (`adliopr89.github.io/trainer-app`) можно оставить как запасной вариант или удалить — бот будет смотреть на новый домен.
- Обновление приложения: `git pull` (или scp новых файлов) → `pm2 restart trainer` / `systemctl restart trainer`.
- **Важно:** токен бота был засвечен в переписке — перед продом перегенерируй в @BotFather (`/revoke`) и обнови `.env`.

## Файлы в папке deploy/

- `deploy.sh` — автоустановка на Ubuntu (node + nginx + certbot + pm2)
- `nginx.conf` — шаблон прокси домен → localhost:3000
- `trainer.service` — systemd-юнит (альтернатива pm2)
- `DEPLOY.md` — эта инструкция
