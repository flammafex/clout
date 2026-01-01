# Clout Bare Metal Deployment Guide

Deploy Clout on a Hetzner CX11 (or similar) bare metal server.

## Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     cloutsocial.net                              │
│                     (Hetzner CX11)                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   nginx     │────│   Clout     │────│  /var/lib/clout     │  │
│  │  (port 443) │    │ (port 3000) │    │   (file storage)    │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
           │                    │
           │    ┌───────────────┴───────────────┐
           │    │                               │
    ┌──────▼────▼───┐                  ┌────────▼────────┐
    │  Freebird     │                  │    Witness      │
    │ (metacan.org) │                  │  (metacan.org)  │
    ├───────────────┤                  ├─────────────────┤
    │ issuer        │                  │ witness1        │
    │ verifier      │                  │ witness2        │
    └───────────────┘                  │ witness3        │
                                       └─────────────────┘
```

## Prerequisites

- **Server**: Hetzner CX11 (2 vCPU, 2GB RAM, 20GB SSD) or similar
- **OS**: Ubuntu 22.04 or 24.04 LTS
- **Domain**: cloutsocial.net pointed to your server's IP
- **External Services** (already running):
  - Freebird Issuer: `issuer.metacan.org`
  - Freebird Verifier: `verifier.metacan.org`
  - Witness Gateways: `witness1.metacan.org`, `witness2.metacan.org`, `witness3.metacan.org`

## Step 1: Build on Your Dev Computer

```bash
# Clone the repository (if not already)
git clone https://github.com/flammafex/clout.git
cd clout

# Install dependencies
npm install

# Build the application
npm run build

# Verify build succeeded
ls -la dist/src/web/server.js
```

## Step 2: Prepare Server

SSH into your Hetzner server and run the setup script:

```bash
# SSH to your server
ssh root@YOUR_SERVER_IP

# Download and run setup script (or copy manually)
# The script installs: Node.js 20, nginx, certbot, creates user/directories
curl -O https://raw.githubusercontent.com/flammafex/clout/main/deploy/bare-metal/setup-server.sh
chmod +x setup-server.sh
./setup-server.sh
```

Or manually:

```bash
# Update system
apt update && apt upgrade -y

# Install dependencies
apt install -y curl nginx certbot python3-certbot-nginx build-essential ufw

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Create clout user
useradd --system --shell /bin/false --home-dir /opt/clout clout

# Create directories
mkdir -p /opt/clout /var/lib/clout /etc/clout /var/www/certbot
chown -R clout:clout /opt/clout /var/lib/clout /etc/clout

# Configure firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## Step 3: Deploy Application

From your **dev computer**, transfer the built application:

```bash
# Create deployment package
tar -czf clout-deploy.tar.gz \
    dist/ \
    package.json \
    package-lock.json \
    node_modules/

# Transfer to server
scp clout-deploy.tar.gz root@YOUR_SERVER_IP:/tmp/

# SSH to server
ssh root@YOUR_SERVER_IP

# Extract and install
cd /opt/clout
tar -xzf /tmp/clout-deploy.tar.gz
chown -R clout:clout /opt/clout
rm /tmp/clout-deploy.tar.gz
```

Alternative (without node_modules):

```bash
# Transfer only dist and package files
scp -r dist package.json package-lock.json root@YOUR_SERVER_IP:/opt/clout/

# On server, install production dependencies
cd /opt/clout
npm ci --omit=dev
chown -R clout:clout /opt/clout
```

## Step 4: Configure Environment

Copy and edit the environment file:

```bash
# From dev computer
scp deploy/bare-metal/.env.production root@YOUR_SERVER_IP:/etc/clout/clout.env

# On server, generate admin key
ssh root@YOUR_SERVER_IP
openssl rand -hex 32
# Copy the output

# Edit config
nano /etc/clout/clout.env
# Replace FREEBIRD_ADMIN_KEY with the generated key
```

The `.env.production` file is pre-configured for your infrastructure:

```env
WITNESS_GATEWAY_URL=https://witness1.metacan.org
WITNESS_GATEWAY_URL_2=https://witness2.metacan.org
WITNESS_GATEWAY_URL_3=https://witness3.metacan.org
FREEBIRD_ISSUER_URL=https://issuer.metacan.org
FREEBIRD_VERIFIER_URL=https://verifier.metacan.org
FREEBIRD_SYBIL_MODE=invitation
```

## Step 5: Configure Nginx

