# AI Business Factory
## Technical Specification v0.1

**Document version:** 0.1  
**Date:** 30 September 2026  
**Status:** Implementation Specification  
**Parent document:** AI Business Factory Blueprint v0.1

---

# 1. Purpose

This document converts the AI Business Factory strategic blueprint into an implementable software architecture.

The first production objective is not to autonomously create dozens of businesses. It is to build a reliable system that can:

1. Discover online business opportunities.
2. Research publicly observable evidence.
3. Reverse-engineer business models.
4. Identify market gaps and differentiation opportunities.
5. Generate structured opportunity reports.
6. Store all research and agent activity.
7. Allow human review and approval.
8. Run validation experiments.
9. Eventually connect validated opportunities to business-building and revenue systems.

The system must be designed for progressive autonomy.

---

# 2. Product Definition

## Product Name

**AI Business Factory**

## Primary Application

A web-based AI business intelligence and venture-building platform.

## Initial User

The platform owner/operator.

## Initial Market Focus

Global opportunity discovery with an initial strategic emphasis on:

- Ghana
- Africa
- underserved international niches
- B2B opportunities
- recurring/repeatable revenue models

The geography must remain configurable.

---

# 3. V0.1 Scope

The first implementation contains:

```text
Authentication
RBAC
Dashboard
Opportunity Discovery
Research Pipeline
Business Model Analysis
Competitor Analysis
Opportunity Analysis
Opportunity Database
Agent Task System
Agent Execution Logs
Human Approval
Basic Analytics
```

Explicitly deferred:

```text
Fully autonomous business launching
Autonomous paid advertising
Autonomous financial transactions
Automated incorporation
Automated legal commitments
Full SaaS generation
Marketplace deployment
Portfolio capital allocation
```

These become later phases.

---

# 4. System Architecture

```text
                        ┌─────────────────────┐
                        │      React UI       │
                        │      MUI             │
                        └──────────┬──────────┘
                                   │
                              REST API
                                   │
                        ┌──────────▼──────────┐
                        │   Express Backend   │
                        └──────────┬──────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
   Agent Orchestrator        Business Services        Auth/RBAC
          │                        │
          ▼                        ▼
   ┌───────────────┐        ┌───────────────┐
   │ Agent Workers │        │ MongoDB       │
   │               │        │               │
   │ Scout         │        │ Opportunities │
   │ Research      │        │ Businesses    │
   │ Competitor    │        │ Experiments   │
   │ Model         │        │ Agent Runs    │
   │ Analyst       │        │ Tasks         │
   └───────┬───────┘        └───────────────┘
           │
           ▼
     External Tools
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
   Web   AI    Search
```

---

# 5. Technology Stack

## Frontend

- React
- MUI
- React Router
- Axios
- React Query / TanStack Query
- React Hook Form where appropriate

## Backend

- Node.js
- Express
- JavaScript ES Modules
- Mongoose

## Database

- MongoDB

## Authentication

- JWT
- bcrypt
- email verification
- refresh-token strategy where appropriate

## Agent Infrastructure

Initial implementation:

- Node.js agent workers
- OpenAI API
- structured JSON outputs
- MongoDB persistence

Future:

- Redis
- BullMQ
- dedicated worker processes
- event-driven orchestration

## Deployment

- Docker
- Nginx where required
- AWS/EC2 or equivalent
- environment-based configuration

---

# 6. Project Structure

```text
ai-business-factory/

├── backend/
│
│   ├── config/
│   │   ├── db.js
│   │   ├── env.js
│   │   └── ai.js
│   │
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── opportunityController.js
│   │   ├── discoveryController.js
│   │   ├── experimentController.js
│   │   └── agentController.js
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   ├── errorMiddleware.js
│   │   └── validationMiddleware.js
│   │
│   ├── models/
│   │   ├── User.js
│   │   ├── Opportunity.js
│   │   ├── BusinessModel.js
│   │   ├── Competitor.js
│   │   ├── Experiment.js
│   │   ├── AgentTask.js
│   │   ├── AgentRun.js
│   │   └── Source.js
│   │
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── opportunityRoutes.js
│   │   ├── discoveryRoutes.js
│   │   ├── experimentRoutes.js
│   │   └── agentRoutes.js
│   │
│   ├── agents/
│   │   ├── baseAgent.js
│   │   ├── opportunityScout.js
│   │   ├── researchAgent.js
│   │   ├── competitorAgent.js
│   │   ├── businessModelAgent.js
│   │   └── opportunityAnalyst.js
│   │
│   ├── orchestrator/
│   │   ├── orchestrator.js
│   │   ├── workflowRegistry.js
│   │   └── taskRunner.js
│   │
│   ├── services/
│   │   ├── aiService.js
│   │   ├── researchService.js
│   │   ├── opportunityService.js
│   │   └── sourceService.js
│   │
│   ├── utils/
│   └── server.js
│
├── frontend/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── context/
│       ├── hooks/
│       ├── layouts/
│       ├── pages/
│       │   ├── Login/
│       │   ├── Dashboard/
│       │   ├── Opportunities/
│       │   ├── OpportunityDetails/
│       │   ├── Experiments/
│       │   ├── Agents/
│       │   └── Settings/
│       ├── routes/
│       ├── utils/
│       ├── App.jsx
│       └── main.jsx
│
├── docker/
├── .env.example
├── package.json
└── README.md
```

