const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

module.exports = {
  apps: [
    {
      name: 'tony',
      cwd: __dirname,
      script: './server/dist/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3010,
        GEMINI_API_KEY: envVars.GEMINI_API_KEY,
        STATIC_DIR: './dist'
      },
      // Auto-restart settings
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/tony-error.log',
      out_file: './logs/tony-out.log',
      merge_logs: true
    }
  ]
};
