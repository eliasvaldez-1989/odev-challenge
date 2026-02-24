# Secure Patient Document Service — Specification

## 1. Overview

A RESTful API service for managing patient medical documents. Doctors upload documents for their patients, patients can view their own documents, and administrators have full access. The system enforces role-based access control (RBAC), stores files in AWS S3, persists metadata in PostgreSQL, and maintains an audit trail for all data access — designed with HIPAA compliance in mind.

---

## 2. Entities

### 2.1 User (from decoded JWT token — not persisted)

| Field | Type | Description |
|-------|------|-------------|
| id | UUID (string) | Unique user identifier |
| role | enum: `admin`, `doctor`, `patient` | User's role in the system |

Authentication is simulated. The user is extracted from a decoded token in the `Authorization` header. No user table exists in the database.

### 2.2 Document

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique document identifier |
| patient_id | VARCHAR(255) | NOT NULL, indexed | ID of the patient this document belongs to |
| doctor_id | VARCHAR(255) | NOT NULL, indexed | ID of the doctor who uploaded the document |
| file_key | VARCHAR(1024) | NOT NULL | S3 object key (internal — never exposed in API responses) |
| file_name | VARCHAR(255) | NOT NULL | Original filename |
| file_size | INTEGER | NOT NULL | File size in bytes |
| mime_type | VARCHAR(127) | NOT NULL | MIME type (e.g., `application/pdf`) |
| created_at | TIMESTAMPTZ | NOT NULL, default NOW() | Upload timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL, default NOW() | Last modification timestamp |

### 2.3 Audit Log

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique log entry identifier |
| user_id | VARCHAR(255) | NOT NULL, indexed | ID of the user who performed the action |
| user_role | VARCHAR(50) | NOT NULL | Role of the user at the time of action |
| action | VARCHAR(100) | NOT NULL, indexed | Action performed (e.g., `document.create`, `document.read`, `document.list`) |
| resource_type | VARCHAR(100) | NOT NULL | Type of resource accessed (e.g., `document`) |
| resource_id | VARCHAR(255) | nullable | ID of the specific resource (null for list operations) |
| request_id | VARCHAR(255) | NOT NULL | Correlation ID for the request |
| ip_address | VARCHAR(45) | nullable | Client IP address |
| status_code | INTEGER | NOT NULL | HTTP status code of the response |
| created_at | TIMESTAMPTZ | NOT NULL, default NOW() | Timestamp of the action |

**Note:** Audit logs contain NO Protected Health Information (PHI) — only opaque identifiers.

---

## 3. API Endpoints

### 3.1 Health Check

**`GET /health`**

- **Auth:** None
- **Response 200:**
  ```json
  { "status": "ok", "timestamp": "2024-01-15T10:30:00.000Z" }
  ```

### 3.2 Upload Document

**`POST /documents`**

- **Auth:** Required
- **Roles:** `admin`, `doctor`
- **Content-Type:** `multipart/form-data`
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | file | binary | yes | The document file (max 10MB) |
  | patientId | string (UUID) | yes | Target patient ID |

- **Business Rules:**
  - `doctor` role: `doctorId` is automatically set to the authenticated user's ID (cannot impersonate another doctor)
  - `admin` role: can specify any `doctorId` via an optional field, defaults to own ID
  - `patient` role: receives 403 Forbidden
  - Allowed MIME types: `application/pdf`, `image/png`, `image/jpeg`

- **Response 201:**
  ```json
  {
    "id": "uuid",
    "patientId": "uuid",
    "doctorId": "uuid",
    "fileName": "lab-results.pdf",
    "mimeType": "application/pdf",
    "fileSize": 102400,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
  ```

- **Error Responses:**
  - `400` — Invalid input (missing fields, invalid UUID, unsupported file type, file too large)
  - `401` — Missing or invalid token
  - `403` — Insufficient role

### 3.3 List Documents

**`GET /documents`**

- **Auth:** Required
- **Roles:** `admin`, `doctor`, `patient`
- **Query Parameters:**
  | Param | Type | Default | Description |
  |-------|------|---------|-------------|
  | page | integer | 1 | Page number |
  | limit | integer | 20 | Items per page (max 100) |

- **Filtering Rules (enforced server-side):**
  - `admin`: returns all documents
  - `doctor`: returns only documents where `doctor_id = user.id`
  - `patient`: returns only documents where `patient_id = user.id`

- **Response 200:**
  ```json
  {
    "data": [
      {
        "id": "uuid",
        "patientId": "uuid",
        "doctorId": "uuid",
        "fileName": "lab-results.pdf",
        "mimeType": "application/pdf",
        "fileSize": 102400,
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45
    }
  }
  ```

### 3.4 Get Document

**`GET /documents/:id`**

- **Auth:** Required
- **Roles:** `admin`, `doctor`, `patient`
- **Access Rules:**
  - `admin`: can access any document
  - `doctor`: can access only documents where `doctor_id = user.id`
  - `patient`: can access only documents where `patient_id = user.id`
  - **Returns 404 (not 403)** when the document exists but the user lacks access — prevents information leakage about document existence

- **Response 200:**
  ```json
  {
    "id": "uuid",
    "patientId": "uuid",
    "doctorId": "uuid",
    "fileName": "lab-results.pdf",
    "mimeType": "application/pdf",
    "fileSize": 102400,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "downloadUrl": "https://s3.amazonaws.com/...?X-Amz-Signature=..."
  }
  ```
  The `downloadUrl` is a pre-signed S3 URL valid for 15 minutes.

