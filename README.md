# Secure Patient Document Service

A HIPAA-aware RESTful API for managing patient medical documents with role-based access control, S3 file storage, and audit logging.

## How to Run

### Prerequisites

- Node.js >= 18
- PostgreSQL 14+
- Docker (for LocalStack S3 mock)

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env
# Edit .env with your database connection string

# 3. Start LocalStack (S3 mock)
docker compose up -d localstack

# 4. Create database and run migrations
createdb patient_docs  # or via psql
npm run migrate

# 5. Start the server
npm run dev
```

The server starts at `http://localhost:3000`.

### Running Tests

```bash
# Create test database
createdb patient_docs_test

# Run migrations on test DB
DATABASE_URL="postgres://<user>@localhost:5432/patient_docs_test" npm run migrate

# Run all tests (requires LocalStack running for integration tests)
npm test

# Unit tests only (no external dependencies)
npx vitest run tests/unit
```

### API Usage

Authentication is simulated via base64-encoded JSON tokens:

```bash
# Create a token for a doctor
TOKEN=$(echo -n '{"id":"00000000-0000-0000-0000-000000000002","role":"doctor"}' | base64)

# Upload a document
curl -X POST http://localhost:3000/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "patientId=00000000-0000-0000-0000-000000000004" \
  -F "file=@/path/to/document.pdf"

# List documents
curl http://localhost:3000/documents \
  -H "Authorization: Bearer $TOKEN"

# Get document with pre-signed download URL
curl http://localhost:3000/documents/<document-id> \
  -H "Authorization: Bearer $TOKEN"
```

---

## Assumptions

1. **Simulated auth**: Token payloads are trusted without cryptographic verification. In production, JWTs would be verified against a JWKS endpoint.
2. **No user management**: Users are not stored in the database. User IDs and roles come entirely from the token.
3. **Immutable documents**: Documents cannot be updated or deleted. This is intentional for compliance — medical records are a permanent record.
4. **Small files**: 10MB upload limit. Suitable for typical medical documents (PDFs, scanned images).
5. **Single-tenant**: One organization. No multi-tenancy isolation.
6. **Trusted patientId**: The `patientId` in upload requests is trusted. In production, this would be validated against a patient registry.

## Trade-offs

| Decision | Trade-off |
|----------|-----------|
| **Busboy stream upload** | More complex parsing code vs. Multer, but avoids buffering entire file in memory — critical for large medical files |
| **Knex over Prisma** | No auto-generated types or client, but gives precise SQL control needed for audit-sensitive HIPAA workloads |
| **404 instead of 403** | Slightly harder to debug access issues, but prevents information leakage about document existence |
| **JS migration files** | Less type safety in migrations, but avoids transpilation issues across different runtimes (Knex CLI, Vitest, ts-node) |
| **Base64 token simulation** | Not production-ready, but enables testing the full RBAC flow without JWT infrastructure overhead |
| **Audit logs in PostgreSQL** | Co-located with data (single failure point), but simpler than a separate audit service for this scope |

## What I Would Improve With More Time

- JWT verification with `jose` against a JWKS endpoint
- Structured HTTP logging via pino-http
- ClamAV file scanning pipeline on S3 uploads
- Terraform/CDK for the AWS deployment
- Cursor-based pagination for consistent results during writes
- Per-test-suite database isolation
- CI/CD pipeline (GitHub Actions)

---

## Short Questions

### 1. Data Protection

**Where would you apply encryption in this system and why?**

Three layers:

1. **At rest:** S3 SSE-KMS with customer-managed keys (annual rotation). RDS AES-256 encrypted volumes.

2. **In transit:** TLS 1.2+ everywhere — client→ALB, ALB→app, app→RDS (`sslmode=verify-full`), app→S3 (bucket policy denies non-HTTPS).

3. **Application-level:** `file_name` is encrypted with AES-256-GCM before hitting PostgreSQL. Format: `v1:iv:authTag:ciphertext`. AAD binds ciphertext to its row (`documents:{docId}:{patientId}`) — copying ciphertext between rows breaks GCM auth. Key lives in Secrets Manager with scoped IAM, rotated every 90 days via Lambda with dual-key fallback. DB admins see ciphertext only.

Uploads are also validated via magic byte verification (first 8 bytes checked against PDF/PNG/JPEG signatures) to reject disguised files.

### 2. Access Control

**How do you ensure a doctor cannot access another doctor's documents?**

