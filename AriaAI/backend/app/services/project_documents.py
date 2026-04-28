from __future__ import annotations

from datetime import datetime
from pathlib import Path
import uuid
from typing import Callable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectFile, ProjectFolder
from app.services.time_utils import utc_now_naive


def ensure_markdown_filename(name: str) -> str:
    sanitized = "_".join((name or "document").strip().split())
    sanitized = sanitized.replace("/", "_").replace("\\", "_")
    if not sanitized:
        sanitized = "document"
    if not sanitized.lower().endswith(".md"):
        sanitized = f"{sanitized}.md"
    return sanitized


def build_markdown_export_header(timestamp: datetime | None = None) -> str:
    current = timestamp or utc_now_naive()
    return f"\n\n---\n\n> From project conversation | {current.strftime('%Y-%m-%d %H:%M')}\n\n"


def build_timestamped_markdown_filename(base_name: str, timestamp: datetime | None = None) -> str:
    current = timestamp or utc_now_naive()
    safe_name = ensure_markdown_filename(base_name).removesuffix(".md")
    return f"{safe_name}_{current.strftime('%Y%m%d_%H%M%S')}.md"


def write_project_markdown_file(
    project_file: ProjectFile,
    content: str,
    *,
    uploads_dir: Path,
    append: bool = False,
) -> int:
    full_path = uploads_dir / Path(project_file.path)
    if not full_path.exists():
        raise FileNotFoundError(full_path)

    next_content = content
    if append:
        existing = full_path.read_text(encoding="utf-8", errors="replace")
        if existing and not existing.endswith("\n"):
            existing = f"{existing}\n"
        next_content = f"{existing}{content.lstrip() if existing else content}"

    full_path.write_text(next_content, encoding="utf-8")
    return full_path.stat().st_size


LEGACY_PRESALES_FOLDER_TARGETS = {
    "项目需求": "02_需求与方案",
    "方案和报价": "02_需求与方案",
    "项目交付文档": "03_会议与推进",
    "项目归档信息": "03_会议与推进",
}

PRESALES_TEMPLATE_FOLDERS = [
    "00_项目总览",
    "01_客户与关系",
    "02_需求与方案",
    "03_会议与推进",
]

PRESALES_TEMPLATE_FILES = [
    {
        "folder": "00_项目总览",
        "name": "00_项目概览.md",
        "summary": "咨询售前项目概览",
        "content": """# 项目概览

## 项目名称

## 客户名称

## 当前阶段
- 线索
- 初步沟通
- 需求澄清
- 方案准备
- 商务谈判
- 赢单 / 丢单

## 客户想解决的核心问题

## 为什么这个机会值得跟进

## 当前最大不确定性

## 下一步关键动作

## 最新更新时间
""",
    },
    {
        "folder": "01_客户与关系",
        "name": "01_客户与关系.md",
        "summary": "客户背景和关键关系图谱",
        "content": """# 客户与关系

## 客户公司背景

## 项目发起背景

## Stakeholder Map
| 姓名 | 职位 | 角色 | 态度 | 影响力 |
|---|---|---|---|---|

## 决策链路
- 谁提出需求
- 谁影响预算
- 谁参与选型
- 谁最终拍板

## 当前关系判断
- 支持者
- 中立者
- 阻力方

## 关系推进策略
""",
    },
    {
        "folder": "02_需求与方案",
        "name": "02_需求与问题定义.md",
        "summary": "客户需求和问题定义",
        "content": """# 需求与问题定义

## 客户表面需求

## 客户真实需求

## 当前痛点

## 业务目标

## 成功标准
- 客户如何判断项目成功
- 可量化指标
- 不能触碰的约束

## 已确认事实

## 待确认问题

## 我们的判断与假设
""",
    },
    {
        "folder": "02_需求与方案",
        "name": "03_方案思路.md",
        "summary": "咨询方案初步思路",
        "content": """# 方案思路

## 方案目标

## 核心价值主张

## 工作范围

## 项目路径与方法

## 关键交付物

## 差异化亮点

## 客户可能追问的问题

## 下一轮需要补齐的材料
""",
    },
    {
        "folder": "02_需求与方案",
        "name": "04_竞争与替代方案.md",
        "summary": "竞争格局与替代方案判断",
        "content": """# 竞争与替代方案

## 客户当前可能的替代方案
- 内部自己做
- 继续沿用现状
- 交给其他咨询公司
- 暂缓不做

## 潜在竞争对手

## 我们的优势

## 我们的短板

## 当前竞争风险

## 应对策略
""",
    },
    {
        "folder": "02_需求与方案",
        "name": "05_商务推进.md",
        "summary": "预算、采购和商务推进记录",
        "content": """# 商务推进

## 预算情况
- 已明确
- 模糊
- 暂未确认

## 采购方式
- 直接签约
- 比价
- 招标
- 框架协议
- 其他

## 商务约束
- 价格
- 周期
- 合同条款
- 付款方式
- 验收方式

## 当前报价思路

## 客户反馈

## 商务下一步
""",
    },
    {
        "folder": "03_会议与推进",
        "name": "06_立项沟通纪要.md",
        "summary": "立项或首次沟通纪要",
        "content": """# 立项沟通纪要

## 基本信息
- 时间：
- 参会人：
- 会议目的：

## 客户表达的重点

## 我们确认到的信息

## 待补充材料

## 会后动作
- 客户侧：
- 我方：
""",
    },
    {
        "folder": "03_会议与推进",
        "name": "07_需求澄清会议纪要.md",
        "summary": "需求澄清会议纪要",
        "content": """# 需求澄清会议纪要

## 基本信息
- 时间：
- 参会人：
- 会议目的：

## 客户重点关注

## 关键问题与回答

## 未决事项

## 会后动作
- 客户侧：
- 我方：
""",
    },
    {
        "folder": "03_会议与推进",
        "name": "08_行动清单.md",
        "summary": "咨询售前行动清单",
        "content": """# 行动清单

## 本周重点动作
- [ ]
- [ ]
- [ ]

## 客户待反馈
- [ ]
- [ ]

## 我方待准备
- [ ] 方案
- [ ] 报价
- [ ] 案例
- [ ] 演示
- [ ] 合同条款

## 时间节点
| 事项 | 截止时间 | 负责人 | 状态 |
|---|---|---|---|
""",
    },
    {
        "folder": "03_会议与推进",
        "name": "09_下一步与赢单判断.md",
        "summary": "赢单信号与下一步推进判断",
        "content": """# 下一步与赢单判断

## 下一步最关键的一步

## 未来 7 天推进计划

## 赢单信号
- 决策人开始参与
- 客户愿意给更多内部资料
- 客户明确时间表
- 客户主动讨论报价或合同
- 客户要求定制化方案

## 风险信号
- 一直在沟通但没有推进
- 需求频繁变化
- 预算始终不明确
- 决策人迟迟不出现
- 客户只是做信息收集

## 当前赢单判断
- 高
- 中
- 低

## 判断依据
""",
    },
]


