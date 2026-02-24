# Architecture — Secure Patient Document Service

## 1. System Overview

```
                          ┌─────────────┐
                          │   Client    │
                          │  (Browser/  │
                          │   Mobile)   │
                          └──────┬──────┘
                                 │ HTTPS (TLS 1.2+)
                          ┌──────▼──────┐
                          │     ALB     │
                          │ (TLS Term.) │
                          └──────┬──────┘
                                 │
                    ┌────────────▼────────────┐
                    │    ECS Fargate Tasks    │
                    │  (Node.js Application) │
                    │  ┌──────────────────┐  │
                    │  │  Express Server  │  │
                    │  │  ├─ Auth MW      │  │
                    │  │  ├─ RBAC MW      │  │
                    │  │  ├─ Audit MW     │  │
                    │  │  └─ Routes       │  │
                    │  └──────────────────┘  │
                    └───┬──────────┬─────────┘
                        │          │
              ┌─────────▼──┐  ┌───▼────────────┐
              │  RDS        │  │   S3 Bucket    │
              │ PostgreSQL  │  │ (patient-docs) │
              │ (encrypted) │  │ (SSE-KMS)      │
              └─────────────┘  └────────────────┘
                        │
              ┌─────────▼──────────┐
              │   CloudWatch Logs  │
              │   CloudTrail       │
              └────────────────────┘
```

---

## 2. Deployment (AWS)

### 2.1 Compute — ECS / Fargate

- **Service:** ECS Fargate (serverless containers — no EC2 instance management)
- **Task Definition:** Single container running the Node.js application from the Docker image
- **Networking:** Tasks run in private subnets within a VPC. No public IP assigned to tasks.
- **Service Discovery:** Internal ALB routes traffic to Fargate tasks
- **Auto-scaling:** Target tracking on CPU utilization (target: 70%) and request count per target
- **Health Check:** ALB health check against `GET /health`
- **Deployment:** Rolling deployment with circuit breaker enabled. Minimum healthy percent: 100%, maximum percent: 200%

**Why Fargate:** No OS patching (smaller security surface), pay-per-use, task-level isolation, simpler compliance posture.

### 2.2 Database — RDS (PostgreSQL)

- **Engine:** PostgreSQL 14+
- **Instance:** `db.r6g.large` (production) — ARM-based for cost efficiency
- **Multi-AZ:** Enabled for high availability (synchronous standby in another AZ)
- **Storage:** gp3 with encryption enabled (AWS KMS)
- **Backup:** Automated daily snapshots, 35-day retention (HIPAA requirement)
- **Network:** Private subnet only. Security group allows inbound 5432 only from Fargate task security group
- **Parameter Group:** `log_statement = 'ddl'` (log schema changes, not data queries — PHI protection)
- **Performance Insights:** Enabled for query analysis (with PHI redaction)

### 2.3 File Storage — S3

- **Bucket:** `patient-documents-{account-id}-{region}` (globally unique, not guessable)
- **Encryption:** SSE-KMS with a customer-managed KMS key (enables key rotation and access auditing)
- **Block Public Access:** All four settings enabled (block public ACLs, block public policy, ignore public ACLs, restrict public buckets)
- **Versioning:** Enabled (supports audit trail and accidental deletion recovery)
- **Object Lock:** Compliance mode for regulatory retention (documents cannot be deleted during retention period)
- **Access Logging:** Server access logs sent to a separate logging bucket
- **Lifecycle Rules:**
  - Transition to S3 Intelligent-Tiering after 90 days
  - No automatic deletion (retention governed by HIPAA requirements)
- **Bucket Policy:** Deny any request without `aws:SecureTransport` (enforce HTTPS)
- **CORS:** Not configured (files accessed via pre-signed URLs, not direct browser requests to S3)

### 2.4 Audit & Monitoring — CloudTrail + CloudWatch

- **CloudTrail:** Enabled for all regions. Logs API calls to S3, RDS, ECS, KMS. Stored in a dedicated S3 bucket with SSE-KMS and object lock.
- **CloudWatch Logs:** Application logs (from Pino via stdout) captured by the Fargate log driver. Log group with 1-year retention.
- **CloudWatch Alarms:**
  - 5xx error rate > 1% → SNS notification
  - Response latency p99 > 2s → SNS notification
  - Unauthorized access attempts (401/403 count) > threshold → SNS notification
- **VPC Flow Logs:** Enabled to capture network traffic metadata for forensic analysis

