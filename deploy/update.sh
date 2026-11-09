#!/usr/bin/env bash
# GitHub'daki main dalında değişiklik varsa kodu çeker ve uygulamayı yeniden başlatır (2 dakikada bir).
set -e
D=/srv/egitim/app
old=$(sudo -u app git -C $D rev-parse HEAD)
sudo -u app git -C $D fetch -q origin main
new=$(sudo -u app git -C $D rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
sudo -u app git -C $D reset -q --hard origin/main
systemctl restart egitim
echo "Güncellendi: $old -> $new"
