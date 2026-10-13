#!/bin/bash
# Double-click on a Mac to make "Pro Remote <version>.dmg" (the drag-to-Applications installer) in the dist folder.
cd "$(dirname "$0")/.."
bash tools/make-dmg.sh && open dist
echo ""
read -p "Press Enter to close..."