---

# 7. User Roles

Initial roles:

```text
OWNER
ADMIN
ANALYST
VIEWER
```

## OWNER

Full access.

Can:

- configure agents
- approve opportunities
- start workflows
- manage users
- view financial information
- configure integrations

## ADMIN

Operational administration.

## ANALYST

Can:

- run research
- create opportunities
- analyze businesses
- create experiments

Cannot approve major actions.

## VIEWER

Read-only.

---

# 8. Authentication

Required capabilities:

```text
Register
Login
Logout
Email Verification
Forgot Password
Reset Password
JWT Authentication
Role Authorization
```

Example middleware:

```javascript
export const protect = async (req, res, next) => {
  // verify JWT
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    next();
  };
};
```

---

# 9. Core Data Models

## 9.1 User

```javascript
{
  name,
  email,
  passwordHash,
  role,
  emailVerified,
  isActive,
  lastLoginAt,
  createdAt,
  updatedAt
}
```

---

# 10. Opportunity Model

```javascript
{
  name,
  slug,

  category,

  description,

  sourceIds: [],

  targetCustomer: {
    segment,
    businessType,
    geography
  },

  problem,

  proposedSolution,

  businessModel: {
    type,
    revenueMechanism
  },

  pricing: {
    minimum,
    maximum,
    currency,
    pricingEvidence
  },

  acquisitionChannels: [],

  retentionMechanism,

  demandSignals: [
    {
      source,
      observation,
      evidence,
      strength
    }
  ],

  competitors: [],

  differentiation: [
    {
      idea,
      rationale,
      geography
    }
  ],

  economics: {
    estimatedCAC,
    estimatedLTV,
    estimatedARPU,
    estimatedMargin,
    confidence
  },

  complexity: {
    technical,
    operational,
    capital
  },

  risks: [
    {
      category,
      description,
      severity
    }
  ],

  evidence: [
    {
      claim,
      sourceId,
      confidence
    }
  ],

  hypotheses: [],

  validationPlan: {
    objective,
    method,
    budget,
    successCriteria
  },

  status,

  createdBy,
  approvedBy,
  approvedAt,

  createdAt,
  updatedAt
}
```

---

# 11. Source Model

Every externally derived factual claim should be traceable.

```javascript
{
  title,
  url,
  domain,
  sourceType,

  retrievedAt,

  publisher,

  publishedAt,

  contentSummary,

  reliability,

  opportunityIds: []
}
```

Source types:

```text
company
pricing_page
news
research
marketplace
community
social
directory
search
government
app_store
other
```

---

# 12. Business Model Model

```javascript
{
  opportunityId,

  customer,
  problem,
  valueProposition,
  product,
  acquisition,
  conversion,
  pricing,
  revenueModel,
  delivery,
  retention,
  upsell,
  referral,

  operationalDependencies: [],
  technologyDependencies: [],

  confidence,

  generatedByAgent,
  createdAt
}
```

---

# 13. Competitor Model

```javascript
{
  opportunityId,

  name,
  website,

  customerSegment,
  geography,

  products: [],

  pricing: [],

  businessModel,

  acquisitionChannels: [],

  strengths: [],
  weaknesses: [],

  customerComplaints: [],

  differentiationOpportunities: [],

  evidenceIds: []
}
```

---

# 14. Experiment Model

```javascript
{
  opportunityId,

  name,

  hypothesis,

  objective,

  method,

  targetCustomer,

  budget,

  startDate,
  endDate,

  metrics: [
    {
      name,
      target,
      actual
    }
  ],

  successCriteria,

  results,

  conclusion,

  nextAction,

  status
}
```

