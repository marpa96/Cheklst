#!/bin/bash
cd "$(dirname "$0")"
echo "Cheklst preview: http://localhost:8090/  (Control-C to stop)"
python3 -m http.server 8090 --bind 127.0.0.1 --directory web
