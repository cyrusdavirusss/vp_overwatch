#!/bin/bash
echo "============================================"
echo "  VP-Overwatch Installer (Android/Termux)"
echo "============================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Install with: pkg install nodejs-lts"
    exit 1
fi

echo "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: npm install failed"
    exit 1
fi

echo ""
echo "Building application..."
npx next build
if [ $? -ne 0 ]; then
    echo "ERROR: Build failed"
    exit 1
fi

echo ""
echo "============================================"
echo "  Installation complete!"
echo "  Run ./start.sh to launch VP-Overwatch"
echo "============================================"