Statuses:

```text
draft
approved
running
completed
cancelled
```

---

# 15. Agent Task Model

```javascript
{
  agentType,

  workflow,

  objective,

  input,

  outputSchema,

  priority,

  status,

  requestedBy,

  startedAt,
  completedAt,

  retryCount,

  error
}
```

Statuses:

```text
pending
running
completed
failed
cancelled
```

---

# 16. Agent Run Model

Agent tasks represent work to perform.

Agent runs represent actual execution.

```javascript
{
  taskId,

  agentType,

  model,

  input,

  output,

  sourcesUsed: [],

  tokenUsage,

  duration,

  status,

  error,

  startedAt,
  completedAt
}
```

This is necessary for debugging and cost monitoring.

---

# 17. Agent Contract

Every agent should follow a common interface.

```javascript
class BaseAgent {
  constructor(config) {
    this.name = config.name;
    this.version = config.version;
  }

  async execute(input) {
    throw new Error("execute() must be implemented");
  }

  validateOutput(output) {
    return true;
  }
}
```

Every agent must define:

```text
Input schema
Output schema
Objective
Tools
Allowed actions
Failure behavior
Confidence handling
```

---

# 18. Opportunity Scout Agent

## Input

```javascript
{
  market,
  geography,
  categories,
  revenueModels,
  targetCount
}
```

Example:

```javascript
{
  market: "online business",
  geography: ["Ghana", "Africa"],
  categories: ["B2B software"],
  revenueModels: ["subscription"],
  targetCount: 20
}
```

## Output

```javascript
{
  opportunities: [
    {
      name,
      category,
      description,
      source,
      customer,
      problem,
      businessModel,
      initialEvidence
    }
  ]
}
```

The Scout should not make strong profitability claims.

Its job is discovery.

---

# 19. Research Agent

Input:

```javascript
{
  opportunityId,
  researchQuestions: []
}
```

Output:

```javascript
{
  marketEvidence: [],
  customerEvidence: [],
  pricingEvidence: [],
  competitorEvidence: [],
  businessModelEvidence: [],
  uncertainties: []
}
```

The Research Agent must attach source records to factual findings.

---

# 20. Competitor Agent

Input:

```javascript
{
  opportunityId,
  competitors: []
}
```

Output:

```javascript
{
  competitors: [
    {
      name,
      website,
      customer,
      product,
      pricing,
      acquisition,
      strengths,
      weaknesses,
      evidence
    }
  ]
}
```

The agent should not invent pricing or customer information.

Unknown fields should remain unknown.

---

# 21. Business Model Agent

The Business Model Agent transforms research into Business DNA.

```text
Customer
Problem
Solution
Acquisition
Conversion
Pricing
Revenue
Delivery
Retention
Expansion
```

It should distinguish:

```text
VERIFIED
ESTIMATED
INFERRED
UNKNOWN
```

---

# 22. Opportunity Analyst

The Analyst evaluates:

```text
Demand
Competition
Customer pain
Monetization
Recurring revenue potential
Acquisition difficulty
Margin potential
Technical complexity
Operational complexity
Regulatory considerations
Capital requirement
Differentiation
Localization
```

Output:

```javascript
{
  opportunityId,

  analysis: {
    demand,
    competition,
    monetization,
    recurringRevenue,
    acquisition,
    margin,
    complexity,
    localization,
    differentiation
  },

  uncertainties: [],

  validationRecommendation
}
```

The Analyst should not present uncertain estimates as established facts.

---

# 23. Orchestrator

The orchestrator coordinates agents.

Example workflow:

```text
DISCOVERY_WORKFLOW

1. Create Scout Task
2. Run Scout
3. Validate output
4. Deduplicate
5. Create Research Tasks
6. Run Research Agents
7. Create Competitor Tasks
8. Run Competitor Agents
9. Create Business Model Tasks
10. Run Business Model Agents
11. Create Opportunity Analysis Tasks
12. Run Analyst
13. Persist final opportunity records
14. Notify user
```

---

# 24. Workflow State Machine

```text
DISCOVERED
    ↓
RESEARCHING
    ↓
ANALYZING
    ↓
VALIDATED
    ↓
AWAITING_APPROVAL
    ↓
APPROVED
    ↓
EXPERIMENT
    ↓
BUILDING
    ↓
LAUNCHED
    ↓
SCALING
```

