# AI Business Factory — Database & API Specification v0.1

**Date:** 30 September 2026  
**Status:** Implementation-ready draft  
**Stack:** Node.js, Express, MongoDB/Mongoose, React  
**Parent:** AI Business Factory — Technical Specification v0.1

## 1. Purpose

This specification converts the technical architecture into concrete backend contracts: database schemas, indexes, validation, APIs, authentication/RBAC, workflow states, agent execution, audit events, error formats, testing, and implementation order.

The governing rule is **evidence before conclusions**. Agent output must distinguish `VERIFIED`, `SUPPORTED`, `ESTIMATED`, `INFERRED`, `ASSUMED`, and `UNKNOWN`.

## 2. Core collections

```text
users
opportunities
sources
businessmodels
competitors
experiments
agenttasks
agentruns
auditevents
```

Future collections: `businesses`, `customers`, `leads`, `products`, `services`, `campaigns`, `revenueevents`, `subscriptions`, `integrations`, `knowledgechunks`, and `notifications`.

## 3. Backend structure

```text
backend/
├── config/          # db, env, security
├── controllers/     # HTTP boundary
├── middleware/      # auth, RBAC, validation, errors, rate limits
├── models/          # Mongoose schemas
├── routes/
├── agents/          # agent implementations
├── orchestrator/    # workflows and task creation
├── services/        # business logic
├── validators/
├── utils/
└── server.js
```

## 4. User model

