# Security Policy

AriaAI is an open-source project that handles AI workflows, project context, client context, documents, and generated artifacts. Please treat security and privacy issues carefully.

## Reporting a Vulnerability

Please do not open a public GitHub issue for security-sensitive reports.

If you believe you have found a vulnerability, contact the maintainer privately first. Include:

- a clear description of the issue;
- affected components or routes;
- reproduction steps if safe to share;
- expected impact;
- whether any secrets, credentials, customer data, or private documents may be involved.

The maintainer will acknowledge the report, investigate, and coordinate a fix or disclosure path.

## Sensitive Data

Do not commit:

- API keys, tokens, passwords, cookies, or private certificates;
- customer documents or private project files;
- production database exports;
- logs containing private prompts, customer names, or file contents;
- screenshots that expose private client or project information.

## AI-Specific Security Notes

Security reviews should pay special attention to:

- prompt injection through uploaded files or knowledge-base content;
- unauthorized cross-project or cross-client context leakage;
- high-risk tool actions that write, delete, move, or overwrite data;
- memory updates that could persist untrusted or private information;
- generated artifacts that include sensitive source excerpts.

High-risk write/delete/update actions should remain reviewable through human-in-the-loop approval flows.