```bash
# From dev computer
scp deploy/bare-metal/nginx-cloutsocial.conf root@YOUR_SERVER_IP:/etc/nginx/sites-available/cloutsocial.net

# On server
ssh root@YOUR_SERVER_IP

# Enable site
ln -s /etc/nginx/sites-available/cloutsocial.net /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration (will fail until SSL certs exist)
nginx -t
```

## Step 6: Get SSL Certificate

Before getting the certificate, temporarily modify nginx to serve HTTP for the ACME challenge:

```bash
# Create a temporary nginx config for certificate issuance
cat > /etc/nginx/sites-available/cloutsocial-temp.conf << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name cloutsocial.net www.cloutsocial.net;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Clout is being configured...';
        add_header Content-Type text/plain;
    }
}
EOF

# Temporarily use this config
rm /etc/nginx/sites-enabled/cloutsocial.net
ln -s /etc/nginx/sites-available/cloutsocial-temp.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL certificate
certbot certonly --webroot -w /var/www/certbot \
    -d cloutsocial.net \
    -d www.cloutsocial.net \
    --email your-email@example.com \
    --agree-tos \
    --no-eff-email

# Restore full config
rm /etc/nginx/sites-enabled/cloutsocial-temp.conf
ln -s /etc/nginx/sites-available/cloutsocial.net /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## Step 7: Install and Start Clout Service

```bash
# From dev computer
scp deploy/bare-metal/clout.service root@YOUR_SERVER_IP:/etc/systemd/system/

# On server
ssh root@YOUR_SERVER_IP

# Reload systemd
systemctl daemon-reload

# Enable and start Clout
systemctl enable clout
systemctl start clout

# Check status
systemctl status clout
```

## Step 8: Verify Deployment

```bash
# Check Clout logs
journalctl -u clout -f

# Test health endpoint
curl http://localhost:3000/api/health

# Test via nginx
curl https://cloutsocial.net/api/health
```

Visit https://cloutsocial.net in your browser!

## Useful Commands

```bash
# View Clout logs
journalctl -u clout -f

# Restart Clout
systemctl restart clout

# Stop Clout
systemctl stop clout

# Check nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Renew SSL certificates (automatic, but can force)
certbot renew --dry-run

# Check disk usage
du -sh /var/lib/clout

# Backup data
tar -czf clout-backup-$(date +%Y%m%d).tar.gz /var/lib/clout
```

## Updating Clout

```bash
# On dev computer
cd clout
git pull
npm install
npm run build

# Create update package
tar -czf clout-update.tar.gz dist/

# Transfer and deploy
scp clout-update.tar.gz root@YOUR_SERVER_IP:/tmp/
ssh root@YOUR_SERVER_IP

# Stop service, update, restart
systemctl stop clout
cd /opt/clout
rm -rf dist
tar -xzf /tmp/clout-update.tar.gz
chown -R clout:clout /opt/clout
systemctl start clout
rm /tmp/clout-update.tar.gz
```

## Troubleshooting

### Clout won't start

```bash
# Check logs for errors
journalctl -u clout -n 50 --no-pager

# Verify Node.js works
sudo -u clout node -v

# Test running manually
sudo -u clout bash -c 'cd /opt/clout && node dist/src/web/server.js'
```

### Connection to Freebird/Witness fails

```bash
# Test connectivity to external services
curl -v https://issuer.metacan.org/health
curl -v https://verifier.metacan.org/health
curl -v https://witness1.metacan.org/health
```

### SSL certificate issues

```bash
# Check certificate
certbot certificates

# Force renewal
certbot renew --force-renewal

# Check nginx SSL config
nginx -t
```

### High memory usage

The CX11 has 2GB RAM. If you see memory issues:

```bash
# Check memory
free -h

# Adjust systemd limits in /etc/systemd/system/clout.service
# MemoryMax=1G  # Reduce if needed

# Reload and restart
systemctl daemon-reload
systemctl restart clout
```

## Security Recommendations

1. **Keep system updated**: `apt update && apt upgrade`
2. **Enable automatic updates**: `apt install unattended-upgrades`
3. **Configure fail2ban**: `apt install fail2ban`
4. **Regular backups**: Back up `/var/lib/clout` regularly
5. **Monitor logs**: Set up log rotation and monitoring
6. **Strong admin key**: Use the generated 64-character hex key

## Files in This Directory

| File | Description |
|------|-------------|
| `.env.production` | Production environment configuration |
| `clout.service` | Systemd service unit file |
| `nginx-cloutsocial.conf` | Nginx reverse proxy configuration |
| `setup-server.sh` | Server setup script |
| `README.md` | This file |