```javascript
{
  name: String,
  email: String,                  // unique, lowercase, indexed
  passwordHash: String,           // select:false
  role: "OWNER|ADMIN|ANALYST|VIEWER",
  isEmailVerified: Boolean,
  emailVerificationTokenHash: String,
  emailVerificationExpiresAt: Date,
  passwordResetTokenHash: String,
  passwordResetExpiresAt: Date,
  refreshTokenVersion: Number,
  lastLoginAt: Date,
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

Roles:

| Capability | OWNER | ADMIN | ANALYST | VIEWER |
|---|---:|---:|---:|---:|
| View opportunities | Yes | Yes | Yes | Yes |
| Create/edit | Yes | Yes | Yes | No |
| Run research agents | Yes | Yes | Yes | No |
| Approve | Yes | Yes | No | No |
| Create experiments | Yes | Yes | Yes | No |
| Manage users/config | Yes | Yes | No | No |

## 5. Opportunity model

```javascript
{
  name: String,
  slug: String,                   // unique
  category: String,
  description: String,
  sourceIds: [ObjectId],

  targetCustomer: {
    segment: String,
    businessType: String,
    geography: String
  },

  problem: String,
  proposedSolution: String,

  businessModel: {
    type: "SAAS|MARKETPLACE|AGENCY|PRODUCTIZED_SERVICE|SUBSCRIPTION|API|DATA|LEAD_GENERATION|AFFILIATE|DIGITAL_PRODUCT|COMMUNITY|MEDIA|EDUCATION|PROCUREMENT|DIRECTORY|AGGREGATOR|HYBRID|OTHER",
    revenueMechanism: String
  },

  pricing: {
    minimum: Number,
    maximum: Number,
    currency: String,
    pricingEvidence: String
  },

  acquisitionChannels: [String],
  retentionMechanism: String,

  demandSignals: [{
    source: String,
    observation: String,
    evidence: String,
    strength: "STRONG|MODERATE|WEAK|UNKNOWN"
  }],

  competitors: [ObjectId],

  differentiation: [{
    idea: String,
    rationale: String,
    geography: String
  }],

  economics: {
    estimatedCAC: Number,
    estimatedLTV: Number,
    estimatedARPU: Number,
    estimatedMargin: Number,
    confidence: "HIGH|MEDIUM|LOW|UNKNOWN"
  },

  complexity: {
    technical: "LOW|MEDIUM|HIGH",
    operational: "LOW|MEDIUM|HIGH",
    capital: "LOW|MEDIUM|HIGH"
  },

  risks: [{
    category: String,
    description: String,
    severity: "LOW|MEDIUM|HIGH|CRITICAL"
  }],

  evidence: [{
    claim: String,
    sourceId: ObjectId,
    evidenceType: "VERIFIED|SUPPORTED|ESTIMATED|INFERRED|ASSUMED|UNKNOWN",
    confidence: "HIGH|MEDIUM|LOW|UNKNOWN"
  }],

  hypotheses: [{
    statement: String,
    status: "UNTESTED|SUPPORTED|REFUTED|INCONCLUSIVE"
  }],

  validationPlan: {
    objective: String,
    method: String,
    budget: Number,
    successCriteria: String
  },

  status: "DISCOVERED|RESEARCHING|ANALYZING|VALIDATED|AWAITING_APPROVAL|APPROVED|EXPERIMENT|BUILDING|LAUNCHED|SCALING|PAUSED|REJECTED",

  createdBy: ObjectId,
  approvedBy: ObjectId,
  approvedAt: Date,
  isDeleted: Boolean,
  deletedAt: Date
}
```

Indexes:

```text
slug unique
category + status
targetCustomer.geography
status + createdAt
createdBy
text(name, description, problem)
```

## 6. Source model

```javascript
{
  title: String,
  url: String,                    // unique normalized URL
  domain: String,
  sourceType: "COMPANY_SITE|PRICING_PAGE|SEARCH_RESULT|PRODUCT_HUNT|REDDIT|APP_STORE|MARKETPLACE|JOB_BOARD|NEWS|REPORT|BLOG|SOCIAL|DIRECTORY|GOVERNMENT|OTHER",
  retrievedAt: Date,
  publisher: String,
  publishedAt: Date,
  contentSummary: String,
  reliability: "HIGH|MEDIUM|LOW|UNKNOWN",
  contentHash: String,
  opportunityIds: [ObjectId]
}
```

Deduplicate by normalized URL first and content hash second.

## 7. BusinessModel model

```javascript
{
  opportunityId: ObjectId,        // unique
  customer: String,
  problem: String,
  valueProposition: String,
  product: String,
  acquisition: String,
  conversion: String,
  pricing: String,
  revenueModel: String,
  delivery: String,
  retention: String,
  upsell: String,
  referral: String,
  operationalDependencies: [String],
  technologyDependencies: [String],
  confidence: "HIGH|MEDIUM|LOW|UNKNOWN",
  generatedByAgent: String
}
```

## 8. Competitor model

```javascript
{
  opportunityId: ObjectId,
  name: String,
  website: String,
  customerSegment: String,
  geography: String,
  products: [String],
  pricing: String,
  businessModel: String,
  acquisitionChannels: [String],
  strengths: [String],
  weaknesses: [String],
  customerComplaints: [String],
  differentiationOpportunities: [String],
  evidenceIds: [ObjectId]
}
```

Index: `{ opportunityId: 1, name: 1 }`.

## 9. Experiment model

```javascript
{
  opportunityId: ObjectId,
  name: String,
  hypothesis: String,
  objective: String,
  method: String,
  targetCustomer: String,
  budget: Number,
  currency: String,
  startDate: Date,
  endDate: Date,

  metrics: [{
    name: String,
    target: Mixed,
    actual: Mixed
  }],

  successCriteria: String,
  results: String,
  conclusion: String,
  nextAction: String,

  status: "DRAFT|READY|RUNNING|COMPLETED|CANCELLED",
  createdBy: ObjectId
}
```

## 10. AgentTask model

```javascript
{
  agentType: "OPPORTUNITY_SCOUT|RESEARCH|COMPETITOR|BUSINESS_MODEL|OPPORTUNITY_ANALYST",
  workflowId: String,
  workflow: String,
  objective: String,
  input: Mixed,
  outputSchema: Mixed,
  priority: "LOW|NORMAL|HIGH|URGENT",
  status: "QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED|RETRYING|WAITING_REVIEW",
  requestedBy: ObjectId,
  startedAt: Date,
  completedAt: Date,
  retryCount: Number,
  error: String
}
```

Indexes: `{status, priority, createdAt}`, `{workflowId, agentType}`.

## 11. AgentRun model

```javascript
{
  taskId: ObjectId,
  agentType: String,
  model: String,
  input: Mixed,
  output: Mixed,
  sourcesUsed: [ObjectId],

  tokenUsage: {
    inputTokens: Number,
    outputTokens: Number,
    totalTokens: Number
  },

  estimatedCost: Number,
  durationMs: Number,
  status: "STARTED|COMPLETED|FAILED|CANCELLED",
  error: String,
  startedAt: Date,
  completedAt: Date
}
```

## 12. AuditEvent model

```javascript
{
  actorId: ObjectId,
  actorType: "USER|AGENT|SYSTEM",
  action: String,
  resourceType: String,
  resourceId: ObjectId,
  before: Mixed,
  after: Mixed,
  metadata: Mixed,
  ipAddress: String,
  userAgent: String,
  requestId: String
}
```

Audit events are append-only.

## 13. Opportunity state machine

```text
DISCOVERED
 → RESEARCHING
 → ANALYZING
 → VALIDATED
 → AWAITING_APPROVAL
 → APPROVED
 → EXPERIMENT
 → BUILDING
 → LAUNCHED
 → SCALING