def sanitize_markdown_filename(name: str) -> str:
    return ensure_markdown_filename(name).removesuffix(".md")[:80] or "conversation"


def project_documents_dir(project_id: int, uploads_dir: Path) -> Path:
    dest_dir = uploads_dir / "projects" / str(project_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    return dest_dir


def create_markdown_project_file(
    session: Session,
    project_id: int,
    name: str,
    content: str,
    *,
    uploads_dir: Path,
    folder_id: int | None = None,
    summary: str = "",
) -> ProjectFile:
    safe_name = name if name.lower().endswith(".md") else f"{name}.md"
    dest_dir = project_documents_dir(project_id, uploads_dir)
    dest_file = dest_dir / f"{uuid.uuid4().hex}_{safe_name}"
    dest_file.write_text(content, encoding="utf-8")

    project_file = ProjectFile(
        project_id=project_id,
        folder_id=folder_id,
        name=safe_name,
        file_type="md",
        path=str(dest_file.relative_to(uploads_dir)),
        size_bytes=dest_file.stat().st_size,
        summary=summary,
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file


def get_project_document_file_or_404(session: Session, project_id: int, file_id: int) -> ProjectFile:
    project_file = session.get(ProjectFile, file_id)
    if not project_file or project_file.project_id != project_id:
        raise HTTPException(404, "File not found")
    return project_file


def read_project_document_content(project_file: ProjectFile, *, uploads_dir: Path) -> str:
    full_path = uploads_dir / project_file.path
    if not full_path.exists():
        raise HTTPException(404, "File not found on disk")
    return full_path.read_text(encoding="utf-8", errors="replace")


def resolve_project_folder(
    session: Session,
    project_id: int,
    *,
    init_default_folders: Callable[[int, Session], list[ProjectFolder]],
    preferred_folder_id: int | None = None,
) -> ProjectFolder | None:
    if preferred_folder_id is not None:
        folder = session.get(ProjectFolder, preferred_folder_id)
        if not folder or folder.project_id != project_id:
            raise HTTPException(404, "Folder not found")
        return folder

    folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order, ProjectFolder.id)
    ).all()
    if not folders:
        folders = init_default_folders(project_id, session)

    for folder in folders:
        if folder.sort_order == 2:
            return folder
    return folders[0] if folders else None


def cleanup_legacy_presales_folders(
    session: Session,
    project_id: int,
    folders_by_name: dict[str, ProjectFolder],
) -> int:
    cleaned_count = 0
    for legacy_name, target_name in LEGACY_PRESALES_FOLDER_TARGETS.items():
        legacy_folder = folders_by_name.get(legacy_name)
        target_folder = folders_by_name.get(target_name)
        if not legacy_folder or not target_folder or legacy_folder.id == target_folder.id:
            continue

        files = session.exec(select(ProjectFile).where(ProjectFile.folder_id == legacy_folder.id)).all()
        for project_file in files:
            project_file.folder_id = target_folder.id
            session.add(project_file)

        session.flush()
        session.delete(legacy_folder)
        session.commit()
        cleaned_count += 1
        folders_by_name.pop(legacy_name, None)

    return cleaned_count


