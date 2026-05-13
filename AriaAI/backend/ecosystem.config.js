module.exports = {
  apps: [
    {
      name: "ariaai-backend",
      script: ".venv/bin/python",
      args: "-m uvicorn main:app --host 127.0.0.1 --port 8000",
      cwd: "/www/wwwroot/AriaAI/AriaAI/backend",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: "512M",
      exp_backoff_restart_delay: 100,
      error_file: "/www/wwwroot/AriaAI/logs/backend-error.log",
      out_file: "/www/wwwroot/AriaAI/logs/backend-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