Alternative:

```text
ANY STAGE
   ↓
PAUSED
   ↓
REJECTED
```

---

# 25. API Design

## Authentication

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/verify-email
POST /api/auth/forgot-password
POST /api/auth/reset-password
```

---

# 26. Opportunity APIs

```http
GET    /api/opportunities
POST   /api/opportunities
GET    /api/opportunities/:id
PATCH  /api/opportunities/:id
DELETE /api/opportunities/:id
POST   /api/opportunities/:id/approve
POST   /api/opportunities/:id/reject
POST   /api/opportunities/:id/analyze
```

---

# 27. Discovery APIs

```http
POST /api/discovery/run
GET  /api/discovery/runs
GET  /api/discovery/runs/:id
POST /api/discovery/runs/:id/cancel
```

Example:

```json
{
  "market": "B2B online businesses",
  "geography": ["Ghana", "Africa"],
  "revenueModels": ["subscription", "service"],
  "targetCount": 20
}
```

Response:

```json
{
  "runId": "...",
  "status": "queued"
}
```

---

# 28. Experiment APIs

```http
GET    /api/experiments
POST   /api/experiments
GET    /api/experiments/:id
PATCH  /api/experiments/:id
POST   /api/experiments/:id/start
POST   /api/experiments/:id/complete
```

---

# 29. Agent APIs

```http
GET  /api/agents
GET  /api/agents/runs
GET  /api/agents/runs/:id
POST /api/agents/:agent/run
```

Direct agent execution should initially be restricted to OWNER and ADMIN roles.

---

# 30. Dashboard APIs

```http
GET /api/dashboard/summary
GET /api/dashboard/opportunities
GET /api/dashboard/agent-activity
GET /api/dashboard/experiments
```

Example summary:

```json
{
  "opportunities": 120,
  "validated": 14,
  "approved": 5,
  "experimentsRunning": 3,
  "agentsRunning": 4
}
```

---

# 31. Frontend Pages

## Login

```text
Email
Password
Login
Forgot Password
```

## Dashboard

```text
Opportunity count
Validated opportunities
Active experiments
Agent activity
Recent discoveries
```

## Opportunities

```text
Search
Filters
Category
Geography
Revenue model
Status
Demand
Complexity
```

## Opportunity Details

Tabs:

```text
Overview
Evidence
Business Model
Competitors
Economics
Differentiation
Experiments
Agent Runs
Decision
```

---

# 32. Opportunity Details Layout

```text
┌──────────────────────────────────────────────┐
│ AI Procurement Intelligence                 │
│ Status: Validated                            │
├──────────────────────────────────────────────┤
│ CUSTOMER                                     │
│ SMEs / distributors                          │
├──────────────────────────────────────────────┤
│ PROBLEM                                      │
│ Supplier discovery and price intelligence    │
├──────────────────────────────────────────────┤
│ BUSINESS MODEL                               │
│ Subscription + lead generation               │
├──────────────────────────────────────────────┤
│ EVIDENCE                                     │
│ Source 1                                     │
│ Source 2                                     │
│ Source 3                                     │
├──────────────────────────────────────────────┤
│ COMPETITORS                                  │
│ Competitor A | Competitor B | Competitor C   │
├──────────────────────────────────────────────┤
│ VALIDATION                                   │
│ [Create Experiment]                          │
├──────────────────────────────────────────────┤
│ DECISION                                     │
│ [Approve] [Reject] [Pause]                   │
└──────────────────────────────────────────────┘
```

---

# 33. Agent Activity Interface

```text
Agent Activity

Opportunity Scout
RUNNING
12 opportunities found

Research Agent
COMPLETED
8 sources analyzed

Competitor Agent
RUNNING
4 competitors analyzed