def init_presales_template_documents(
    session: Session,
    project_id: int,
    *,
    uploads_dir: Path,
    overwrite: bool = False,
) -> dict:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    existing_folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order, ProjectFolder.id)
    ).all()
    folders_by_name = {folder.name: folder for folder in existing_folders}

    for index, folder_name in enumerate(PRESALES_TEMPLATE_FOLDERS):
        folder = folders_by_name.get(folder_name)
        if folder:
            continue
        folder = ProjectFolder(project_id=project_id, name=folder_name, sort_order=index)
        session.add(folder)
        session.commit()
        session.refresh(folder)
        folders_by_name[folder_name] = folder

    cleaned_folders = cleanup_legacy_presales_folders(session, project_id, folders_by_name)

    existing_docs = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id, ProjectFile.file_type == "md")
    ).all()
    existing_by_key = {(doc.folder_id, doc.name): doc for doc in existing_docs}

    created_files: list[ProjectFile] = []
    updated_files: list[ProjectFile] = []
    for template in PRESALES_TEMPLATE_FILES:
        folder = folders_by_name[template["folder"]]
        existing = existing_by_key.get((folder.id, template["name"]))
        if existing and not overwrite:
            continue
        if existing:
            full_path = uploads_dir / existing.path
            full_path.write_text(template["content"], encoding="utf-8")
            existing.summary = template["summary"]
            existing.size_bytes = full_path.stat().st_size
            session.add(existing)
            session.commit()
            session.refresh(existing)
            updated_files.append(existing)
            continue

        created_files.append(
            create_markdown_project_file(
                session=session,
                project_id=project_id,
                folder_id=folder.id,
                name=template["name"],
                content=template["content"],
                uploads_dir=uploads_dir,
                summary=template["summary"],
            )
        )

    return {
        "ok": True,
        "created_count": len(created_files),
        "updated_count": len(updated_files),
        "cleaned_folder_count": cleaned_folders,
        "folders": list(folders_by_name.values()),
        "files": created_files + updated_files,
    }


def create_project_document_record(
    session: Session,
    project_id: int,
    *,
    name: str,
    content: str,
    uploads_dir: Path,
    init_default_folders: Callable[[int, Session], list[ProjectFolder]],
    folder_id: int | None = None,
    summary: str = "Project note document",
) -> ProjectFile:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    folder = (
        resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_folders,
            preferred_folder_id=folder_id,
        )
        if folder_id is not None
        else None
    )
    filename = sanitize_markdown_filename(name)
    if not filename.lower().endswith(".md"):
        filename = f"{filename}.md"

    return create_markdown_project_file(
        session=session,
        project_id=project_id,
        folder_id=folder.id if folder else None,
        name=filename,
        content=content,
        uploads_dir=uploads_dir,
        summary=summary,
    )


def get_project_document_payload(
    session: Session,
    project_id: int,
    file_id: int,
    *,
    uploads_dir: Path,
) -> dict:
    project_file = get_project_document_file_or_404(session, project_id, file_id)
    if project_file.file_type.lower() != "md":
        raise HTTPException(400, "Only markdown documents are supported")
    return {
        "id": project_file.id,
        "project_id": project_file.project_id,
        "folder_id": project_file.folder_id,
        "name": project_file.name,
        "content": read_project_document_content(project_file, uploads_dir=uploads_dir),
        "summary": project_file.summary,
        "uploaded_at": project_file.uploaded_at,
    }


def update_project_document_record(
    session: Session,
    project_id: int,
    file_id: int,
    *,
    uploads_dir: Path,
    init_default_folders: Callable[[int, Session], list[ProjectFolder]],
    content: str | None = None,
    name: str | None = None,
    folder_id: int | None = None,
) -> dict:
    project_file = get_project_document_file_or_404(session, project_id, file_id)
    if project_file.file_type.lower() != "md":
        raise HTTPException(400, "Only markdown documents are supported")

    full_path = uploads_dir / project_file.path
    if not full_path.exists():
        raise HTTPException(404, "File not found on disk")

    if content is not None:
        project_file.size_bytes = write_project_markdown_file(project_file, content, uploads_dir=uploads_dir)

    if name is not None:
        next_name = sanitize_markdown_filename(name)
        if not next_name.lower().endswith(".md"):
            next_name = f"{next_name}.md"
        project_file.name = next_name

    if folder_id is not None:
        folder = resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_folders,
            preferred_folder_id=folder_id,
        )
        project_file.folder_id = folder.id if folder else None

    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return {
        "ok": True,
        "id": project_file.id,
        "name": project_file.name,
        "folder_id": project_file.folder_id,
        "size_bytes": project_file.size_bytes,
    }
