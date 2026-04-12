"""Execute scheduled AI tasks asynchronously."""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Optional

from sqlmodel import Session

from app.database import engine
from app.models.db import ScheduledTask, Skill, Project, Conversation, Message
from app.services.claude import complete, build_system_prompt


async def run_task(task_id: int) -> None:
    with Session(engine) as session:
        task = session.get(ScheduledTask, task_id)
        if not task or not task.is_enabled:
            return

        task.status = "running"
        task.last_run = datetime.utcnow()
        session.add(task)
        session.commit()

        try:
            skill_prompt = ""
            if task.skill_id:
                skill = session.get(Skill, task.skill_id)
                if skill:
                    skill_prompt = skill.system_prompt

            project_context = ""
            if task.project_id:
                project = session.get(Project, task.project_id)
                if project:
                    project_context = f"Project: {project.name}\nClient: {project.client}"

            system = build_system_prompt(skill_prompt, project_context=project_context)
            messages = [{"role": "user", "content": task.prompt or f"Run scheduled analysis: {task.name}"}]
            response = await complete(messages, system=system)

            conv = Conversation(
                title=f"[Scheduled] {task.name}",
                project_id=task.project_id,
                skill_id=task.skill_id,
            )
            session.add(conv)
            session.commit()
            session.refresh(conv)

            session.add(Message(conversation_id=conv.id, role="user", content=task.prompt))
            session.add(Message(conversation_id=conv.id, role="assistant", content=response))
            session.commit()

            task.status = "success"
            task.next_run = _compute_next_run(task)

        except Exception as e:
            task.status = "failed"
            print(f"[Scheduler] Task {task_id} failed: {e}")

        session.add(task)
        session.commit()


def _compute_next_run(task: ScheduledTask) -> Optional[datetime]:
    from app.services.scheduler import next_run_from_frequency
    return next_run_from_frequency(task.frequency, task.cron_expr)