Business Model Agent
QUEUED
```

Clicking an agent run should show:

```text
Input
Model
Tools
Sources
Output
Duration
Token usage
Errors
Timestamp
```

---

# 34. Discovery Run UI

User selects:

```text
Market
Geography
Category
Revenue model
Target count
Minimum evidence level
```

Then:

```text
[ RUN DISCOVERY ]
```

Progress:

```text
Discovering .............. 20%
Researching .............. 45%
Analyzing ................ 70%
Structuring .............. 90%
Completed ................ 100%
```

---

# 35. Evidence Architecture

Evidence is a first-class component.

Every important claim should have:

```text
Claim
Source
URL
Retrieved date
Publisher
Evidence type
Confidence
```

Example:

```javascript
{
  claim: "Competitor uses monthly subscription pricing",
  sourceId: "...",
  confidence: "high"
}
```

The interface should allow the user to inspect the evidence.

---

# 36. AI Output Rules

AI agents must:

1. Avoid fabricating sources.
2. Mark uncertainty.
3. Separate facts from estimates.
4. Preserve source URLs.
5. Avoid claiming profitability without evidence.
6. Avoid copying protected content.
7. Avoid copying proprietary code.
8. Avoid copying trademarks or branding.
9. Generate independent differentiation.
10. Record assumptions.

---

# 37. Prompt Architecture

Each agent should use:

```text
SYSTEM PROMPT
+
AGENT ROLE
+
TASK OBJECTIVE
+
KNOWN DATA
+
SOURCE DATA
+
CONSTRAINTS
+
OUTPUT JSON SCHEMA
```

Example:

```text
You are the Business Model Analyst.

Your task is to reconstruct the observable business model
of the supplied company using only the provided evidence.

Separate:
- verified facts
- reasonable estimates
- hypotheses
- unknown information.

Do not invent pricing, customers, revenue or market size.

Return valid JSON matching the supplied schema.
```

---

# 38. Cost Management

Every AI run should record:

```text
Model
Input tokens
Output tokens
Estimated cost
Duration
Task
Opportunity
```

This enables:

```text
AI cost / opportunity
AI cost / validated opportunity
AI cost / customer
AI cost / revenue
```

These become important portfolio metrics later.

---

# 39. Error Handling

Agent errors should never silently disappear.

Every failure should contain:

```text
Agent
Task
Error type
Message
Retry count
Timestamp
Input reference
```

Retry strategy:

```text
Attempt 1
   ↓
Failure
   ↓
Retry
   ↓
Failure
   ↓
Fallback / Human Review
```

Do not retry indefinitely.

---

# 40. Security

Required:

- password hashing
- JWT validation
- role-based authorization
- request validation
- rate limiting
- secure HTTP headers
- environment secrets
- audit logs
- input sanitization
- API authentication
- least-privilege tool access

Never store API keys in source code.

---

# 41. Audit Trail

Material actions should create audit records.

Examples:

```text
Opportunity approved
Opportunity rejected
Experiment started
Agent manually executed
User role changed
Integration changed
Business launched
Financial action approved
```

Audit structure:

```javascript
{
  userId,
  action,
  entityType,
  entityId,
  metadata,
  timestamp
}
```

---

# 42. Agent Permissions

Agents should not automatically have unrestricted access.

Example:

```text
Scout
READ: web/search
WRITE: opportunities

Research
READ: sources/opportunities
WRITE: research

Analyst
READ: research
WRITE: analysis

Builder
READ: approved opportunities
WRITE: project artifacts

Financial Agent
READ: business metrics
WRITE: financial reports
```

Permission boundaries should be enforced in software.

---

# 43. First End-to-End Workflow

The initial workflow:

```text
USER
 │
 │ "Find 20 B2B opportunities"
 ▼
DISCOVERY API
 │
 ▼
ORCHESTRATOR
 │
 ▼
OPPORTUNITY SCOUT
 │
 ▼
CANDIDATE LIST
 │
 ▼
DEDUPLICATION
 │
 ▼
RESEARCH AGENT
 │
 ▼
COMPETITOR AGENT
 │
 ▼
BUSINESS MODEL AGENT
 │
 ▼
OPPORTUNITY ANALYST
 │
 ▼
PERSIST
 │
 ▼
DASHBOARD
 │
 ▼