---

## 3. Security

### 3.1 Encryption

**At Rest:**
| Resource | Encryption Method | Key Management |
|----------|-------------------|---------------|
| S3 objects | SSE-KMS | Customer-managed KMS key with automatic annual rotation |
| RDS database | AES-256 (AWS managed) | AWS-managed key (or CMK for stricter control) |
| EBS volumes | AES-256 | AWS-managed key |
| CloudTrail logs | SSE-KMS | Dedicated CMK |
| Application secrets | AWS Secrets Manager | Automatic rotation |

**In Transit:**
| Connection | Protocol |
|------------|----------|
| Client → ALB | TLS 1.2+ (enforced via ALB security policy) |
| ALB → Fargate | TLS (internal) or plaintext within VPC (acceptable for private subnet) |
| Fargate → RDS | TLS (enforced via `sslmode=verify-full` connection parameter) |
| Fargate → S3 | HTTPS (enforced via bucket policy denying non-SSL) |

### 3.2 Access Control (IAM — Principle of Least Privilege)

**ECS Task Role (application runtime):**
```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:GetObject"
  ],
  "Resource": "arn:aws:s3:::patient-documents-*/*"
}
```
- NO `s3:DeleteObject` — documents are immutable
- NO `s3:ListBucket` — application does not need to list bucket contents
- NO `s3:*` wildcards

**ECS Task Execution Role:**
- `ecr:GetAuthorizationToken`, `ecr:BatchGetImage` — pull container image
- `logs:CreateLogStream`, `logs:PutLogEvents` — write to CloudWatch
- `secretsmanager:GetSecretValue` — retrieve database credentials (scoped to specific secret ARN)

**RDS:**
- Database user has `SELECT`, `INSERT` on `documents` and `audit_logs` tables only
- No `DELETE`, `UPDATE`, `DROP`, `TRUNCATE` permissions
- Separate admin user for migrations (used only in CI/CD, not at runtime)

### 3.3 Secrets & Key Management

| Secret | Storage | Rotation |
|--------|---------|----------|
| Database credentials | AWS Secrets Manager | Automatic (30-day rotation via Lambda) |
| KMS key (S3 SSE) | AWS KMS | Automatic annual rotation |
| Column encryption key | AWS Secrets Manager | 90-day rotation via Lambda (see below) |
| API keys (future) | AWS Secrets Manager | Manual + alerts |

- **No secrets in environment variables** in production — fetched from Secrets Manager at startup
- **No secrets in code** — `.env.example` contains placeholder values only
- **No secrets in Docker images** — multi-stage build, runtime secret injection
- **No secrets in logs** — Pino redacts `Authorization` headers and credential fields

#### 3.3.1 Column-Level Encryption Key Lifecycle

The `file_name` field (potential PHI — e.g., "john_doe_bloodwork.pdf") is encrypted at the application layer using AES-256-GCM before being stored in PostgreSQL. This provides defense-in-depth beyond RDS disk encryption.

**Where the key is stored:**
- **Production:** AWS Secrets Manager, scoped to a specific secret ARN. The ECS task role has `secretsmanager:GetSecretValue` limited to that single ARN — no wildcard access.
- **Local dev:** `ENCRYPTION_KEY` env var (64 hex characters = 32 bytes). The default in config is a development-only key that must never be used in production.

**How the key is rotated (90-day cycle):**

```
Day 0:  Secrets Manager Lambda generates a new key
        → New key becomes ENCRYPTION_KEY
        → Old key moves to ENCRYPTION_KEY_PREVIOUS
        → ECS tasks restart and pick up both keys

Day 1-7: Background migration job re-encrypts all file_name values
          with the new key (batch UPDATE with decrypt-then-encrypt)

Day 8:  ENCRYPTION_KEY_PREVIOUS is deleted from Secrets Manager
        → Old key is permanently gone
```

During the rotation window (days 0-7), the `EncryptionService` tries the current key first, then falls back to the previous key. This ensures zero-downtime rotation — no read failures during the transition.

**App-layer access limits:**
- IAM scoped to a single Secrets Manager ARN — no other role can read the key
- Key held in process memory only — never logged, serialized, or included in error payloads
- DB admins see ciphertext — no access to the encryption key
- Application DB user limited to `SELECT`/`INSERT`; admin user restricted to migration contexts
- Key fetched via TLS-encrypted Secrets Manager API call within the VPC