```

`PAUSED` and `REJECTED` are controlled alternative exits. State transitions are enforced server-side and audited.

## 14. Agent state machine

```text
QUEUED → RUNNING → COMPLETED
              ↓
            FAILED → RETRYING → QUEUED
              ↓
        WAITING_REVIEW
```

Default maximum retries: `3`. Permanent validation errors are not retried.

## 15. Authentication

Endpoints:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
GET  /api/auth/verify-email
POST /api/auth/resend-verification
POST /api/auth/forgot-password
POST /api/auth/reset-password
```

Production strategy:

```text
short-lived JWT access token
+
Secure/HttpOnly/SameSite refresh cookie
+
refresh-token rotation
+
token-version invalidation
```

Verification/reset tokens are random, hashed before storage, expiring, and single-use.

## 16. Standard responses

Success:

```json
{
  "success": true,
  "data": {},
  "meta": { "requestId": "req_123" }
}
```

Paginated:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "requestId": "req_123",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 87,
      "pages": 5,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": []
  },
  "meta": { "requestId": "req_125" }
}
```

Key error codes:

```text
VALIDATION_ERROR
AUTH_REQUIRED
INVALID_CREDENTIALS
EMAIL_NOT_VERIFIED
TOKEN_EXPIRED
TOKEN_INVALID
FORBIDDEN
RESOURCE_NOT_FOUND
RESOURCE_CONFLICT
INVALID_STATE_TRANSITION
AGENT_ERROR
AGENT_TIMEOUT
EXTERNAL_SERVICE_ERROR
RATE_LIMIT_EXCEEDED
INTERNAL_ERROR
```

## 17. Route map

```text
/api
├── /auth
├── /opportunities
│   ├── GET /
│   ├── POST /
│   ├── GET /:id
│   ├── PATCH /:id
│   ├── DELETE /:id
│   ├── POST /:id/analyze
│   ├── POST /:id/approve
│   └── POST /:id/reject
├── /discovery
│   ├── POST /run
│   ├── GET /runs
│   ├── GET /runs/:id
│   └── POST /runs/:id/cancel
├── /experiments
│   ├── GET /
│   ├── POST /
│   ├── GET /:id
│   ├── PATCH /:id
│   ├── POST /:id/start
│   └── POST /:id/complete
├── /agents
│   ├── GET /
│   ├── GET /runs
│   ├── GET /runs/:id
│   └── POST /:agentType/run
└── /dashboard
    ├── GET /summary
    ├── GET /opportunities
    ├── GET /agent-activity
    └── GET /experiments
```

## 18. Discovery contract

```http
POST /api/discovery/run
```

```json
{
  "objective": "Find 20 B2B business opportunities adaptable to Ghana or other African markets.",
  "count": 20,
  "market": "Ghana",
  "customerType": "B2B",
  "revenuePreference": [
    "SUBSCRIPTION",
    "TRANSACTION",
    "PRODUCTIZED_SERVICE"
  ],
  "constraints": {
    "capital": "LOW_TO_MEDIUM",
    "preference": "Existing customer spending"
  }
}
```

Returns `202 Accepted`:

```json
{
  "success": true,
  "data": {
    "runId": "66fabcd123456789abcdef12",
    "status": "QUEUED"
  }
}
```

Pipeline:

```text
Discovery request
 → Scout
 → Validate
 → Deduplicate
 → Research
 → Competitor analysis
 → Business model analysis
 → Opportunity analysis
 → Persist
 → Human review
```

## 19. Experiment contract

Create:

```http
POST /api/experiments
```

```json
{
  "opportunityId": "66f123456789abcdef123456",
  "name": "Landing Page Demand Test",
  "hypothesis": "At least 5% of targeted visitors will submit an interest form.",
  "objective": "Measure initial demand.",
  "method": "Landing page plus targeted outbound traffic.",
  "targetCustomer": "Ghanaian SME owners",
  "budget": 500,
  "currency": "GHS",
  "successCriteria": "20 qualified leads from 400 targeted visitors."
}
```

Lifecycle:

```text
DRAFT → READY → RUNNING → COMPLETED
                         ↘ CANCELLED
