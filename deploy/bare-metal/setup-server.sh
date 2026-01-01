#!/bin/bash
# ============================================
# Clout Bare Metal Server Setup Script
# For: Hetzner CX11 running Ubuntu 22.04/24.04
# Domain: cloutsocial.net
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Clout Bare Metal Setup Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (sudo ./setup-server.sh)${NC}"
    exit 1
fi

# ----------------------------------------
# System Updates
# ----------------------------------------
echo -e "\n${YELLOW}[1/8] Updating system packages...${NC}"
apt update && apt upgrade -y

# ----------------------------------------
# Install Dependencies
# ----------------------------------------
echo -e "\n${YELLOW}[2/8] Installing dependencies...${NC}"
apt install -y \
    curl \
    wget \
    git \
    nginx \
    certbot \
    python3-certbot-nginx \
    build-essential \
    python3 \
    ufw

# Install Node.js 20.x (LTS)
echo -e "\n${YELLOW}[3/8] Installing Node.js 20.x...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# ----------------------------------------
# Create Clout User
# ----------------------------------------
echo -e "\n${YELLOW}[4/8] Creating clout user and directories...${NC}"
if ! id "clout" &>/dev/null; then
    useradd --system --shell /bin/false --home-dir /opt/clout clout
    echo "Created user: clout"
else
    echo "User 'clout' already exists"
fi

# Create directories
mkdir -p /opt/clout
mkdir -p /var/lib/clout
mkdir -p /etc/clout
mkdir -p /var/www/certbot

# Set ownership
chown -R clout:clout /opt/clout
chown -R clout:clout /var/lib/clout
chown -R clout:clout /etc/clout

# ----------------------------------------
# Firewall Configuration
# ----------------------------------------
echo -e "\n${YELLOW}[5/8] Configuring firewall...${NC}"
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (for Let's Encrypt)
ufw allow 443/tcp   # HTTPS
ufw --force enable
ufw status

# ----------------------------------------
# Setup Instructions
# ----------------------------------------
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Server Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n${YELLOW}Next steps to complete deployment:${NC}"
echo ""
echo "1. Copy your built Clout application to the server:"
echo "   scp -r dist package.json package-lock.json node_modules root@YOUR_SERVER:/opt/clout/"
echo ""
echo "2. Copy the configuration file:"
echo "   scp deploy/bare-metal/.env.production root@YOUR_SERVER:/etc/clout/clout.env"
echo ""
echo "3. Edit the environment file on the server:"
echo "   nano /etc/clout/clout.env"
echo "   - Generate a new FREEBIRD_ADMIN_KEY: openssl rand -hex 32"
echo ""
echo "4. Copy nginx configuration:"
echo "   scp deploy/bare-metal/nginx-cloutsocial.conf root@YOUR_SERVER:/etc/nginx/sites-available/cloutsocial.net"
echo ""
echo "5. On the server, enable the nginx site:"
echo "   ln -s /etc/nginx/sites-available/cloutsocial.net /etc/nginx/sites-enabled/"
echo "   rm /etc/nginx/sites-enabled/default  # Remove default site"
echo ""
echo "6. Get SSL certificate (run on server):"
echo "   certbot certonly --webroot -w /var/www/certbot -d cloutsocial.net -d www.cloutsocial.net"
echo ""
echo "7. Test nginx configuration and reload:"
echo "   nginx -t && systemctl reload nginx"
echo ""
echo "8. Copy and enable the systemd service:"
echo "   scp deploy/bare-metal/clout.service root@YOUR_SERVER:/etc/systemd/system/"
echo "   systemctl daemon-reload"
echo "   systemctl enable clout"
echo "   systemctl start clout"
echo ""
echo "9. Check status:"
echo "   systemctl status clout"
echo "   journalctl -u clout -f"
echo ""
echo -e "${GREEN}Your Clout instance will be available at: https://cloutsocial.net${NC}"
