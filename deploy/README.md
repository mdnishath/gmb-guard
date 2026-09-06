# Deploying on an Ubuntu VPS

The app is a single Next.js process with a SQLite file database. No database
server. The daily check is driven by a system crontab hitting the secured
`/api/cron/check-gmb` endpoint.

## First time

```bash
# as root on the server
sudo bash deploy/setup-ubuntu.sh            # Node 20, PM2, nginx, build tools

# copy the project
sudo mkdir -p /var/www/gmb-tracker && sudo chown $USER /var/www/gmb-tracker
git clone <repo> /var/www/gmb-tracker     # or rsync from your machine
cd /var/www/gmb-tracker

cp .env.example .env && nano .env         # GOOGLE_PLACES_API_KEY, CRON_SECRET, Telegram/Resend, APP_URL

bash deploy/deploy.sh                     # npm install → next build → pm2
bash deploy/install-cron.sh               # crontab: 0 3 * * * curl .../api/cron/check-gmb

sudo cp deploy/nginx.conf /etc/nginx/sites-available/gmb-tracker
sudo nano /etc/nginx/sites-available/gmb-tracker    # set server_name
sudo ln -s /etc/nginx/sites-available/gmb-tracker /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d gmb.yourdomain.com

pm2 startup   # follow the printed command once so PM2 survives reboots
```

## Every update

```bash
cd /var/www/gmb-tracker && bash deploy/deploy.sh
```

## Useful

```bash
pm2 logs gmb-tracker            # app logs
tail -f logs/cron.log           # daily check output
curl -sS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/check-gmb   # run check now
sqlite3 data/gmb.sqlite '.tables'                                                           # inspect DB
cp data/gmb.sqlite backups/gmb-$(date +%F).sqlite                                           # backup
```

## Notes

- `DATABASE_PATH` defaults to `./data/gmb.sqlite` relative to the project. Keep
  the `data/` folder out of git and back it up (a nightly `cp` is enough).
- `GMB_CHECK_CONCURRENCY=10` is fine for 200–500 listings (~15–40s per run).
- The app has no login. Put it behind nginx basic auth or a VPN before exposing
  it publicly:
  `sudo apt install apache2-utils && sudo htpasswd -c /etc/nginx/.htpasswd admin`
  then add `auth_basic "GMB Guard"; auth_basic_user_file /etc/nginx/.htpasswd;`
  inside the `location /` block (leave `/api/cron/` open, it has its own secret).
