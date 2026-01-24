#!/bin/sh

# Start the Node.js backend in the background
cd /app/server
node dist/index.js &

# Start nginx in the foreground
nginx -g 'daemon off;'
