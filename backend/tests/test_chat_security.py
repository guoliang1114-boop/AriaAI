import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Conversation, Project, ProjectMember, User
from app.routers.chat_conversations import create_conversation, list_conversations
from app.routers.chat_schemas import CreateConversationRequest
from app.routers.chat_security import require_chat_request_access, require_conversation_access
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


def test_admin_sees_all_project_conversations_but_only_own_standalone():
    """Admins have global oversight of project conversations, but standalone
    (project-less) conversations stay owner-scoped even for admins."""
    conversations_cache.delete_prefix("list:")
    session = _session()
    admin = _user(session, "admin@example.com", is_admin=True)
    other = _user(session, "other@example.com")
    other_project = _project(session, "Other's project")
    session.add(ProjectMember(project_id=other_project.id, user_id=other.id, role="editor"))
    session.add(Conversation(title="admin standalone", owner_user_id=admin.id))
    session.add(Conversation(title="other standalone", owner_user_id=other.id))
    session.add(Conversation(title="other project", project_id=other_project.id))
    session.commit()

    conversations = list_conversations(session=session, current_user=admin)

    titles = {conversation.title for conversation in conversations}
    assert "admin standalone" in titles
    assert "other project" in titles          # admin oversight: visible
    assert "other standalone" not in titles   # standalone stays owner-scoped


def test_admin_can_open_project_conversation_but_not_others_standalone():
    """Admins may open any project conversation, but a project-less conversation
    owned by another user stays 403 (owner-scoped)."""
    session = _session()
    admin = _user(session, "admin@example.com", is_admin=True)
    other = _user(session, "other@example.com")
    other_project = _project(session, "Other's project")
    session.add(ProjectMember(project_id=other_project.id, user_id=other.id, role="editor"))
    standalone = Conversation(title="other standalone", owner_user_id=other.id)
    project_conv = Conversation(title="other project", project_id=other_project.id)
    session.add(standalone)
    session.add(project_conv)
    session.commit()
    session.refresh(standalone)
    session.refresh(project_conv)

    # Project conversation: admin oversight allows access.
    opened = require_conversation_access(session, project_conv.id, admin)
    assert opened.id == project_conv.id

    # Another user's standalone conversation: still 403 for admins.
    with pytest.raises(Exception) as exc:
        require_conversation_access(session, standalone.id, admin)
    assert getattr(exc.value, "status_code", None) == 403


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


def test_admin_can_create_conversation_in_non_member_project():
    """Admin oversight extends to writes: an admin may create a conversation in
    a project they are not a member of."""
    session = _session()
    admin = _user(session, "admin@example.com", is_admin=True)
    project = _project(session, "Other's project")

    conversation = create_conversation(
        CreateConversationRequest(project_id=project.id, title="new"),
        session=session,
        current_user=admin,
    )

    assert conversation.project_id == project.id
    assert conversation.owner_user_id == admin.id


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