- **Error Responses:**
  - `401` — Missing or invalid token
  - `404` — Document not found OR user lacks access

---

## 4. Access Control Matrix

| Action | admin | doctor | patient |
|--------|-------|--------|---------|
| Upload document (POST /documents) | Yes (any patient/doctor) | Yes (own doctorId only) | No (403) |
| List documents (GET /documents) | All documents | Own documents (doctor_id = self) | Own documents (patient_id = self) |
| Get document (GET /documents/:id) | Any document | Own documents only | Own documents only |
| Download file (via pre-signed URL) | Any document | Own documents only | Own documents only |

---

## 5. Authentication

Authentication is simulated via a Bearer token in the `Authorization` header. The token is a base64-encoded JSON object:

```
Authorization: Bearer <base64({"id":"uuid","role":"admin|doctor|patient"})>
```

The middleware decodes and validates the token using a Zod schema. In production, this would be replaced with JWT verification against a JWKS endpoint.

---

## 6. Security Requirements

- **No public file access:** S3 bucket blocks all public access. Files are served only via time-limited pre-signed URLs.
- **Input validation:** All request data validated with Zod schemas before processing.
- **File content validation:** Uploaded files are verified at two layers: (1) MIME type whitelist against the `Content-Type` header, (2) **magic byte validation** — the first 8 bytes of the file stream are read and compared against known file signatures (PDF `%PDF`, PNG `89504E47`, JPEG `FFD8FF`). This prevents attacks where a malicious file is renamed to a permitted extension. Files that fail magic byte validation are rejected with HTTP 400.
- **Authorization enforcement:** Coarse-grained (role check in middleware) + fine-grained (resource ownership in service layer).
- **Audit logging:** Every data access is recorded in the audit_logs table with user identity, action, resource, and timestamp.
- **Rate limiting:** API-wide sliding-window rate limiter (100 requests/min per IP). Excessive requests return 429 and are logged as potential brute-force or enumeration attempts. Standard `X-RateLimit-*` headers are included in every response.
- **PHI protection:** No PHI in logs, error responses, or URLs. S3 keys use opaque IDs.
- **Encryption at rest:** S3 SSE-S3/SSE-KMS for files. PostgreSQL with encrypted storage volumes in production.
- **Encryption in transit:** HTTPS enforced. Helmet sets security headers including HSTS.
- **Column-level encryption:** `file_name` (potential PHI) is encrypted with AES-256-GCM at the application layer before storage in PostgreSQL, with AAD binding ciphertext to `document_id + patient_id` to prevent row swapping.
- **Secrets management:** Environment variables for local dev. AWS Secrets Manager / Parameter Store in production.
- **Antivirus scanning (production):** In a production deployment, uploaded files would be scanned via a ClamAV-backed Lambda triggered by S3 `PutObject` events. Files flagged as malicious are moved to a quarantine bucket and the document metadata is marked accordingly.

---

## 6.1 PHI Data Boundary

This system is designed with a clear separation between metadata and Protected Health Information (PHI):

| Data Store | Contains | PHI Status |
|------------|----------|------------|
| PostgreSQL `documents` table | Opaque UUIDs (`patient_id`, `doctor_id`), file metadata | **Indirect PHI** — IDs are opaque v4 UUIDs, not reversible to human-readable identifiers. No names, DOB, MRN, SSN, or demographic data stored. |
| PostgreSQL `audit_logs` table | Opaque UUIDs, action types, status codes | **No PHI** — purely operational metadata |
| S3 bucket | Document files (PDFs, images) | **Direct PHI** — file contents are protected by SSE-KMS encryption and pre-signed URL access only |

**Key design constraints:**
- `patient_id` and `doctor_id` are opaque UUIDs generated by an external identity service. They cannot be reversed to names, DOB, or any demographic information without access to the patient registry (which is externalized and out of scope).
- File names may contain PHI (e.g., "john_doe_bloodwork.pdf") — they are stored encrypted in the database and **never logged**.
- The S3 key structure uses only opaque IDs: `documents/{patientId}/{documentId}/{filename}` — even if the key is intercepted, the UUIDs reveal nothing about the patient's identity.
- No clinical data (diagnoses, medications, lab values) is stored in PostgreSQL metadata — only structural information (file size, MIME type, timestamps).

---

## 7. Assumptions

1. Authentication is simulated — no real JWT signing/verification. User is trusted from the decoded token payload.
2. No user management — users are not stored in the database. User IDs come from tokens.
3. Single-tenant system — one organization using the system.
4. No file versioning — uploading a new document creates a new record, not a new version.
5. File size limit is 10MB — suitable for typical medical documents (lab results, imaging reports as PDFs).
6. No delete/update operations on documents — immutability is a feature for compliance (documents are a permanent record).
7. The `patientId` in an upload request is trusted (in production, this would be validated against a patient registry).
8. Pagination defaults: page 1, limit 20, max limit 100.

---

## 8. Out of Scope

- User registration and management
- Password/credential management
- Real JWT token issuance and verification
- Document deletion or updates
- File versioning
- Multi-tenancy
- Frontend application
- Real-time notifications
- Full-text search
- Document categorization/tagging