```

## 20. Common agent contract

```json
{
  "status": "COMPLETED",
  "confidence": "MEDIUM",
  "findings": [],
  "sources": [],
  "assumptions": [],
  "uncertainties": [],
  "recommendations": []
}
```

Agents must not state unsupported profitability claims.

## 21. Opportunity Scout input/output

Input:

```json
{
  "market": "online business",
  "geography": ["Ghana", "Africa"],
  "categories": ["B2B software"],
  "revenueModels": ["subscription"],
  "targetCount": 20
}
```

Output candidates contain:

```text
name
category
description
customer
problem
observedBusinessModel
demandSignals
sources
```

The Scout discovers; it does not make the final investment decision.

## 22. Research Agent output

```json
{
  "marketEvidence": [],
  "customerEvidence": [],
  "pricingEvidence": [],
  "competitorEvidence": [],
  "businessModelEvidence": [],
  "sources": [],
  "uncertainties": []
}
```

## 23. Business Model Agent output

```json
{
  "customer": {
    "value": "SMEs needing bookkeeping",
    "evidenceType": "SUPPORTED"
  },
  "problem": {
    "value": "Bookkeeping is inconsistent or delayed",
    "evidenceType": "SUPPORTED"
  },
  "valueProposition": {
    "value": "Automated bookkeeping visibility",
    "evidenceType": "INFERRED"
  },
  "pricing": {
    "value": "Monthly subscription",
    "evidenceType": "VERIFIED"
  },
  "revenueModel": "SUBSCRIPTION"
}
```

## 24. Opportunity Analyst output

```json
{
  "assessment": {
    "demand": { "value": "MODERATE", "confidence": "MEDIUM" },
    "competition": { "value": "MODERATE", "confidence": "MEDIUM" },
    "monetization": { "value": "POSSIBLE", "confidence": "MEDIUM" },
    "recurringRevenuePotential": { "value": "HIGH", "confidence": "LOW" },
    "acquisitionDifficulty": "MEDIUM",
    "technicalComplexity": "MEDIUM",
    "operationalComplexity": "MEDIUM",
    "capitalRequirement": "LOW_TO_MEDIUM",
    "differentiationOpportunities": [],
    "risks": [],
    "validationRecommendation": {}
  }
}
```

## 25. Pagination/filtering/sorting

Default page size: `20`; maximum: `100`.

Allowed sort fields:

```text
createdAt
updatedAt
name
status
category
```

Filters must be constructed from a whitelist. Never pass arbitrary query expressions directly to MongoDB.

Initial text search:

```text
name
description
problem
```

Future:

```text
MongoDB text → Atlas Search → semantic/vector search
```

## 26. Audit events

Recommended events:

```text
USER_REGISTERED
USER_LOGIN
USER_LOGOUT
EMAIL_VERIFIED
PASSWORD_RESET_COMPLETED
OPPORTUNITY_CREATED
OPPORTUNITY_UPDATED
OPPORTUNITY_DELETED
OPPORTUNITY_APPROVED
OPPORTUNITY_REJECTED
OPPORTUNITY_STATUS_CHANGED
DISCOVERY_STARTED
DISCOVERY_COMPLETED
DISCOVERY_CANCELLED
AGENT_TASK_CREATED
AGENT_TASK_STARTED
AGENT_TASK_COMPLETED
AGENT_TASK_FAILED
AGENT_TASK_RETRIED
AGENT_RUN_STARTED
AGENT_RUN_COMPLETED
AGENT_RUN_FAILED
EXPERIMENT_CREATED
EXPERIMENT_STARTED
EXPERIMENT_COMPLETED
EXPERIMENT_CANCELLED
USER_ROLE_CHANGED
SYSTEM_CONFIGURATION_CHANGED
```

## 27. Request IDs and idempotency

Every request receives `X-Request-ID`.

For retry-sensitive operations support:

```http
Idempotency-Key: discovery-2026-001
```

Especially for discovery, experiment start, and manual agent-run endpoints.

## 28. Security

Minimum requirements:

```text
password hashing
JWT validation
short-lived access tokens
refresh-token rotation
HttpOnly refresh cookies
email verification
hashed reset tokens
rate limiting
CORS
secure headers
request validation
input sanitization
audit logging
environment secrets
least-privilege agent access
HTTPS in production
```

## 29. Agent permissions

| Agent | Read | Write | External |
|---|---|---|---|
| Scout | discovery request | candidates | research/search |
| Research | opportunities | sources/evidence | research/search |
| Competitor | evidence | competitor records | research/search |
| Business Model | research | business model | none |
| Analyst | research/models | analysis | none |

Financial, legal, customer-facing, or irreversible actions require separate human-controlled permission gates.

## 30. Concurrency

Use atomic conditional updates for state changes:

```javascript
await Opportunity.findOneAndUpdate(
  { _id: id, status: "AWAITING_APPROVAL" },
  {
    $set: {
      status: "APPROVED",
      approvedBy: userId,
      approvedAt: new Date()
    }
  },
  { new: true }
);
```

This prevents duplicate approvals caused by concurrent requests.

## 31. Cost tracking

Every AgentRun records token usage, estimated cost, duration, model, and status.

Future metrics:

```text
AI cost / opportunity
AI cost / validated opportunity
AI cost / experiment
AI cost / acquired customer
AI cost / revenue
```

## 32. Environment

```env
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/ai_business_factory

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

