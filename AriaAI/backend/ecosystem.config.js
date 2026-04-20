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
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
