#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, then double-click this again."
  read -p "Press Enter to close..."; exit 1
fi
node demo/start-demo.js