Two layers: middleware checks the role (coarse), the service layer checks ownership (fine-grained). On single-document access, `document.doctor_id` is compared against `user.id` — mismatch returns 404 (not 403) to avoid leaking document existence. On listing, the query itself is filtered with `WHERE doctor_id = $userId` server-side, so the doctor never receives records they don't own.

### 3. File Storage

**How would you securely store and serve files in S3?**

Private bucket with Block Public Access on all four settings, SSE-KMS encryption, and a bucket policy denying non-HTTPS. Files are never served through the app — the API generates pre-signed URLs (15-min expiry) scoped to the specific object. After expiry, a new auth check is required. Key structure: `documents/{patientId}/{documentId}/{filename}`.

### 4. Auditing

**How would you audit access to patient data?**

Application-level: `audit_logs` table records every document operation — who (user_id, role), what (action, resource), when, correlation (request_id), and result (status_code). No PHI in audit logs, only opaque UUIDs. Infrastructure-level: CloudTrail captures all AWS API calls (S3, RDS, KMS). Both stored in a locked S3 bucket (object lock / WORM). Every request gets a UUID (`X-Request-Id`) for cross-layer correlation.

### 5. Incident Scenario

**If a database snapshot is leaked, what limits the damage?**

RDS snapshots are encrypted — unreadable without the KMS key. The DB only stores metadata, not actual files (those are in S3). IDs are opaque UUIDs, meaningless without the external identity service. Credentials live in Secrets Manager, not in the DB — rotating them invalidates anything in the snapshot. The `audit_logs` table tells investigators what was accessed before the breach.

### 6. Spec-Driven Development

**Why is writing a spec before coding useful?**

Forces decisions about entities, contracts, and access rules before writing code. Prevents scope creep, catches ambiguous auth rules early, and keeps endpoints consistent. Reviewers evaluate the design separately from implementation, QA writes tests from the spec. In this project, writing the access control matrix exposed the 404-vs-403 decision upfront.

### 7. Working with AI

**How would you use a spec to guide an AI coding assistant?**

Feed the spec as context alongside the task. Entity definitions translate directly to types, endpoint contracts map to routes, and access control rules become test cases. Without a spec, the AI guesses at business rules. With one, it implements defined behavior. The spec also serves as validation — if generated code doesn't match the access control matrix, there's a bug.

### 8. Ambiguity

**If a requirement is unclear, how do you proceed?**

Document the ambiguity as an explicit assumption in the spec. Default to the safer/more restrictive option (in healthcare, deny > allow). Flag it for stakeholder review. If possible, make the behavior configurable so it can change without a code deploy.

Example: the spec didn't say whether admins can upload. I assumed yes, documented it in SPEC.md, and enforced it in middleware. If wrong, it's a one-line change.

### 9. PHI Handling

**What is considered sensitive data in this system, and how would you protect it?**

Direct PHI: document files (S3 SSE-KMS + pre-signed URLs). Indirect PHI: `patient_id`/`doctor_id` — opaque v4 UUIDs, not reversible without the external patient registry. File names may contain PHI ("john_doe_bloodwork.pdf") — stored encrypted at column level, never logged. Access patterns are captured in audit logs but contain no demographic data.

Protection: encryption at rest and in transit, RBAC, audit logging, Pino log redaction, magic byte validation on uploads, rate limiting against enumeration.

### 10. Logging

**What data should NOT be logged, and why?**

Never log: auth tokens (replay risk), file contents/names (PHI), patient demographics, DB query parameters (may contain patient IDs), request/response bodies, or pre-signed URLs (temporary credentials).

Logs typically have weaker access controls than the primary data store, get shipped to third-party aggregators, and live for a long time. PHI in logs expands the attack surface and complicates breach response. Pino is configured with redaction paths that replace sensitive fields with `[REDACTED]`.

### 11. Compliance

**What additional steps would be required to make this system production-ready for healthcare use?**

- BAA with AWS (legally required before handling PHI)
- Real JWT auth (OAuth 2.0 / OIDC with a HIPAA-compliant IdP)
- Third-party pen test
- Cross-region DR (RDS + S3 replication, documented RTO/RPO)
- Automated data retention enforcement (HIPAA min 6 years)
- Patient consent tracking
- Break-glass access with elevated auditing
- Incident response plan + designated privacy officer
- Annual HIPAA risk assessment
- SOC 2 Type II audit
- Dependency + container image vulnerability scanning
- ClamAV scanning pipeline on S3 uploads (quarantine bucket + SNS alerts)
- Redis-backed rate limiting for shared state across Fargate instances
- Patient registry integration to validate `patientId` on upload