**Encrypted value format:** `v1:iv:authTag:ciphertext` (hex-encoded, version-prefixed)
- `v1`: version prefix — enables future format changes (e.g., switching to base64, changing algorithm) without breaking existing data. Decrypt handles both `v1:...` and legacy `iv:...` formats.
- `iv`: 12-byte initialization vector (unique per encryption, prevents pattern analysis). Validated to be exactly 12 bytes on decrypt — rejects manipulated inputs.
- `authTag`: 16-byte GCM authentication tag (integrity + authenticity — detects tampering). Validated to be exactly 16 bytes on decrypt.
- `ciphertext`: the encrypted data

**AAD (Additional Authenticated Data):**

Each encrypted `file_name` is bound to its document row via GCM AAD. The context string `documents:{document_id}:{patient_id}` is passed to `cipher.setAAD()` during both encrypt and decrypt. This prevents **ciphertext swapping attacks** — if an attacker copies the encrypted `file_name` from document A to document B (via direct SQL), GCM authentication fails because the AAD (document_id + patient_id) doesn't match.

**Re-encryption migration:**

Background job re-encrypts all rows after key rotation. Uses `needsReEncryption()` to identify rows still on the old key. Processes in batches with optimistic locking (`UPDATE WHERE file_name = $currentCiphertext`) for idempotency. No race conditions: reads fall back to the previous key, writes always use the current key. Previous key is removed only after a count query confirms zero remaining old-key rows.

**Memory-resident key risks:**

The key lives in Node.js heap memory — heap snapshots or crash dumps could expose it. Mitigations for sensitive deployments: KMS envelope encryption (DEK encrypted by CMK, CMK never leaves KMS hardware), AWS Encryption SDK for automated key lifecycle, or Nitro Enclaves for full memory isolation.

### 3.4 ID Enumeration Protection

Multiple layers:

- **UUIDs (v4):** 128-bit random IDs — search space of 2^122 makes enumeration infeasible.
- **404 not 403:** Prevents distinguishing "exists but no access" from "doesn't exist."
- **Rate limiting:** Sliding-window rate limiter (100 req/min per IP) + AWS WAF as second layer.
- **Anomaly logging:** Rate limit violations and 404 clusters logged with IP/user_id/request_id. CloudWatch metric filters trigger alarms on suspicious patterns.
- **Non-sequential:** UUIDs aren't auto-incrementing — no inference of next document ID.

### 3.5 File Content Validation & Scanning

**Application-level (implemented):**
- **MIME whitelist:** Only `application/pdf`, `image/png`, `image/jpeg` are accepted.
- **Magic byte validation:** The first 8 bytes of every uploaded file are read and validated against known file signatures before the file is piped to S3. This prevents:
  - Executable files disguised as PDFs
  - Polyglot files (valid in multiple formats)
  - Files with mismatched extension/MIME type

**Production-level (architecture):**
For production deployment, a virus scanning pipeline would be added:

```
Upload → S3 "incoming" bucket → S3 Event Notification
    → Lambda (ClamAV) → Scan file
        ├── Clean    → Move to "documents" bucket, update metadata status
        └── Infected → Move to "quarantine" bucket, alert security team, mark document as quarantined
```

- **ClamAV Lambda:** Using the `clamav-lambda-layer` or a containerized Lambda with ClamAV definitions updated daily
- **S3 bucket separation:** Files land in an "incoming" bucket first. Only after passing the scan are they moved to the main "documents" bucket. Pre-signed URLs are never generated for the incoming bucket.
- **Asynchronous scanning:** The upload API returns 201 immediately with a `status: "scanning"` field. The document transitions to `status: "available"` after the scan passes. Clients poll or receive a webhook notification.
- **Quarantine:** Infected files are moved to a quarantine bucket with object lock. The security team is notified via SNS.

### 3.6 Audit Logs

**Application-level (audit_logs table):**
- Every document access (create, read, list) is logged
- Logs contain: who (user_id, user_role), what (action, resource_type, resource_id), when (created_at), correlation (request_id), result (status_code)
- NO PHI in audit logs — only opaque identifiers

**Infrastructure-level (CloudTrail):**
- All AWS API calls are logged (S3 access, RDS connections, KMS key usage)
- Logs stored in a separate S3 bucket with object lock (tamper-proof)
- Cross-region replication for disaster recovery

**What is NOT logged:** Patient demographics, file contents/names, auth tokens, DB query parameters with patient IDs, request/response bodies.

