"""Content-free observations for one provider attempt, owned by Aria's loop."""
from __future__ import annotations

import time
import math
from collections.abc import Callable


class ModelStreamIdleTimeout(RuntimeError):
    """Terminal inactivity, not permission to replay a possibly accepted request."""


class ModelStreamObserver:
    def __init__(self, *, idle_seconds: float = 60, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self.started = clock()
        self.idle_seconds = max(5.0, min(float(idle_seconds), 300.0)) if math.isfinite(idle_seconds) else 60.0
        self.first: dict[str, int] = {}
        self.last_progress = self.started
        self.phase = "waiting"
        self.committed = False

    def mark(self, kind: str) -> None:
        if kind not in {"headers", "reasoning", "text", "tool"}:
            raise ValueError("unknown model observation kind")
        now = self.clock()
        self.first.setdefault(kind, round((now - self.started) * 1000))
        if kind != "headers":
            self.last_progress = now
            if kind != "reasoning" or self.phase == "waiting":
                self.phase = kind
            self.committed = True

    def heartbeat(self) -> dict:
        elapsed = max(0, int(self.clock() - self.started))
        if self.clock() - self.last_progress >= self.idle_seconds:
            raise ModelStreamIdleTimeout(
                f"模型连续 {int(self.idle_seconds)} 秒未返回有效进展，本轮已停止等待；"
                "未自动重试或切换模型，请稍后重试。"
            )
        label = {
            "waiting": "正在等待模型响应",
            "reasoning": "模型正在思考，尚未返回正文",
            "text": "模型正在生成正文",
            "tool": "模型正在生成工具计划，尚未执行",
        }[self.phase]
        suffix = "；等待较久，可停止本轮" if elapsed >= 30 else ""
        return {"type": "status", "stage": f"model_{self.phase}",
                "message": f"{label}（{elapsed} 秒）{suffix}"}

    def timings(self) -> dict[str, int]:
        return {f"provider_{kind}_ms": duration for kind, duration in self.first.items()}
