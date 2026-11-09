#!/usr/bin/env bash
# Eğitim Stüdyosu — kendi sunucuda kurulum (Ubuntu 24.04, root olarak çalıştırın)
# Kullanım: curl -fsSL https://raw.githubusercontent.com/onurcoskun616/egitimapi/main/deploy/setup.sh | bash
set -euo pipefail
APP=/srv/egitim; REPO=https://github.com/onurcoskun616/egitimapi.git; PGRST=v12.2.3
IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
SITE=${SITE:-$(echo "$IP" | tr . -).sslip.io}
say() { echo -e "\n\033[1;32m==> $*\033[0m"; }

say "Gerekli paketler"
apt-get install -y -q postgresql caddy git curl xz-utils >/dev/null
id app >/dev/null 2>&1 || useradd -m -s /bin/bash app
mkdir -p $APP/files $APP/backup && chown -R app:app $APP

say "Uygulama kodu"
if [ ! -d $APP/app/.git ]; then rm -rf $APP/app; sudo -u app git clone -q $REPO $APP/app; else sudo -u app git -C $APP/app pull -q; fi

say "Veritabanı"
sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='app'" | grep -q 1 || sudo -u postgres psql -qc "create user app"
sudo -u postgres psql -tAc "select 1 from pg_database where datname='egitim'" | grep -q 1 || sudo -u postgres psql -qc "create database egitim owner app"
sudo -u postgres psql -q -d egitim -c "create extension if not exists pgcrypto; create extension if not exists \"uuid-ossp\";"
if [ -f /root/egitim-veritabani.sql ] && [ "$(sudo -u app psql -d egitim -tAc "select to_regclass('public.projects') is not null")" != "t" ]; then
  say "Veriler yükleniyor (Supabase dışa aktarımı)"
  cp /root/egitim-veritabani.sql /tmp/egitim.sql && chown app /tmp/egitim.sql
  sudo -u app psql -q -v ON_ERROR_STOP=1 -d egitim -f /tmp/egitim.sql >/dev/null && rm -f /tmp/egitim.sql
  echo "Projeler: $(sudo -u app psql -d egitim -tAc 'select count(*) from projects')  Kullanıcılar: $(sudo -u app psql -d egitim -tAc 'select count(*) from users')"
fi

say "PostgREST ($PGRST)"
if ! /usr/local/bin/postgrest --version 2>/dev/null | grep -q "${PGRST#v}"; then
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST/postgrest-$PGRST-linux-static-x64.tar.xz" | tar -xJ -C /usr/local/bin
fi
cat > /etc/postgrest.conf <<CONF
db-uri = "postgres://app@/egitim?host=/var/run/postgresql"
db-schemas = "public"
db-anon-role = "app"
db-pool = 5
server-host = "127.0.0.1"
server-port = 3001
CONF

say "Ayar dosyası"
if [ ! -f $APP/.env ]; then
  cat > $APP/.env <<ENV
# Eğitim Stüdyosu ayarları. Anahtarları Render'daki Environment sayfasından kopyalayın.
PORT=8080
PUBLIC_URL=https://$SITE
DB_REST_URL=http://127.0.0.1:3001
FILES_DIR=$APP/files
FILES_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
GITHUB_TOKEN=
FAL_KEY=
APP_PASSWORD=
ENV
fi
chown app:app $APP/.env && chmod 600 $APP/.env

say "Servisler"
cat > /etc/systemd/system/postgrest.service <<UNIT
[Unit]
Description=PostgREST
After=postgresql.service
[Service]
User=app
ExecStart=/usr/local/bin/postgrest /etc/postgrest.conf
ExecReload=/bin/kill -USR1 \$MAINPID
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/egitim.service <<UNIT
[Unit]
Description=Egitim Studyosu
After=postgrest.service
[Service]
User=app
WorkingDirectory=$APP/app
EnvironmentFile=$APP/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/egitim-update.service <<UNIT
[Unit]
Description=Egitim Studyosu otomatik guncelleme
[Service]
Type=oneshot
ExecStart=/bin/bash $APP/app/deploy/update.sh
UNIT
cat > /etc/systemd/system/egitim-update.timer <<UNIT
[Unit]
Description=Egitim Studyosu guncelleme kontrolu (2 dk)
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
cat > /etc/cron.daily/egitim-yedek <<'CRON'
#!/bin/sh
sudo -u app pg_dump egitim | gzip > /srv/egitim/backup/egitim-$(date +%F).sql.gz
find /srv/egitim/backup -name 'egitim-*.sql.gz' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/egitim-yedek
systemctl daemon-reload
systemctl enable -q --now postgrest egitim egitim-update.timer
systemctl restart postgrest egitim

say "Web sunucusu (https://$SITE)"
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
CADDY
systemctl reload caddy || systemctl restart caddy

sleep 4
say "Durum"
for s in postgresql postgrest egitim caddy egitim-update.timer; do printf '%-22s %s\n' "$s" "$(systemctl is-active $s)"; done
curl -fsS http://127.0.0.1:8080/healthz >/dev/null && echo "Uygulama: çalışıyor" || echo "Uygulama: henüz yanıt vermiyor (journalctl -u egitim -n 50)"
echo -e "\nSite adresi: https://$SITE\nAnahtarları girmek için: nano $APP/.env  (sonra: systemctl restart egitim)"
