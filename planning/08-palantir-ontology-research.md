# Palantir Ontology Deep Research
## Architecture, AIP, Maven, and Patterns for Ontology-Backed AI Agents

*Research compiled March 25, 2026*

---

## Table of Contents

1. [What is the Palantir Ontology?](#1-what-is-the-palantir-ontology)
2. [How the Ontology Connects AI/LLMs to Real-World Actions](#2-how-the-ontology-connects-aillms-to-real-world-actions)
3. [The Action Layer](#3-the-action-layer)
4. [Object Types, Properties, and Links](#4-object-types-properties-and-links)
5. [AIP Agent Framework](#5-aip-agent-framework)
6. [Guardrails and Constraints](#6-guardrails-and-constraints)
7. [The Semantic Layer Concept](#7-the-semantic-layer-concept)
8. [Maven and Military/Enterprise Use Cases](#8-maven-and-militaryenterprise-use-cases)
9. [OSDK (Ontology SDK)](#9-osdk-ontology-sdk)
10. [Open-Source Alternatives and Similar Architectures](#10-open-source-alternatives-and-similar-architectures)
11. [Architectural Patterns for a Food Delivery AI Dispatcher](#11-architectural-patterns-for-a-food-delivery-ai-dispatcher)

---

## 1. What is the Palantir Ontology?

### Core Definition

The Palantir Ontology is a **digital twin of an organization** -- a rich semantic layer that sits on top of all integrated digital assets (datasets, models, streams) and maps them to their real-world counterparts. It is not merely a schema or data model; it is an **operational semantic layer** where data becomes actionable.

The critical distinction from a traditional data warehouse:
- **Traditional**: Tables (`orders`, `customers`, `shipments`) exist for viewing/reporting
- **Ontology**: Objects with embedded actions -- an `Order` links to a `Customer` with `Shipments`, each with actionable operations like "reroute this shipment"

### Three-Layer Architecture

The Ontology comprises three conceptual layers:

#### 1. Ontology Language (Semantic Layer)
Models the semantic objects, links, properties, kinetic actions, automations, and logic definitions. This is the "what things exist and what they mean" layer. It answers: "What are the things that matter in our world?"

#### 2. Ontology Engine (Operational Layer)
Substantiates all Language components with read and write architectures. Manages millions of reads and writes simultaneously across heterogeneous infrastructure (data lakes, warehouses, operational databases, real-time systems). Provides:
- **Read architecture**: High-scale SQL queries, real-time subscription to state changes, materializations for mixed Human + AI teams
- **Write architecture**: Atomic and durable transactional updates, high-scale batch mutations, high-scale streams, Change Data Capture for low-latency mirroring with operational systems

#### 3. Ontology Toolchain (Developer Layer)
Enables developers to use the Ontology as a backend via the OSDK and DevOps tools. Functions as a "tool factory" for building AI-enabled applications.

### Core Components

The Ontology encodes four enterprise dimensions:
- **Data**: Unified semantic objects from disparate sources
- **Actions**: Traceable, governed workflows from simple transactions to multi-step orchestrations
- **Logic**: Business rules, ML models, LLM functions, and complex orchestrations
- **Security**: Granular policies governing interactions across tens of thousands of humans and agents

### Backend Architecture

**Ontology Metadata Service (OMS)**: Overarching service that defines all ontological entities -- object types, link types, action types, and their metadata.

**Object Storage V2**: The core backend, consisting of:
- **Object Databases**: Store indexed object data, provide fast querying and computation. Handle indexing, querying, and orchestrating edits.
- **Object Data Funnel**: Microservice that orchestrates data writes into the Ontology. Reads from Foundry datasources (datasets, restricted views, streaming sources) and user edits (from Actions), then indexes into object databases.

Key capacities:
- Tens of billions of objects per type
- Up to 10,000 objects editable in a single Action
- Up to 2,000 properties per object type
- Low-latency streaming datasource support
- Incremental object indexing (only new updates indexed)

### Data Flow: From Raw Sources to Ontology Objects

1. **Data Ingestion**: Raw data flows through connectors from any source (ERP, CRM, sensors, APIs, databases, files)
2. **Transformation**: Transforms (Python, SQL, Java) process raw data into clean datasets with complete lineage tracking
3. **Indexing**: The Object Data Funnel reads datasets and transforms them into Ontology format through parallelized Spark backend
4. **Storage**: Indexed objects stored in object databases for fast querying
5. **Sync**: When backing datasources update, automatic reindexing keeps objects current
6. **Writeback**: User/AI edits stored in a separate writeback layer; downstream logic can intelligently choose between original and edited values, all versioned and tracked

---

## 2. How the Ontology Connects AI/LLMs to Real-World Actions

### The Core Problem Palantir Solves

Language models alone lack enterprise context. They can generate text but cannot understand an organization's data, relationships, constraints, or operational workflows. The Ontology provides the **structured world model** that LLMs need to go from generating text to taking real-world action.

### The Tool-Calling Paradigm

The Ontology enables LLMs to go **beyond retrieval-augmented generation (RAG)** and instead interface with interconnected data, logic, and action primitives through an extensible tools paradigm.

How this works concretely:
1. **Objects become queryable context**: LLMs can query Ontology objects by type, filter by properties, traverse links -- all through structured tool calls
2. **Actions become callable tools**: Ontology Action Types are automatically surfaced as tools that LLMs can invoke
3. **Functions become available logic**: Published Functions (business logic, ML models, other AIP Logic functions) are callable by LLMs
4. **Security is enforced**: LLMs do not have direct access to tools; they can only *ask* to use tools, and these calls are executed within the invoking user's permissions

### The AI-to-Action Pipeline

```
[LLM Reasoning] -> [Tool Call Request] -> [Permission Check] -> [Action Validation] -> [Ontology Edit] -> [Writeback to Systems]
```

1. LLM reasons over provided ontology context (objects, properties, relationships)
2. LLM proposes a tool call (e.g., "apply action: reassign_driver")
3. Platform checks user/agent permissions for that action
4. Submission criteria validate business rules
5. Action rules execute ontology edits (create/modify/delete objects and links)
6. Side effects fire (notifications, webhooks to external systems)
7. Changes propagate to backing systems via writeback/CDC

### The "Version Control for Reality" Pattern

A key architectural pattern: AI-proposed changes can exist on **branches** (like Git), pending human review before touching production.

- AI proposes changes (e.g., "reroute 50 shipments")
- Proposal exists as a staged scenario
- Human reviews the decision log showing LLM reasoning
- Human accepts or rejects
- Accepted changes are applied atomically

This "pull request for operational decisions" pattern is critical for high-stakes environments.

---

## 3. The Action Layer

### What is an Action Type?

An Action Type is the schema definition of a set of changes or edits to objects, property values, and links that a user (or AI agent) can take at once. It also includes side effect behaviors that occur with submission.

Actions are the **kinetic element** of the Ontology -- they turn static data into operational capability.

### Action Type Components

#### Parameters
- Standardized input configurations with dropdowns, filters, defaults
- Support for object references, text, numbers, dates, attachments
- Parameters can reference existing objects or accept free-form input

#### Rules (What Happens When the Action Executes)

Two categories:

**Ontology Rules** (modify the Ontology):
- **Create object**: Generate new objects with required primary key and properties
- **Modify object(s)**: Update existing objects referenced through parameters
- **Create or modify object(s)**: Upsert -- update if exists, create if not
- **Delete object(s)**: Remove objects via reference parameters
- **Create link(s)**: Establish many-to-many relationships between objects
- **Delete link**: Remove relationships
- **Function rule**: Delegate all edits to a custom function (exclusive -- cannot combine with other rules)
- **Interface-based rules**: Operate across types implementing a specific interface

**Side Effect Rules** (trigger external behavior):
- **Notification**: Send in-platform or email notifications with customizable content
- **Webhooks**: Make HTTP requests to external systems, configurable to execute before or after edits. Action parameters can be passed through to the external request.

#### Value Mapping for Rules
Properties can be set from:
- **From parameter**: Existing action parameters
- **Object parameter property**: Properties from referenced objects
- **Static value**: Fixed values defined in the rule
- **Current User/Time**: Contextual values for audit fields

#### Submission Criteria (Validation / Guardrails)
Conditions that determine whether an action can be submitted. They encode business logic into data editing permissions.

Condition types:
- **Current User**: Check user ID, group membership, Multipass attributes
- **Parameter-Based**: Conditions on object properties and dynamic values

Operators: `is`, `is not`, `matches` (regex), `<`, `>`, `<=`, `>=`, `includes`, `includes any`, `is included in`, `each is`, `each is not`

Conditions combine via AND/OR/NOT with **custom failure messages** explaining why submission was blocked.

Example: Only flight controllers (group check) can change flights, and only for operational aircraft (status property check).

### Function-Backed Actions

For complex logic, Actions can delegate to code:

1. Write an Ontology Edit Function (TypeScript or Python) annotated with `@OntologyEditFunction()`
2. Publish the function
3. Configure an Action Type with a **Function Rule** pointing to the published function
4. Function parameters auto-map to action parameters

Key constraints:
- Function rules are **exclusive** -- cannot combine with other ontology rules
- Functions can create, modify, delete objects and links
- Edits only apply when executed through an Action (not in test/authoring mode)
- Functions cannot immediately search modified data within the same execution
- Version management: manual or auto-upgrade with semantic versioning

### Action Execution and Writeback

When an action executes:
1. All changes commit as a **single atomic transaction**
2. Modified data reflects immediately across all user-facing applications
3. Changes persist in writeback datasets/materializations
4. Downstream systems receive updates via:
   - API-driven updates to operational systems
   - Native Ontology-driven connectors (respecting target system safeguards)
   - Consolidated flat files for legacy systems
   - CDC (Change Data Capture) for low-latency mirroring

---

## 4. Object Types, Properties, and Links

### Object Types

An object type is the **schema definition of a real-world entity or event**. Think of it as a class definition.

- Analogous to a database table, but enriched with business meaning
- Each instance (object) corresponds to a single real-world entity
- Backed by one or more datasources (datasets, restricted views, streaming sources)

Example for food delivery:
- `Driver` -- a delivery driver
- `Order` -- a customer order
- `Restaurant` -- a restaurant partner
- `DeliveryZone` -- a geographic delivery area

### Properties

Properties define characteristics of object types (analogous to columns):

**Property Features**:
- **Shared properties**: Reusable across multiple object types (e.g., `location`, `status`, `created_at`)
- **Edit-only properties**: Only visible/editable in edit contexts
- **Required properties**: Mandatory fields
- **Derived properties**: Computed from other data
- **Property reducers**: Aggregate property values
- **Value types**: Semantic wrappers enforcing validation (email, URL, UUID, phone number)
- **Conditional formatting**: Display logic based on values

### Link Types

Link types define relationships between object types (analogous to foreign key joins, but richer):

- Defined with cardinality (one-to-one, one-to-many, many-to-many)
- Have direction (from type A to type B)
- Can have metadata
- Traversable in queries (search arounds)

Example links for food delivery:
- `Order` --placed_by--> `Customer` (many-to-one)
- `Order` --assigned_to--> `Driver` (many-to-one)
- `Order` --from_restaurant--> `Restaurant` (many-to-one)
- `Driver` --operates_in--> `DeliveryZone` (many-to-many)
- `Restaurant` --serves--> `DeliveryZone` (many-to-many)

### Interfaces (Polymorphism)

Interfaces describe the **shape** of an object type and its capabilities, enabling polymorphism.

- An interface defines a set of properties that implementing types must have
- Object types **implement** interfaces (like Java/TypeScript interfaces)
- Object types can implement **multiple** interfaces
- Interfaces can **extend** other interfaces (inheritance)
- Interface link types define relationship rules between implementing types

Example:
```
Interface: Trackable
  Properties: location (GeoPoint), last_updated (Timestamp), status (String)

Implements: Driver, Order, DeliveryVehicle
```

Key benefit: If a new type implementing `Trackable` is introduced, all workflows that operate on `Trackable` objects immediately work with the new type.

Actions can create/modify/delete objects through interfaces, operating generically across all implementing types.

---

## 5. AIP Agent Framework

### AIP Agent Studio

AIP Agent Studio is the environment for building interactive AI assistants (AIP Agents) that combine LLMs, the Ontology, documents, and custom tools.

### Agent Architecture

Agents are constructed from:
- **LLM backbone**: Enterprise-grade language models with strict security governance
- **Retrieval context**: Ontology objects, documents, application variables
- **Tools**: The mechanism by which agents interact with the world
- **Permissions**: Inherited from invoking user or project scope

### Tool Types Available to Agents

Six distinct tool types:

1. **Action Tool**: Execute ontology edits. Can require user confirmation or run automatically.
2. **Object Query Tool**: Query specified object types -- filtering, aggregation, inspection, link traversal. Optimized for token efficiency.
3. **Function Tool**: Invoke any Foundry function, including other AIP Logic functions.
4. **Update Application Variable**: Modify application state variables.
5. **Command Tool**: Trigger operations in other Palantir applications.
6. **Request Clarification**: Pause execution to ask the user for input.

### Tool Calling Modes

**Prompted Tool Calling**: Instructions embedded in prompts enable tool access. Works with all models and all tool types. Limitation: only one tool per interaction turn.

**Native Tool Calling**: Uses model-native function calling capabilities. Faster, more token-efficient, supports **parallel tool invocation**. Currently limited to Palantir-provided models and works with: actions, object queries, functions, and variable updates.

### AIP Logic (No-Code Agent Logic)

AIP Logic is a no-code environment for building LLM-powered functions using composable blocks:

**Block Types**:
- **Use LLM Block** (the heart): Leverages language models with prompts, tools, and defined outputs
- **Apply Action Block**: Deterministic action calling without LLM involvement
- **Execute Function Block**: Call existing TypeScript/Python functions
- **Conditionals**: If-then-else branching logic
- **Loops**: Iterate over collections
- **Create Variable Block**: Establish variables for subsequent blocks

**Use LLM Block internals**:
- **Prompts**: Natural language instructions with data specifications and tool guidance
- **Tools**: Apply actions, call functions, query objects, calculator
- **Critical security property**: LLMs can only *ask* to use tools; execution happens within user permissions

Blocks chain sequentially -- output of one block feeds into subsequent blocks.

### Operational Tiers (Autonomy Spectrum)

1. **Tier 1**: Ad-hoc analysis via AIP Threads (chat-style interaction)
2. **Tier 2**: Reusable task-specific agents with configuration options
3. **Tier 3**: Workshop or OSDK integration with application state management
4. **Tier 4**: Autonomous execution through AIP Automate

### AIP Automate (Autonomous Agents)

Integration with AIP Logic to create automations:
- Automations can be configured to **automatically apply** ontology edits OR **stage them for human review**
- Staged proposals appear in a **Proposals tab** with full decision log
- Reviewers can inspect the LLM's reasoning chain
- **Accept** = action automatically executes; **Reject** = proposal discarded
- Open proposals visible for 24 hours, only to the automation creator
- Supports cron-based scheduling for periodic execution

### Agent Decision Flow

```
Trigger (manual / automated / scheduled)
    |
    v
Agent receives context (ontology objects, documents, app state)
    |
    v
LLM reasons over context
    |
    v
LLM requests tool call(s) -- e.g., query objects, apply action
    |
    v
Platform validates permissions and submission criteria
    |
    v
[If auto-apply]: Action executes immediately
[If staged]: Proposal created for human review
    |
    v
Human reviews decision log, accepts/rejects
    |
    v
Action executes (or is discarded)
    |
    v
Audit trail persisted (available as log of past decisions)
```

---

## 6. Guardrails and Constraints

### Multi-Layer Security Model

Palantir's guardrails operate at multiple levels:

#### 1. Permission Layer
- **Object Type permissions**: View/edit permissions managed through project-based Compass filesystem
- **Object (data) permissions**: Require permissions on BOTH the object type AND the backing datasource
- **Link permissions**: Must hold edit permissions on link type AND all linked object types
- **Action permissions**: Require edit permissions on action type AND all resource types the action modifies
- **Role-based access**: Editor, Viewer, etc. roles at project level
- **Bulk management**: Folder/project-level permissions cascade

#### 2. Action Submission Criteria
- Business logic encoded as conditions (user group membership, parameter values, object states)
- Custom failure messages explaining why submission is blocked
- Independent of standard permissions -- additional layer of validation

#### 3. Agent Sandboxing
- Agents inherit permissions from invoking user OR from project-scoped security
- LLMs access only what is necessary to complete a task
- Token scoping limits which ontology entities an application can access
- Agents have specific limitations on data and tools they can wield

#### 4. Proposal / Staging / Human-in-the-Loop
- AI-proposed changes staged as scenarios on branches
- Full decision log inspection before approval
- 24-hour expiry on open proposals
- Accept/reject with audit trail

#### 5. Scenario Sandboxing
- What-if analyses run in sandboxed subsets of the Ontology
- Teams explore implications before committing
- Same access controls as production data

#### 6. Audit and Observability
- Detailed logging for every action execution event
- AIP Observability tracks execution metrics across workflows
- Requests persisted even after completion as audit log
- Action metrics monitoring for operational health

#### 7. Writeback Controls
- All writes MUST go through Action Types
- Action Types enforce validation rules, approvals, audit trails, and side effects
- No "wild west" direct data updates
- Writeback datasets version-controlled with edit tracking

---

## 7. The Semantic Layer Concept

### How the Ontology Acts as a Semantic Layer

The Ontology functions as a **translation layer** between three worlds:

```
[Raw Data World]  <-->  [Semantic Ontology]  <-->  [AI/Human Decision World]
(databases, APIs,       (objects, properties,       (LLMs, agents, analysts,
 sensors, files)         links, actions,             applications, dashboards)
                         functions, security)
```

### What Makes It "Semantic"

1. **Business meaning is encoded**: A column called `drv_stat_cd` becomes a property called `driver_status` on a `Driver` object type with value type `DriverStatusEnum`. The ontology carries meaning.

2. **Relationships are explicit**: Instead of knowing that `orders.driver_id` foreign-keys to `drivers.id`, the ontology has a named link `assigned_to` between `Order` and `Driver`. LLMs can reason about "which driver is assigned to this order" without understanding SQL.

3. **Actions have business names**: Instead of `UPDATE orders SET status = 'cancelled' WHERE id = ?`, the ontology has an action called `Cancel Order` with parameters, validation, and side effects. LLMs can understand what "cancel an order" means.

4. **Context is unified**: Data from fragmented sources (ERP, CRM, sensors, APIs) is unified into coherent objects. An LLM doesn't need to know about 12 different data sources -- it just sees `Driver`, `Order`, `Restaurant`.

### Three Sub-Layers (from Palantir's conceptual model)

**Semantic Sub-Layer**: Defines what entities exist, their relationships, and properties. Establishes unified language across teams. Reconciles fragmented concepts (user/client/individual --> Customer).

**Kinetic Sub-Layer**: Connects semantic meaning to actual data systems. Maps raw data tables/fields to ontological entities. Powers ETL pipelines. Establishes traceable, auditable lineage from source to insight.

**Dynamic Sub-Layer**: Introduces behavior -- business rules, policies, workflows, permissions, lifecycle management (e.g., Order: Created -> Assigned -> Picked Up -> Delivered -> Completed).

### Why This Matters for AI

Without a semantic layer, LLMs must:
- Understand raw database schemas
- Know which tables to join
- Interpret cryptic column names
- Understand data lineage
- Know what actions are valid

With the Ontology as semantic layer, LLMs:
- See named objects with meaningful properties
- Traverse named relationships
- Invoke named actions with built-in validation
- Operate within automatic permission boundaries
- Get business context "for free"

---

## 8. Maven and Military/Enterprise Use Cases

### Maven Smart System (MSS)

Maven is Palantir's AI-enabled platform for Combined Joint All Domain Command and Control (CJADC2). In March 2026, the Pentagon designated Maven as an official program of record and core military system.

### How the Ontology Enables Military Decision-Making

**Data Fusion**: Maven ingests data from satellites, drones, sensors, radar, and other battlefield intelligence sources into a unified ontology. Previously separate systems (8-9 different tools) are collapsed into one operational view.

**Object Modeling**: Battlefield entities are modeled as ontology objects:
- Satellite images -> detection objects
- Enemy vehicles, buildings, weapons stockpiles -> target objects
- Friendly forces, assets -> force objects
- Geographic areas -> zone objects

These objects form the foundation of data-rich applications, providing AI agents with the semantic, structured information they need to reason and act.

**AI Integration**:
- Computer vision models detect targets and create/update ontology objects
- LLM agents respond to natural language queries over the ontology
- AI conversational agents help operators locate matches among thousands of records in seconds
- Target detection scaled from <100/day (manual) to 1,000/day (CV) to 5,000/day (CV + LLMs)

**Kill Chain Acceleration**: The ontology enables moving from identifying targets to developing courses of action to actioning targets -- all from one system. The linked, semantic representation means an analyst can trace from a satellite detection to a target assessment to an approved strike in a single interface.

### Gotham (Defense Intelligence Platform)

Gotham transforms structured and unstructured data into ontology objects representing real concepts (people, organizations, places, documents, events) and the relationships connecting them. The ontology is fully adaptable, changing in response to operational needs.

Used by CIA, NSA, FBI, military branches for:
- Counter-terrorism intelligence
- Battlefield situational awareness
- Targeting and kill chain operations
- Pattern analysis across petabytes of heterogeneous data

### Patterns That Make It Suitable for Mission-Critical Decisions

1. **Complete audit trail**: Every action logged, every decision traceable
2. **Human-in-the-loop by default**: AI proposes, humans approve for high-stakes actions
3. **Scenario sandboxing**: Test implications before committing to operational decisions
4. **Permission granularity**: Row/column-level security, role-based access, need-to-know enforcement
5. **Real-time sync**: Ontology mirrors reality through continuous data ingestion and CDC
6. **Unified operational picture**: Single ontology eliminates conflicting data across systems
7. **Branching for review**: Changes staged on branches, reviewed, then merged (like code review for reality)

---

## 9. OSDK (Ontology SDK)

### Overview

The Ontology SDK allows external applications to access the full power of the Ontology programmatically, outside of Palantir's native applications.

### Supported Languages

| Language | Package Manager | Key Package |
|----------|----------------|-------------|
| TypeScript | NPM | `@osdk/client` |
| Python | Pip / Conda | `ontology_sdk` |
| Java | Maven | Palantir Ontology SDK |
| Any | OpenAPI spec | Generated client |

### TypeScript OSDK

Repository: `github.com/palantir/osdk-ts` (open source)

Packages:
- `@osdk/client`: Core client library
- `@osdk/api`: API layer
- `@osdk/foundry-sdk-generator`: Generate ontology-specific SDKs
- `@osdk/oauth`: Authentication provider

Client creation:
```typescript
import { createClient } from "@osdk/client";
import { createPublicOauthClient } from "@osdk/oauth";

// Browser auth
const auth = createPublicOauthClient(clientId, foundryUrl, redirectUrl);
// Server auth
const auth = createConfidentialOauthClient(clientId, clientSecret, foundryUrl);

const client = createClient(foundryUrl, ontologyRid, auth);
```

### Python OSDK Examples

```python
# Load a single object
restaurant = client.ontology.objects.ExampleRestaurant.get("primary_key")

# Iterate all objects
for restaurant in client.ontology.objects.ExampleRestaurant.iterate():
    print(restaurant)

# Filter objects
results = client.ontology.objects.ExampleRestaurant.where(
    ExampleRestaurant.object_type.restaurant_name == "Pizza Palace"
)

# Complex filters with boolean operators
results = client.ontology.objects.ExampleRestaurant.where(
    ~ExampleRestaurant.object_type.restaurantId.is_null() & (
        ExampleRestaurant.object_type.restaurant_name.starts_with(['Pizza'])
    )
)

# Ordering
results = client.ontology.objects.ExampleRestaurant.where(
    ~ExampleRestaurant.object_type.restaurant_name.is_null()
).order_by(
    ExampleRestaurant.object_type.restaurant_name.asc()
).iterate()

# Aggregations
count = client.ontology.objects.ExampleRestaurant.count().compute()
avg_reviews = client.ontology.objects.ExampleRestaurant.avg(
    ExampleRestaurant.object_type.number_of_reviews
).compute()

# Group by
grouped = client.ontology.objects.ExampleRestaurant.where(
    ~ExampleRestaurant.object_type.restaurant_name.is_null()
).group_by(
    ExampleRestaurant.object_type.restaurant_name.exact()
).count().compute()

# Pagination
page = client.ontology.objects.ExampleRestaurant.page(page_size=30, page_token=None)
next_token = page.next_page_token
data = page.data
```

### Security Model

- Token scoped to specific ontological entities
- User permissions enforced on top of token scope
- Granular governance controls combine user-level and application-level restrictions

### Developer Workflow

1. Create application in Developer Console
2. Select ontology entities to expose
3. Console generates documentation for TypeScript, Python, cURL
4. Bootstrap using language-specific guides
5. Types and functions generated from your ontology (full type safety)
6. Optionally host the application on Foundry

---

## 10. Open-Source Alternatives and Similar Architectures

### Direct Alternatives

| Tool | Approach | Strengths |
|------|----------|-----------|
| **LangGraph** | Graph-based agent orchestration | Stateful multi-agent workflows, directed graphs with cycles, conditional routing, memory management. Most popular OS agent framework (24.8k GitHub stars, 34.5M downloads). |
| **Neo4j + GraphRAG** | Property graph + AI | OWL ontologies transformed into operational knowledge graphs. AI-ready with entity/relationship modeling. |
| **Apache Jena** | Semantic Web (RDF/OWL/SPARQL) | Formal ontology reasoning, rule-based inference, open standards. |
| **Dashjoin** | Open source data integration + ontology | Linked data graph over data sources, seamless relationship browsing. |
| **d.AP (digetiers)** | Ontology-grounded decision intelligence | Open RDF/OWL standards, explainable reasoning. |
| **DataWalk** | No-code knowledge graph | Billions of records, ontology management, ML/AI applications. |

### Framework-Level Alternatives for Agent Orchestration

| Framework | Key Feature | Notes |
|-----------|-------------|-------|
| **LangGraph** | Stateful graph agents | Best for complex multi-step agent workflows |
| **CrewAI** | Multi-agent collaboration | Role-based agent teams |
| **Pydantic AI** | Type-safe agent framework | Strong validation, Python-native |
| **AutoGen** | Multi-agent conversation | Microsoft-backed |
| **Agno** | Agentic runtimes | Lightweight, production-focused |

### What None of These Provide (Palantir's Moat)

The HN engineering community notes that Palantir's actual technical differentiation is:
1. **Integrated operational platform**: The ontology is not just a data model; it connects to operational systems with writeback, CDC, and webhooks
2. **UI/UX layer**: Workshop, Slate, and the application framework make the ontology usable by non-technical operators
3. **Forward-deployed engineering**: On-site teams ensure the ontology actually maps to customer reality
4. **Security model depth**: Row/column-level security, need-to-know, audit trails at the ontology level

Individual open-source components can replicate parts, but the integrated stack is Palantir's competitive advantage.

### Building a Palantir-Like Architecture from Open Source

To approximate Palantir's ontology-backed agent pattern:

```
Knowledge Graph:     Neo4j or PostgreSQL (with graph extensions)
Semantic Layer:      Custom schema registry + business metadata
Agent Framework:     LangGraph (stateful, graph-based agents)
Tool Calling:        OpenAI/Anthropic function calling
Action Layer:        Custom action registry with validation
Permissions:         Custom RBAC + row-level security
Audit Trail:         Event sourcing (Kafka/NATS) + append-only logs
Writeback:           Custom connectors to operational systems
UI:                  Custom React/Next.js applications
SDK:                 Auto-generated TypeScript/Python clients
```

---

## 11. Architectural Patterns for a Food Delivery AI Dispatcher

### How to Apply Palantir's Patterns

Based on this research, here are the key architectural patterns from Palantir that are directly applicable to a food delivery AI dispatcher:

### Pattern 1: Ontology as the Agent's World Model

Define your domain as typed objects with properties and links:

```
Object Types:
  Order:        id, status, items, total, created_at, eta, priority
  Driver:       id, name, location, status, vehicle_type, rating, active_zone
  Restaurant:   id, name, location, prep_time_avg, current_load, status
  Customer:     id, name, address, location, preferences
  DeliveryZone: id, name, boundaries, surge_multiplier, demand_level

Links:
  Order --placed_by--> Customer
  Order --from_restaurant--> Restaurant
  Order --assigned_to--> Driver
  Driver --operates_in--> DeliveryZone
  Restaurant --located_in--> DeliveryZone
  Customer --lives_in--> DeliveryZone
```

The AI agent reasons over this model, not raw database tables.

### Pattern 2: Actions as the Only Way to Change the World

Define a constrained set of actions the AI can take:

```
Actions:
  AssignDriverToOrder:
    params: order_id, driver_id
    rules: Create link Order->Driver, Update Order.status="assigned", Update Driver.status="en_route_to_pickup"
    criteria: Driver.status must be "available", Order.status must be "ready_for_pickup"
    side_effects: Notify driver, Notify customer with ETA

  ReassignOrder:
    params: order_id, new_driver_id, reason
    rules: Delete old link, Create new link, Update statuses
    criteria: Current driver must not have picked up food yet
    side_effects: Notify both drivers, Update customer ETA

  EscalateOrder:
    params: order_id, reason, severity
    rules: Update Order.priority, Create EscalationEvent object
    criteria: Order must be active
    side_effects: Notify ops team, webhook to monitoring

  AdjustZoneSurge:
    params: zone_id, new_multiplier, reason
    rules: Update DeliveryZone.surge_multiplier
    criteria: Multiplier between 1.0-3.0, User must be in "dispatchers" group
    side_effects: Log change, notify affected drivers
```

### Pattern 3: Tool-Calling with Guardrails

Expose actions and queries as tools for the LLM agent:

```
Tools available to Dispatch Agent:
  1. query_orders(filters, sort, limit) -> ObjectSet<Order>
  2. query_drivers(filters, sort, limit) -> ObjectSet<Driver>
  3. query_restaurants(filters) -> ObjectSet<Restaurant>
  4. get_order_details(order_id) -> Order with linked objects
  5. assign_driver_to_order(order_id, driver_id) -> Result
  6. reassign_order(order_id, new_driver_id, reason) -> Result
  7. escalate_order(order_id, reason, severity) -> Result
  8. calculate_eta(driver_id, restaurant_id, customer_id) -> Duration
```

LLM reasons -> proposes tool call -> platform validates -> executes within permissions

### Pattern 4: Human-in-the-Loop for High-Stakes Decisions

```
Auto-execute (Tier 4):
  - Assign available driver to new order
  - Update ETAs
  - Send notifications

Staged for review (Tier 2-3):
  - Reassign orders when driver goes offline
  - Adjust zone surge pricing
  - Cancel orders

Human only (Tier 1):
  - Refund decisions
  - Driver deactivation
  - System-wide parameter changes
```

### Pattern 5: Scenario Sandboxing for Batch Decisions

Before committing a batch reassignment (e.g., driver went offline with 3 orders):
1. Create a scenario branch
2. AI proposes reassignments for all 3 orders
3. Calculate new ETAs in the sandbox
4. Show ops team the full impact
5. Accept or reject the batch

### Pattern 6: Audit Everything

Every action execution creates an immutable audit record:
- Who triggered it (human or agent)
- What the agent's reasoning was (decision log)
- What changed (before/after state)
- What side effects fired
- Timestamp and correlation ID

This is non-negotiable for operational systems.

---

## Sources

### Palantir Official Documentation
- [Core Concepts](https://www.palantir.com/docs/foundry/ontology/core-concepts)
- [Ontology Overview](https://www.palantir.com/docs/foundry/ontology/overview)
- [Ontology Architecture / System](https://www.palantir.com/docs/foundry/architecture-center/ontology-system)
- [Object Backend Overview (Object Storage V2)](https://www.palantir.com/docs/foundry/object-backend/overview)
- [Action Types Overview](https://www.palantir.com/docs/foundry/action-types/overview)
- [Action Type Rules](https://www.palantir.com/docs/foundry/action-types/rules)
- [Action Type Submission Criteria](https://www.palantir.com/docs/foundry/action-types/submission-criteria)
- [Function-Backed Actions](https://www.palantir.com/docs/foundry/action-types/function-actions-getting-started)
- [Ontology Edits via Functions](https://www.palantir.com/docs/foundry/functions/edits-overview)
- [AIP Agent Studio Overview](https://www.palantir.com/docs/foundry/agent-studio/overview)
- [AIP Agent Studio Tools](https://www.palantir.com/docs/foundry/agent-studio/tools)
- [AIP Logic Overview](https://www.palantir.com/docs/foundry/logic/overview)
- [AIP Logic Blocks](https://www.palantir.com/docs/foundry/logic/blocks)
- [AIP Features](https://www.palantir.com/docs/foundry/aip/aip-features)
- [AIP Logic Automate Integration](https://www.palantir.com/docs/foundry/logic/aip-logic-integration-automate)
- [Ontology SDK Overview](https://www.palantir.com/docs/foundry/ontology-sdk/overview)
- [Python OSDK](https://www.palantir.com/docs/foundry/ontology-sdk/python-osdk)
- [Interfaces Overview](https://www.palantir.com/docs/foundry/interfaces/interface-overview)
- [Object and Link Types Reference](https://www.palantir.com/docs/foundry/object-link-types/type-reference)
- [Ontology Permissions](https://www.palantir.com/docs/foundry/ontologies/ontology-permissions/)
- [Workshop Scenarios](https://www.palantir.com/docs/foundry/workshop/scenarios-overview)
- [Palantir Ontology Platform Page](https://www.palantir.com/platforms/ontology/)
- [Foundry Platform Summary for LLMs](https://www.palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm)
- [Palantir AIP Platform Page](https://www.palantir.com/platforms/aip/)
- [Gotham Platform Page](https://www.palantir.com/platforms/gotham/)

### Palantir Blog
- [Connecting AI to Decisions with the Palantir Ontology](https://blog.palantir.com/connecting-ai-to-decisions-with-the-palantir-ontology-c73f7b0a1a72)
- [Maven Smart System: Innovating for the Alliance](https://blog.palantir.com/maven-smart-system-innovating-for-the-alliance-5ebc31709eea)

### Open Source
- [Palantir OSDK TypeScript (GitHub)](https://github.com/palantir/osdk-ts)
- [Palantir Foundry Platform Python (GitHub)](https://github.com/palantir/foundry-platform-python)
- [LangGraph (GitHub)](https://github.com/langchain-ai/langgraph)

### Third-Party Analysis
- [Understanding Palantir's Ontology: Semantic, Kinetic, and Dynamic Layers Explained (Medium)](https://pythonebasta.medium.com/understanding-palantirs-ontology-semantic-kinetic-and-dynamic-layers-explained-c1c25b39ea3c)
- [Palantir's Secret Weapon Isn't AI -- It's Ontology (DEV Community)](https://dev.to/s3atoshi_leading_ai/palantirs-secret-weapon-isnt-ai-its-ontology-heres-why-engineers-should-care-kk8)
- [The Power of Ontology in Palantir Foundry (Cognizant)](https://www.cognizant.com/us/en/the-power-of-ontology-in-palantir-foundry)
- [Palantir Ontology Overview (Supply Chain Today)](https://www.supplychaintoday.com/palantir-ontology-overview/)
- [HN Discussion: Palantir's Secret Weapon](https://news.ycombinator.com/item?id=47107512)
- [Maven Pentagon Designation (Technology.org)](https://www.technology.org/2026/03/23/pentagon-makes-palantirs-maven-ai-an-official-core-military-system/)
- [Demystifying Palantir: Features and Open Source Alternatives (Medium)](https://dashjoin.medium.com/demystifying-palantir-features-and-open-source-alternatives-ed3ed39432f9)
- [Best Open Source AI Agent Frameworks 2026 (AI Haven)](https://aihaven.com/guides/best-open-source-ai-agent-frameworks-2026/)
- [A Detailed Comparison of Top 6 AI Agent Frameworks in 2026 (Turing)](https://www.turing.com/resources/ai-agent-frameworks)
