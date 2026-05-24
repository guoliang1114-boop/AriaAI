import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Conversation, Project, ProjectMember, User
from app.routers.chat_conversations import create_conversation, list_conversations
from app.routers.chat_schemas import CreateConversationRequest
from app.routers.chat_security import require_chat_request_access
from app.services.cache import conversations_cache


def _session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _user(session: Session, email: str, *, is_admin: bool = False) -> User:
    user = User(email=email, password_hash="x", is_admin=is_admin)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _project(session: Session, name: str) -> Project:
    project = Project(name=name, client=name)
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def test_list_conversations_is_scoped_to_membership_and_owner():
    conversations_cache.delete_prefix("list:")
    session = _session()
    user = _user(session, "member@example.com")
    other = _user(session, "other@example.com")
    project = _project(session, "Visible")
    hidden_project = _project(session, "Hidden")
    session.add(ProjectMember(project_id=project.id, user_id=user.id, role="editor"))
    session.add(ProjectMember(project_id=hidden_project.id, user_id=other.id, role="editor"))
    visible_project_conv = Conversation(title="visible project", project_id=project.id)
    hidden_project_conv = Conversation(title="hidden project", project_id=hidden_project.id)
    owned_standalone = Conversation(title="owned standalone", owner_user_id=user.id)
    other_standalone = Conversation(title="other standalone", owner_user_id=other.id)
    session.add(visible_project_conv)
    session.add(hidden_project_conv)
    session.add(owned_standalone)
    session.add(other_standalone)
    session.commit()

    conversations = list_conversations(session=session, current_user=user)

    titles = {conversation.title for conversation in conversations}
    assert "visible project" in titles
    assert "owned standalone" in titles
    assert "hidden project" not in titles
    assert "other standalone" not in titles


def test_non_member_cannot_create_project_conversation():
    session = _session()
    user = _user(session, "outsider@example.com")
    project = _project(session, "Client Project")

    with pytest.raises(Exception) as exc:
        create_conversation(
            CreateConversationRequest(project_id=project.id, title="new"),
            session=session,
            current_user=user,
        )

    assert getattr(exc.value, "status_code", None) == 403


def test_chat_request_rejects_project_scope_mismatch():
    session = _session()
    user = _user(session, "member@example.com")
    project = _project(session, "Project A")
    other_project = _project(session, "Project B")
    session.add(ProjectMember(project_id=project.id, user_id=user.id, role="editor"))
    session.add(ProjectMember(project_id=other_project.id, user_id=user.id, role="editor"))
    conversation = Conversation(title="Scoped", project_id=project.id)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)

    with pytest.raises(Exception) as exc:
        require_chat_request_access(
            session,
            conversation_id=conversation.id,
            project_id=other_project.id,
            current_user=user,
            require_write=True,
        )

    assert getattr(exc.value, "status_code", None) == 403