EMAIL_FROM=
EMAIL_PROVIDER_API_KEY=
OPENAI_API_KEY=

CLIENT_URL=http://localhost:3000
MAX_AGENT_RETRIES=3
```

Secrets must never be committed.

## 33. API test matrix

| Test | Expected |
|---|---|
| Register valid user | 201 |
| Duplicate email | 409 |
| Valid login | 200 |
| Invalid login | 401 |
| Protected route without token | 401 |
| Create opportunity | 201 |
| Invalid opportunity | 422 |
| Unknown opportunity | 404 |
| Approve as VIEWER | 403 |
| Valid ADMIN approval | 200 |
| Invalid state transition | 409 |
| Queue valid agent task | 202 |
| Agent failure | recorded FAILED |
| Retry transient failure | RETRYING → QUEUED |
| Retry limit exceeded | WAITING_REVIEW |

## 34. Smoke tests

```bash
curl -X POST http://localhost:3001/api/auth/register   -H "Content-Type: application/json"   -d '{"name":"Test Owner","email":"owner@example.com","password":"StrongPassword123!"}'
```

```bash
curl -X POST http://localhost:3001/api/discovery/run   -H "Content-Type: application/json"   -H "Authorization: Bearer ACCESS_TOKEN"   -d '{"objective":"Find 20 B2B opportunities adaptable to Ghana.","count":20,"market":"Ghana","customerType":"B2B"}'
```

## 35. Implementation order

1. **Foundation** — Express, MongoDB, configuration, logging, request IDs, errors, security.
2. **Authentication** — User, JWT, refresh, logout, verification, reset, RBAC.
3. **Opportunity core** — Opportunity, Source, BusinessModel, Competitor, Experiment.
4. **Audit** — AuditEvent and transition logging.
5. **Agent infrastructure** — AgentTask, AgentRun, BaseAgent, registry, validation, retry.
6. **Discovery** — orchestrator plus five initial agents.
7. **Frontend** — login, dashboard, opportunities, details, agent activity, experiments.
8. **Testing** — unit, integration, API, contract, workflow, and RBAC tests.

## 36. Definition of done

The Database/API layer is complete when authentication, RBAC, opportunity CRUD, evidence persistence, business models, competitors, experiments, agent tasks/runs, retries, audit events, pagination, filtering, sorting, request IDs, and API tests all work.

## 37. End-to-end acceptance test

```text
Register
 → Verify email
 → Login
 → Run Discovery
 → Scout
 → Research
 → Competitor analysis
 → Business model
 → Opportunity analysis
 → Evidence persisted
 → AWAITING_APPROVAL
 → Human approval
 → Experiment
 → Results
 → Next decision
 → Complete audit trail
```

If this flow works, the core AI Business Factory engine exists.

## 38. Core relationship map

```text
User
 └── creates → Opportunity
                 ├── references → Source
                 ├── has one → BusinessModel
                 ├── has many → Competitor
                 ├── has many → Experiment
                 └── triggers → AgentTask
                                  └── produces → AgentRun

Material actions → AuditEvent
```

## 39. Business lifecycle

```text
Opportunity
 → Evidence
 → Analysis
 → Validation
 → Approved Concept
 → Experiment
 → Pilot
 → Business
 → Revenue
 → Automation
 → Optimization
 → Scale
 → Replication
```

An opportunity is not yet a business. A validated opportunity is not necessarily profitable. A launched business is not necessarily scalable.

## 40. Next engineering artifact

The next artifact should be **AI Business Factory — Backend Implementation v0.1**.

It should contain the actual executable backend: `package.json`, server setup, environment validation, MongoDB connection, complete Mongoose models, JWT/email verification, refresh tokens, RBAC, controllers/services/routes, audit service, BaseAgent, agent registry, AgentTask/AgentRun infrastructure, Discovery Orchestrator, initial five agents, tests, seed script, Dockerfile, Docker Compose, and local-development README.

At that point the project moves from specification into functioning software.
