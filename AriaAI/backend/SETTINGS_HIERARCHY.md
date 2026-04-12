# AriaAI Settings Hierarchy

This document clarifies the three layers of configuration in AriaAI.

---

## Layer 1: Deployment Configuration (Environment Variables)

**Scope:** Infrastructure-level, set before application starts
**Storage:** Environment variables / `.env` file
**Access:** `app/config.py`

### Examples
```bash
# Database
DATABASE_URL=postgresql://user:pass@host/db

# Security
JWT_SECRET=your-secret-key

# CORS
CORS_ORIGINS=https://yourdomain.com

# Feature flags
ENABLE_BIGMODEL=true
SCHEDULER_ENABLED=true
```

### Characteristics
- Requires application restart to change
- Set by DevOps/infrastructure team
- Not exposed to end users
- Stored in deployment secrets (not database)

---

## Layer 2: Application Defaults (Code)

**Scope:** Sensible defaults for all instances
**Storage:** `app/config.py` constants
**Access:** Imported by services

### Examples
```python
DEFAULT_MAX_TOKENS = 4096
DEFAULT_TEMPERATURE = 0.7
CHUNK_SIZE = 800
TOP_K_RESULTS = 5
```

### Characteristics
- Same across all deployments unless overridden by Layer 1
- Version controlled
- Used when Layer 3 (user settings) is not set

---

## Layer 3: Runtime User Settings (Database)

**Scope:** End-user preferences, changeable at runtime
**Storage:** `Setting` table in database
**Access:** `settings_helper.py`, `settings.py` router

### Examples
| Key | Description |
|-----|-------------|
| `selected_model` | User's preferred LLM model |
| `llm_provider` | Active provider (claude/kimi/bigmodel) |
| `temperature` | Generation temperature |
| `max_tokens` | Max tokens per response |
| `api_key` (encrypted) | User's API key in keyring |

### Characteristics
- Changed by users via Settings UI
- Persisted immediately (no restart needed)
- Per-user (in multi-tenant future)
- Cached with 5-minute TTL

---

## Resolution Priority

When a value is needed:

```
1. Layer 3 (Database) → if set, use this
2. Layer 1 (Environment) → if set, use this
3. Layer 2 (Defaults) → fallback
```

Example: `max_tokens`
```python
# Pseudocode
value = (
    get_db_setting("max_tokens")  # Layer 3
    or os.getenv("MAX_TOKENS")     # Layer 1
    or 4096                        # Layer 2
)
```

---

## API Surface

### For Backend Developers

```python
from app.config import DEFAULT_MAX_TOKENS  # Layer 2
from app.services.settings_helper import get_int_setting  # Layer 3

# In a router/service
max_tokens = get_int_setting(session, "max_tokens", DEFAULT_MAX_TOKENS)
```

### For Frontend Developers

```typescript
// Get user settings
GET /settings/           # All settings
GET /settings/{key}      # Single setting

// Update user setting
PUT /settings/{key}      # Update (Layer 3)
```

---

## Migration Path

If a Layer 3 setting becomes infrastructure-critical:

1. Move value to Layer 1 (environment variable)
2. Mark Layer 3 key as deprecated
3. After deprecation period, remove from UI
4. Eventually remove from database

---

## Security Notes

- **Never** store Layer 1 secrets (JWT, DB passwords) in Layer 3
- API keys are stored in **keyring** (system secure storage), not database
- Database settings are cached in-memory only (no disk cache)
