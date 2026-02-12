#!/bin/bash
echo "Provisioning Runtime..."

# ==========================================
# 1. Install System Tools & Global Packages
# ==========================================
apt-get update -y
apt-get install -y curl git

# Install N|Solid (Node.js)
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nsolid

# Install PM2 Globally
npm install pm2@latest -g

# Ensure App Directory Exists & Permissions are Correct
mkdir -p /home/ubuntu/app
chown -R ubuntu:ubuntu /home/ubuntu/app

# ==========================================
# 2. Application Setup ('ubuntu' User)
# ==========================================
su - ubuntu -c '
    cd /home/ubuntu/app

    # Install Dotenv (Local dependency)
    npm install dotenv express mysql2 body-parser express-session

    # Install Project Dependencies
    if [ -f package.json ]; then
        echo "Installing dependencies from package.json..."
        npm install
    else
        echo "No package.json found. Initializing fallback..."
        npm init -y
        npm install express mysql2 body-parser
    fi

    # Start Server with PM2
    if [ -f serverv2.js ]; then
        echo "Starting serverv2.js..."
        # --node-args loads .env before the app starts
        pm2 start serverv2.js --node-args="-r dotenv/config"
        pm2 save
    else
        echo "WARNING: serverv2.js not found, skipping start."
    fi
'

# ==========================================
# 3. Configure Auto-Restart (Run as Root)
# ==========================================
# This command registers the pm2-ubuntu service with systemd
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Ensure the service starts on boot
systemctl enable pm2-ubuntu
