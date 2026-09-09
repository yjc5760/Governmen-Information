#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
echo "網頁： http://localhost:5178/"
node server.js
