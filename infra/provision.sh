#!/usr/bin/env bash
# One-time (and re-runnable) setup of a fresh Ubuntu 24.04 VPS for Secret Santa.
# See README › "First deploy". Run as root, with the deploy key's PUBLIC half:
#
#   bash /root/provision.sh /root/santa_deploy.pub
#
# What it does (each step is safe to repeat):
#   - Docker Engine + the compose plugin (official apt repo), with log rotation
#   - a "deploy" user: docker group, passwordless sudo, and SSH keys = root's current
#     authorized_keys (your admin key) + the deploy key given as the argument
#   - SSH: keys only, no root login, no passwords
#   - ufw: only 22/tcp, 80/tcp and 443 (tcp + udp for HTTP/3) in
#   - unattended security upgrades
#   - /opt/santa with docker-compose.yml, backup.sh and a .env (mode 600) to fill in
#
# Keep your root session open until `ssh deploy@<host>` works from a new terminal.

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/santa}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_PUBKEY_FILE="${1:-}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (or with sudo)"
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "this script is for Ubuntu (found ${ID:-unknown})"
[ "${VERSION_ID:-}" = "24.04" ] || echo "warning: written for Ubuntu 24.04, found ${VERSION_ID:-?}"
if [ -n "$DEPLOY_PUBKEY_FILE" ] && [ ! -f "$DEPLOY_PUBKEY_FILE" ]; then
  die "public key file not found: $DEPLOY_PUBKEY_FILE"
fi

export DEBIAN_FRONTEND=noninteractive

log "Base packages"
apt-get update -q
apt-get install -y -q ca-certificates curl ufw unattended-upgrades

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [ ! -f /etc/docker/daemon.json ]; then
  # Container logs would otherwise grow without limit.
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

log "User '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  # No password is set (the account is key-only), so sudo is passwordless. Membership of
  # the docker group is root-equivalent anyway: guard the deploy key like a root key.
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"
visudo -cf "/etc/sudoers.d/90-$DEPLOY_USER" >/dev/null

DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
AUTH_KEYS="$DEPLOY_HOME/.ssh/authorized_keys"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
touch "$AUTH_KEYS"
add_keys() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ssh-*|ecdsa-*|sk-*) ;; *) continue ;; esac
    grep -qxF "$line" "$AUTH_KEYS" || echo "$line" >> "$AUTH_KEYS"
  done < "$1"
}
[ -f /root/.ssh/authorized_keys ] && add_keys /root/.ssh/authorized_keys
[ -n "$DEPLOY_PUBKEY_FILE" ] && add_keys "$DEPLOY_PUBKEY_FILE"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"
KEY_COUNT="$(grep -c . "$AUTH_KEYS" || true)"
[ "$KEY_COUNT" -gt 0 ] || die "no SSH key for $DEPLOY_USER; refusing to turn off root/password logins"
echo "$DEPLOY_USER has $KEY_COUNT SSH key(s)"

log "SSH: keys only, no root login"
# sshd keeps the FIRST value it reads, and Ubuntu's cloud-init drop-in (50-cloud-init.conf)
# may say "PasswordAuthentication yes", so this file sorts first.
cat > /etc/ssh/sshd_config.d/00-santa-hardening.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
CONF
sshd -t
systemctl reload ssh

log "Firewall (ufw)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null
ufw --force enable >/dev/null
ufw status verbose

log "Unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
systemctl enable --now unattended-upgrades >/dev/null

log "App directory $APP_DIR"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
for file in docker-compose.yml backup/backup.sh backup.sh; do
  if [ -f "$SCRIPT_DIR/$file" ]; then
    install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SCRIPT_DIR/$file" "$APP_DIR/$(basename "$file")"
  fi
done
if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$SCRIPT_DIR/.env.example" ]; then
    cp "$SCRIPT_DIR/.env.example" "$APP_DIR/.env"
  else
    touch "$APP_DIR/.env"
  fi
  echo "created $APP_DIR/.env: fill it in (README › Production .env)"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

log "Done"
cat <<EOF
Next:
  1. From a NEW terminal on your PC:  ssh $DEPLOY_USER@<host>   (keep this root session open until it works)
  2. Fill in $APP_DIR/.env (README › Production .env).
  3. Add the GitHub secrets and push to main (README › First deploy).
EOF
