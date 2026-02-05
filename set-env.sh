#!/bin/bash
echo "Configuring Environment..."

# 1. Ensure the directory exists
mkdir -p /home/ubuntu/app

# 2. Write Secrets to .env
echo "DB_HOST=${RDSEndpoint}" > /home/ubuntu/app/.env
echo "DB_USER=${DBUser}" >> /home/ubuntu/app/.env
echo "DB_PASS=${DBPassword}" >> /home/ubuntu/app/.env

# 3. Ensure the ubuntu user owns the folder and the file
chown -R ubuntu:ubuntu /home/ubuntu/app
chmod 600 /home/ubuntu/app/.env