HUMAN REVIEW
```

---

# 44. First Acceptance Test

The system is ready for V0.1 when it can:

1. Authenticate a user.
2. Start a discovery run.
3. Create agent tasks.
4. Execute the Opportunity Scout.
5. Collect research sources.
6. Create structured opportunity records.
7. Analyze business models.
8. Identify competitors.
9. Store evidence.
10. Display results in React.
11. Show agent execution history.
12. Allow the owner to approve/reject opportunities.
13. Create a validation experiment.
14. Preserve an audit trail.

---

# 45. Phase 1 Build Sequence

## Sprint 1 — Foundation

```text
Project setup
MongoDB
Express
React
MUI
Authentication
RBAC
Environment configuration
Error handling
```

## Sprint 2 — Opportunity Core

```text
Opportunity model
Source model
Business Model model
Competitor model
Opportunity APIs
Dashboard
Opportunity list
Opportunity details
```

## Sprint 3 — Agent Framework

```text
Base Agent
Agent Task
Agent Run
Orchestrator
AI Service
Structured output
Logging
```

## Sprint 4 — Discovery

```text
Opportunity Scout
Research Agent
Competitor Agent
Business Model Agent
Opportunity Analyst
Discovery workflow
```

## Sprint 5 — Validation

```text
Experiment model
Experiment APIs
Experiment UI
Evidence UI
Approval workflow
```

## Sprint 6 — Hardening

```text
Security
Rate limits
Retry handling
Audit logs
Cost tracking
Testing
Docker
Deployment
```

---

# 46. V0.2

After V0.1 works:

```text
Trend Agent
Market Scanner
Better source discovery
Scheduled discovery
Opportunity alerts
Saved research
Vector knowledge base
```

---

# 47. V0.3

Business validation:

```text
Landing Page Factory
Lead Capture
Customer Interview Workflow
Experiment Analytics
Payment Integration
CRM
Pre-order / Pilot Workflow
```

---

# 48. V0.4

Business Factory:

```text
Business Architect
Brand Generator
Website Generator
SaaS Starter Generator
Service Business Generator
Deployment Pipeline
```

---

# 49. V0.5

Growth:

```text
SEO Agent
Content Agent
Outbound Agent
Sales Agent
Email workflows
Customer onboarding
Retention
```

---

# 50. V1.0

Portfolio Operating System:

```text
Multiple Businesses
Revenue Tracking
CFO Agent
Portfolio Manager
Capital Allocation Support
Replication Engine
Business Knowledge Graph
```

---

# 51. Long-Term Architecture

```text
                    AI BUSINESS OS
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
     DISCOVERY         FACTORY          PORTFOLIO
          │               │                │
          ▼               ▼                ▼
    Opportunities      Businesses       Metrics
          │               │                │
          └───────────────┼────────────────┘
                          ▼
                    KNOWLEDGE GRAPH
                          │
                          ▼
                    LEARNING LOOP
                          │
                          ▼
                  BETTER DISCOVERY
```

---

# 52. Implementation Philosophy

The project should follow these principles:

### 1. Evidence before automation

Do not automate an unvalidated assumption.

### 2. Smallest viable experiment

Use the cheapest credible test.

### 3. Modular agents

Every agent should be replaceable.

### 4. Structured outputs

Avoid relying on free-form AI responses.

### 5. Traceability

Every material conclusion should have supporting evidence.

### 6. Human gates

Keep high-impact actions under human control initially.

### 7. Reusable infrastructure

Every successful business should contribute reusable software and operational components.

### 8. Cost awareness

AI infrastructure must be treated as a business cost.

### 9. Independent differentiation

The system learns business patterns but creates original implementations.

### 10. Progressive autonomy

Autonomy increases only after workflows demonstrate reliability.

---

# 53. Immediate Coding Target

The first code milestone should be:

```text
AI Business Factory v0.1

Backend:
- Express
- MongoDB
- Auth
- Opportunity APIs
- Agent framework
- Orchestrator

Agents:
- Opportunity Scout
- Research Agent
- Competitor Agent
- Business Model Agent
- Opportunity Analyst

Frontend:
- Login
- Dashboard
- Opportunities
- Opportunity Details
- Agents
- Experiments

Workflow:
"Find 20 B2B online opportunities
for Ghana/Africa with recurring
or repeatable revenue potential."
```

---

# 54. Definition of Done

V0.1 is complete when a user can log in, click **Run Discovery**, provide a market request, and receive a structured, evidence-backed set of opportunities that can be reviewed, approved, rejected, or converted into validation experiments.

The system should retain:

```text
What was discovered
Why it was discovered
What evidence was used
What the AI inferred
What remains uncertain
Which agents participated
How much AI processing was used
What the human decided
What experiment should happen next
```

This creates the foundation for the eventual AI Business Factory.

---

# 55. Next Document

After this Technical Specification, the next implementation artifact should be:

**AI Business Factory — Database & API Specification v0.1**

It should define:

- complete Mongoose schemas
- indexes
- validation rules
- API request/response contracts
- error formats
- authentication flow
- agent task states
- workflow states
- pagination
- filtering
- sorting
- audit events
- example API payloads
- Postman/HTTP test cases

That document can then be followed directly by the actual code implementation.