---

## 4. HIPAA Compliance Considerations

### 4.1 Data Protection & PHI Boundary

**PHI classification by data store:**

| Data Store | Data | PHI Classification | Protection |
|------------|------|-------------------|------------|
| S3 bucket | Document files (PDFs, images) | **Direct PHI** — contains clinical data | SSE-KMS, pre-signed URLs, no public access |
| PostgreSQL `documents` | `patient_id`, `doctor_id` (opaque UUIDs), `file_name`, `file_key` | **Indirect PHI** — IDs link to a person via external registry | RDS encryption, column-level encryption (production), RBAC |
| PostgreSQL `audit_logs` | User IDs, actions, timestamps | **No PHI** — operational metadata only | RDS encryption |
| Application logs (Pino) | Request IDs, HTTP methods, status codes | **No PHI** — sensitive fields redacted | Pino redaction paths, CloudWatch encryption |

**Key PHI design constraints:**
- `patient_id` and `doctor_id` are **opaque v4 UUIDs** — not reversible to names, DOB, MRN, or SSN without the external patient registry
- File names may contain PHI (e.g., "john_doe_bloodwork.pdf") — stored encrypted, **never logged**
- No clinical data (diagnoses, medications, lab values) is stored anywhere except the document files themselves
- The patient registry (mapping UUIDs to real identities) is **externalized** and out of scope — this system never stores or processes demographic data
- All PHI is encrypted at rest (S3 SSE-KMS, RDS encryption) and in transit (TLS 1.2+)
- File content is never processed or stored by the application server — streamed directly to/from S3

### 4.2 Access Control
- Role-based access control enforced at both middleware (coarse) and service (fine-grained) layers
- Principle of least privilege applied to IAM roles, database permissions, and API access
- Time-limited pre-signed URLs (15 min) prevent persistent file access

### 4.3 Audit Trail
- Application audit logs capture every PHI access event
- CloudTrail captures infrastructure-level access
- Logs are immutable (S3 object lock) with regulatory retention periods
- Correlation IDs enable cross-layer forensic analysis

### 4.4 Breach Response Plan

Detection via CloudWatch alarms (401/403 spikes, bulk downloads, off-hours access). Containment: revoke credentials, rotate KMS keys, isolate resources via security groups. Assessment: query audit_logs + CloudTrail for scope. HIPAA requires notification within 60 days (HHS + affected individuals + media if >500 affected). Post-incident remediation and documentation maintained for 6 years.

### 4.5 Incident Scenario: Database Snapshot Leaked

Damage is limited: DB contains only metadata (files are in S3), snapshots are KMS-encrypted (unreadable without key), IDs are opaque UUIDs (meaningless without external identity service), file names are column-encrypted, and credentials live in Secrets Manager (immediate rotation invalidates leaked connection strings).

---

## 5. Scaling

### 5.1 Horizontal Scaling
- **Fargate auto-scaling:** Add more tasks based on CPU/request metrics. Stateless design allows unlimited horizontal scaling.
- **RDS Read Replicas:** Add read replicas for read-heavy workloads (document listing). Write operations go to the primary.
- **S3:** Inherently scalable — no action needed.

### 5.2 Bottlenecks
| Bottleneck | Mitigation |
|------------|------------|
| Database connections | Use connection pooling (PgBouncer sidecar or RDS Proxy) |
| RDS write throughput | Vertical scaling (larger instance). For extreme scale: sharding by patient_id |
| S3 upload throughput | Multipart uploads for large files (already implemented via @aws-sdk/lib-storage) |
| Pre-signed URL generation | Lightweight operation — unlikely bottleneck. Can be cached briefly if needed |
| Audit log writes | Async write via SQS queue to decouple from request path |

### 5.3 Caching Strategy (future)
- **ElastiCache (Redis):** Cache document metadata for frequently accessed documents. Invalidate on write.
- **CloudFront:** NOT used for document delivery (private content, compliance requirements). Could front the API for DDoS protection.

### 5.4 Network Architecture
- **VPC:** Dedicated VPC with public/private subnet pairs across 2+ AZs
- **Public subnets:** ALB, NAT Gateway
- **Private subnets:** Fargate tasks, RDS
- **VPC Endpoints:** S3 gateway endpoint (traffic stays within AWS network, reducing latency and cost)
- **WAF:** AWS WAF on the ALB with rules for rate limiting, SQL injection detection, and IP reputation filtering
