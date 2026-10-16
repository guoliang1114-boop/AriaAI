"""Internal quota records cannot be read or modified as user preferences."""
import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine
from app.models.db import Setting, User
from app.routers import settings


@pytest.fixture
def session():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    settings._settings_cache.clear()
    with Session(engine) as db:
        db.add(Setting(key='voice.usage.v1:user:7', value='private-ledger'))
        db.add(Setting(key='voice.usage.v1:session:7:abc', value='private-lease'))
        db.add(Setting(key='theme', value='light'))
        db.commit()
        yield db
    settings._settings_cache.clear()
    engine.dispose()


def test_internal_quota_rows_absent_from_all_settings(session):
    result = settings.get_all_settings(session)
    assert result['theme'] == 'light'
    assert not any(key.startswith('voice.usage.v1:') for key in result)


@pytest.mark.parametrize('key', ['voice.usage.v1:user:7', 'voice.usage.v1:session:7:abc'])
def test_internal_quota_row_hidden_even_if_cached(session, key):
    settings._settings_cache.set(key, {'value': 'private-cache'}, 60)
    with pytest.raises(HTTPException) as error:
        settings.get_setting(key, session)
    assert error.value.status_code == 404


@pytest.mark.parametrize('admin', [False, True])
@pytest.mark.parametrize('key', ['voice.usage.v1:user:7', 'voice.usage.v1:session:7:new'])
def test_internal_quota_rows_cannot_be_forged_or_overwritten(session, admin, key):
    previous = session.get(Setting, key)
    value = previous.value if previous else None
    user = User(id=7, email='demo@example.invalid', name='Demo', password_hash='unused', is_admin=admin)
    with pytest.raises(HTTPException) as error:
        settings.upsert_setting(key, settings.SettingUpdate(value='forged'), session, user)
    assert error.value.status_code == 403
    current = session.get(Setting, key)
    assert (current.value if current else None) == value
