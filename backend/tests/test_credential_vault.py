"""Tests for credential vault — encryption, decryption, credential resolution."""
import unittest
from typing import Optional
from unittest.mock import MagicMock, patch
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ExternalService, ExternalServiceCredential, User
from tests.test_database import create_test_engine, drop_all_tables


class CredentialVaultCryptoTestCase(unittest.TestCase):
    """Test Fernet encrypt/decrypt helpers directly."""

    def setUp(self):
        # Ensure stable key for deterministic tests
        self.env_patcher = patch.dict("os.environ", {
            "VAULT_MASTER_KEY": "test-master-key-for-unit-tests-only",
            "ALLOW_INSECURE_JWT_SECRET": "true",
        })
        self.env_patcher.start()

        # Re-import to pick up patched env
        import importlib
        import app.services.credential_vault as cv
        importlib.reload(cv)
        self.cv = cv

    def tearDown(self):
        self.env_patcher.stop()

    def test_encrypt_decrypt_roundtrip(self):
        plaintext = "my-secret-api-key-123"
        token = self.cv.encrypt(plaintext)
        self.assertIsInstance(token, str)
        self.assertEqual(self.cv.decrypt(token), plaintext)

    def test_encrypt_decrypt_dict(self):
        data = {"api_key": "secret", "region": "us-east-1"}
        token = self.cv.encrypt_dict(data)
        self.assertEqual(self.cv.decrypt_dict(token), data)

    def test_decrypt_invalid_token_raises(self):
        with self.assertRaises(ValueError) as ctx:
            self.cv.decrypt("not-a-valid-fernet-token")
        self.assertIn("Invalid", str(ctx.exception))

    def test_different_keys_produce_different_tokens(self):
        # Same plaintext should produce different tokens each time (Fernet uses IV)
        token1 = self.cv.encrypt("same")
        token2 = self.cv.encrypt("same")
        self.assertNotEqual(token1, token2)
        self.assertEqual(self.cv.decrypt(token1), "same")
        self.assertEqual(self.cv.decrypt(token2), "same")


class CredentialResolutionTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        import app.services.credential_vault as cv
        self.cv = cv

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed_credential(self, session: Session, service_id: int, scope: str, user_id: Optional[int] = None, value: str = "secret"):
        existing = session.get(ExternalService, service_id)
        if not existing:
            svc = ExternalService(id=service_id, slug=f"svc-{service_id}", name=f"service-{service_id}", base_url="https://api.example.com")
            session.add(svc)
            session.commit()
        if user_id is not None:
            existing_user = session.get(User, user_id)
            if not existing_user:
                user = User(id=user_id, email=f"user{user_id}@test.com", display_name=f"User {user_id}", password_hash="hashed")
                session.add(user)
                session.commit()
        token = self.cv.encrypt_dict({"token": value})
        cred = ExternalServiceCredential(
            service_id=service_id,
            scope=scope,
            user_id=user_id,
            encrypted_value=token,
            is_active=True,
        )
        session.add(cred)
        session.commit()
        return cred

    def test_get_system_credential(self):
        with Session(self.engine) as session:
            self._seed_credential(session, service_id=1, scope="system", value="sys-token")
            cred = self.cv.get_system_credential(session, 1)
            self.assertIsNotNone(cred)
            self.assertEqual(cred.scope, "system")
            self.assertEqual(self.cv.decrypt_credential_value(cred)["token"], "sys-token")

    def test_get_system_credential_not_found(self):
        with Session(self.engine) as session:
            self.assertIsNone(self.cv.get_system_credential(session, 99))

    def test_get_user_credential(self):
        with Session(self.engine) as session:
            self._seed_credential(session, service_id=1, scope="user", user_id=7, value="user-token")
            cred = self.cv.get_user_credential(session, 1, 7)
            self.assertIsNotNone(cred)
            self.assertEqual(self.cv.decrypt_credential_value(cred)["token"], "user-token")

    def test_resolve_prefers_user_over_system(self):
        with Session(self.engine) as session:
            self._seed_credential(session, service_id=1, scope="system", value="sys")
            self._seed_credential(session, service_id=1, scope="user", user_id=7, value="user")
            cred = self.cv.resolve_credential(session, 1, user_id=7)
            self.assertIsNotNone(cred)
            self.assertEqual(self.cv.decrypt_credential_value(cred)["token"], "user")

    def test_resolve_falls_back_to_system(self):
        with Session(self.engine) as session:
            self._seed_credential(session, service_id=1, scope="system", value="sys")
            cred = self.cv.resolve_credential(session, 1, user_id=7)
            self.assertIsNotNone(cred)
            self.assertEqual(self.cv.decrypt_credential_value(cred)["token"], "sys")

    def test_resolve_no_user_id_uses_system(self):
        with Session(self.engine) as session:
            self._seed_credential(session, service_id=1, scope="system", value="sys")
            cred = self.cv.resolve_credential(session, 1, user_id=None)
            self.assertIsNotNone(cred)
            self.assertEqual(self.cv.decrypt_credential_value(cred)["token"], "sys")

    def test_get_bearer_token(self):
        with Session(self.engine) as session:
            self._seed_credential(session, service_id=1, scope="system", value="bearer-123")
            token = self.cv.get_bearer_token(session, 1)
            self.assertEqual(token, "bearer-123")

    def test_get_bearer_token_api_key_fallback(self):
        with Session(self.engine) as session:
            svc = ExternalService(id=2, slug="svc-2", name="service-2", base_url="https://api.example.com")
            session.add(svc)
            session.commit()
            token = self.cv.encrypt_dict({"api_key": "ak-fallback"})
            cred = ExternalServiceCredential(
                service_id=2, scope="system", encrypted_value=token, is_active=True,
            )
            session.add(cred)
            session.commit()
            self.assertEqual(self.cv.get_bearer_token(session, 2), "ak-fallback")

    def test_get_bearer_token_missing_returns_none(self):
        with Session(self.engine) as session:
            self.assertIsNone(self.cv.get_bearer_token(session, 99))
