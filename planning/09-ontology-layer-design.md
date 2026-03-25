# Sisyphus: Ontology Layer Design

**Date:** 2026-03-25
**Status:** Planning
**Inspired by:** Palantir AIP Ontology Architecture (see `08-palantir-ontology-research.md`)

---

## 1. Why an Ontology Layer Changes Everything

Our original design (docs 01-07) had agents interacting with the dispatch UI directly — reasoning about raw page state, clicking buttons, parsing DOM elements. This works, but it's fragile and opaque.

Palantir's key insight: **put a structured semantic layer between the AI and the real world**. The AI never touches raw data or raw UI. It reasons over typed objects, traverses named relationships, and executes validated actions. This gives us:

| Without Ontology | With Ontology |
|-----------------|---------------|
| Agent reads DOM: "there's a row with 'Order #1234, Late, John D.'" | Agent queries: `Order(id=1234) → status=late, assigned_to=Driver(name="John D.")` |
| Agent clicks "Reassign" button, fills modal | Agent calls: `ReassignOrder(order_id=1234, new_driver_id=567, reason="driver_unresponsive")` |
| No validation until form submission | Pre-validated: submission criteria checked before execution |
| Hard to audit ("the AI clicked some buttons") | Immutable audit: action, params, reasoning, outcome, timestamp |
| Breaks when UI changes | Stable: ontology interface doesn't change when CSS moves |

**The ontology is the contract between the AI agents and reality.**

---

## 2. Revised Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEMPORAL.IO (Shift Lifecycle)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    LANGGRAPH SUPERVISOR                          │
│                    (reasons over Ontology)                       │
│                           │                                     │
│            ┌──────────────┼──────────────┐                      │
│            │              │              │                       │
│      Market Monitor  Driver Comms  Customer Support             │
│      (queries objects) (calls actions) (calls actions)          │
│            └──────────────┼──────────────┘                      │
│                    Task Executor ▲                               │
│                   (shared utility — any agent can invoke)        │
│                           │                                     │
├────────────┴──────────────┴──────────────┴──────────────────────┤
│                                                                 │
│                    ONTOLOGY LAYER                                │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │   OBJECTS    │  │   ACTIONS    │  │    GUARDRAILS      │     │
│  │             │  │              │  │                    │     │
│  │ Order       │  │ AssignDriver │  │ Submission criteria│     │
│  │ Driver      │  │ SendMessage  │  │ Permission checks  │     │
│  │ Customer    │  │ ReassignOrder│  │ Cooldown rules     │     │
│  │ Restaurant  │  │ ResolveTicket│  │ Autonomy tiers     │     │
│  │ Ticket      │  │ IssueRefund  │  │ Rate limits        │     │
│  │ Zone        │  │ UpdateStatus │  │                    │     │
│  │ Message     │  │ EscalateIssue│  │                    │     │
│  └──────┬──────┘  └──────┬───────┘  └────────┬───────────┘     │
│         │                │                    │                  │
├─────────┴────────────────┴────────────────────┴─────────────────┤
│                                                                 │
│                    EXECUTION LAYER                               │
│                    (How actions become real)                     │
│                                                                 │
│  ┌──────────────────┐  ┌─────────────────────────────────┐      │
│  │  Browser Actions  │  │  API Actions                    │      │
│  │  (browser-use)    │  │  (direct REST calls)            │      │
│  │  UI-visible acts  │  │  High-frequency reads           │      │
│  └────────┬─────────┘  └──────────────┬──────────────────┘      │
│           │                           │                          │
│           ▼                           ▼                          │
│     Headless Chrome             Dispatch REST API                │
│     (dispatch UI)               (AWS Lambda)                     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    STATE LAYER                                    │
│                                                                  │
│  Redis (cooldowns, locks)  │  PostgreSQL (audit, history)        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key change**: Agents no longer reason about "what's on the page." They reason over typed objects and call named actions. The execution layer translates actions into browser clicks or API calls — that's an implementation detail the agent doesn't see.

---

## 3. Object Types

### 3.1 Core Objects

```yaml
Order:
  primary_key: order_id
  properties:
    order_id: string
    status: OrderStatus          # Placed, Confirmed, Ready, EnRoute, Delivered, Cancelled
    customer_id: string
    restaurant_id: string
    driver_id: string | null
    items: list[OrderItem]
    total: decimal
    delivery_address: string
    delivery_zone: string
    placed_at: datetime
    ready_at: datetime | null
    delivered_at: datetime | null
    eta: datetime | null
    priority: Priority           # normal, high, critical
    flags: list[string]
    notes: string | null
  links:
    placed_by: -> Customer
    from_restaurant: -> Restaurant
    assigned_to: -> Driver | null
    in_zone: -> DeliveryZone
    related_tickets: -> [Ticket]
  computed:
    is_late: bool               # eta < now
    wait_time_minutes: int      # now - placed_at
    time_since_ready: int | null

Driver:
  primary_key: driver_id
  properties:
    driver_id: string
    name: string
    phone: string
    email: string
    status: DriverStatus         # Online, Busy, Offline, OnBreak
    location: GeoPoint | null
    active_zone: string
    active_orders_count: int
    late_orders_count: int
    shift_start: datetime | null
    shift_end: datetime | null
    alcohol_certified: bool
    rating: decimal
    vehicle_type: string
  links:
    assigned_orders: -> [Order]
    operates_in: -> DeliveryZone
    conversations: -> [Conversation]
  computed:
    is_available: bool          # status=Online AND active_orders < max
    has_late_orders: bool

Customer:
  primary_key: customer_id
  properties:
    customer_id: string
    name: string
    email: string
    phone: string
    address: string
    location: GeoPoint | null
    total_orders: int
    notes: string | null        # background info / special instructions
  links:
    orders: -> [Order]
    tickets: -> [Ticket]
    in_zone: -> DeliveryZone

Restaurant:
  primary_key: restaurant_id
  properties:
    restaurant_id: string
    name: string
    phone: string
    location: GeoPoint
    status: RestaurantStatus    # Open, Closed, Paused, Busy
    avg_prep_time: int          # minutes
    current_load: int           # active orders
    zone: string
  links:
    orders: -> [Order]
    in_zone: -> DeliveryZone

Ticket:
  primary_key: ticket_id
  properties:
    ticket_id: string
    status: TicketStatus        # Open, InProgress, Resolved, Closed, Escalated
    category: string            # Late, MissingItems, WrongOrder, DriverIssue, etc.
    severity: Severity          # Low, Medium, High, Critical
    owner: string | null        # who's handling it
    created_at: datetime
    updated_at: datetime
    summary: string
    notes: list[TicketNote]
  links:
    related_order: -> Order | null
    related_customer: -> Customer
    related_driver: -> Driver | null

DeliveryZone:
  primary_key: zone_id
  properties:
    zone_id: string
    name: string
    health_score: float         # 0-100
    active_orders: int
    available_drivers: int
    avg_eta: int                # minutes
    driver_to_order_ratio: float
    demand_level: DemandLevel   # Low, Normal, High, Surge

Conversation:
  primary_key: conversation_id
  properties:
    conversation_id: string     # typically driver_id
    driver_id: string
    driver_name: string
    last_message_at: datetime
    unread_count: int
    last_message_preview: string
  links:
    with_driver: -> Driver
    messages: -> [Message]

Message:
  primary_key: message_id
  properties:
    message_id: string
    conversation_id: string
    author: string
    content: string
    timestamp: datetime
    is_driver: bool
    attachment: string | null
    related_order_id: string | null
```

### 3.2 Interfaces (Shared Behaviors)

```yaml
Trackable:
  properties:
    location: GeoPoint | null
    status: string
    last_updated: datetime
  implements: [Driver, Order]

Contactable:
  properties:
    name: string
    phone: string
    email: string
  implements: [Driver, Customer, Restaurant]

HasTimeline:
  properties:
    created_at: datetime
    updated_at: datetime
  implements: [Order, Ticket, Conversation]
```

---

## 4. Action Types

Every mutation in the system goes through an Action Type. The AI agent calls actions — it never edits objects directly.

### 4.1 Order Actions

```yaml
AssignDriverToOrder:
  description: "Assign an available driver to an unassigned order"
  params:
    order_id: string (required)
    driver_id: string (required)
  submission_criteria:
    - Order.status must be in [Placed, Confirmed, Ready]
    - Order.driver_id must be null (not already assigned)
    - Driver.status must be "Online"
    - Driver.active_orders_count < max_concurrent_orders
    - Driver.operates_in must match Order.delivery_zone (or adjacent)
  rules:
    - Set Order.driver_id = driver_id
    - Set Order.status = "Confirmed" (if currently Placed)
    - Create link Order --assigned_to--> Driver
    - Increment Driver.active_orders_count
  side_effects:
    - Notify driver (push notification)
    - Notify customer with estimated ETA
    - Log action to audit trail
  autonomy_tier: GREEN (auto-execute)
  cooldown: order:{order_id}:assign = 120s

ReassignOrder:
  description: "Reassign an order to a different driver"
  params:
    order_id: string (required)
    new_driver_id: string (required)
    reason: string (required)    # "driver_unresponsive", "driver_offline", "closer_driver", etc.
  submission_criteria:
    - Order.status must be in [Confirmed, Ready, EnRoute]
    - Order.status must NOT be "InTransit" (food already picked up)
    - new_driver_id must differ from current driver_id
    - New driver must pass AssignDriverToOrder criteria
  rules:
    - Delete old link Order --assigned_to--> OldDriver
    - Set Order.driver_id = new_driver_id
    - Create link Order --assigned_to--> NewDriver
    - Adjust both drivers' active_orders_count
  side_effects:
    - Notify old driver of reassignment
    - Notify new driver of new assignment
    - Update customer ETA
    - Log with reason
  autonomy_tier: YELLOW (auto-execute, logged prominently)
  cooldown: order:{order_id}:reassign = 600s

UpdateOrderStatus:
  description: "Change the status of an order"
  params:
    order_id: string (required)
    new_status: OrderStatus (required)
    reason: string (optional)
  submission_criteria:
    - Transition must be valid per state machine:
      Placed → Confirmed → Ready → EnRoute → InTransit → Delivered
      Any → Cancelled (with reason required)
    - Only backward transitions allowed: Confirmed → Placed (restaurant issue)
  rules:
    - Set Order.status = new_status
    - Set relevant timestamp (ready_at, delivered_at, etc.)
  side_effects:
    - Notify relevant parties based on transition
    - Update customer-facing tracking
  autonomy_tier: GREEN (for forward transitions), ORANGE (for Cancelled)
  cooldown: order:{order_id}:status = 120s

CancelOrder:
  description: "Cancel an active order"
  params:
    order_id: string (required)
    reason: string (required)
    cancellation_owner: CancellationOwner  # ValleyEats, Restaurant, Driver, Customer
  submission_criteria:
    - Order.status must NOT be "Delivered"
    - reason must not be empty
  rules:
    - Set Order.status = "Cancelled"
    - Remove driver assignment if exists
  side_effects:
    - Notify customer
    - Notify driver (if assigned)
    - Notify restaurant
    - Trigger refund evaluation
  autonomy_tier: RED (requires human approval)
```

### 4.2 Driver Communication Actions

```yaml
SendDriverMessage:
  description: "Send a message to a driver in their conversation"
  params:
    driver_id: string (required)
    message: string (required)
    related_order_id: string (optional)
  submission_criteria:
    - message.length > 0 AND message.length < 500
    - Driver must exist and have an active conversation
  rules:
    - Create Message object in conversation
    - Update Conversation.last_message_at
  side_effects:
    - Deliver via dispatch messaging system
    - Log to audit trail
  autonomy_tier: YELLOW (auto-execute, logged)
  cooldown: driver:{driver_id}:message = 300s

FollowUpWithDriver:
  description: "Send a follow-up message when driver hasn't responded"
  params:
    driver_id: string (required)
    original_message_context: string (required)
    follow_up_message: string (required)
  submission_criteria:
    - Last message to driver must be > 5 minutes ago (cooldown enforced)
    - Max 3 follow-ups per conversation per hour
  rules:
    - Create Message object
  side_effects:
    - Deliver message
    - If 3rd follow-up: auto-flag for supervisor review
  autonomy_tier: YELLOW
  cooldown: driver:{driver_id}:followup = 600s
```

### 4.3 Support Actions

```yaml
ResolveTicket:
  description: "Resolve a support ticket with a resolution"
  params:
    ticket_id: string (required)
    resolution: string (required)
    resolution_type: ResolutionType  # refund, credit, redelivery, apology, no_action
    refund_amount: decimal (optional)
  submission_criteria:
    - Ticket.status must be "Open" or "InProgress"
    - If resolution_type is "refund": refund_amount must be provided
  rules:
    - Set Ticket.status = "Resolved"
    - Add resolution note to Ticket.notes
    - Set Ticket.updated_at = now
  side_effects:
    - Notify customer of resolution
    - If refund: trigger refund process
    - Log resolution to audit trail
  autonomy_tier: ORANGE (refund < $25) or RED (refund >= $25)
  cooldown: ticket:{ticket_id}:resolve = 300s

EscalateTicket:
  description: "Escalate a ticket to human dispatch"
  params:
    ticket_id: string (required)
    reason: string (required)
    severity: Severity (required)
  submission_criteria:
    - Ticket.status must be "Open" or "InProgress"
  rules:
    - Set Ticket.status = "Escalated"
    - Set Ticket.severity = severity
    - Add escalation note
  side_effects:
    - Alert human dispatchers (bulletin or in-app notification)
    - Log escalation reason
  autonomy_tier: GREEN (escalation is always safe)

AddTicketNote:
  description: "Add an investigation note to a ticket"
  params:
    ticket_id: string (required)
    note: string (required)
  submission_criteria:
    - Ticket must exist
    - note.length > 0
  rules:
    - Append note to Ticket.notes with timestamp and author="sisyphus"
  side_effects:
    - Log to audit trail
  autonomy_tier: GREEN
```

### 4.4 Market Actions

```yaml
FlagMarketIssue:
  description: "Flag a market health issue for awareness"
  params:
    zone_id: string (required)
    issue_type: MarketIssueType  # low_drivers, high_demand, high_eta, unassigned_orders
    severity: Severity (required)
    details: string (required)
  submission_criteria:
    - Zone must exist
    - health_score must support the claimed issue (no false alarms)
  rules:
    - Create MarketAlert object
    - Link to DeliveryZone
  side_effects:
    - Notify supervisor agent
    - If severity >= High: alert human dispatchers
  autonomy_tier: GREEN
```

---

## 5. Autonomy Tiers

Inspired by Palantir's operational tiers, every action has an autonomy classification:

```
┌────────────────────────────────────────────────────────────────┐
│                    AUTONOMY TIERS                               │
│                                                                │
│  GREEN   Auto-execute. Safe, reversible, low-impact.           │
│          Examples: read queries, status updates (forward),      │
│          escalations, adding notes, flagging issues             │
│                                                                │
│  YELLOW  Auto-execute, but logged prominently and              │
│          visible to human dispatchers in real-time.             │
│          Examples: sending driver messages, order assignments,  │
│          reassignments, standard ticket resolutions             │
│                                                                │
│  ORANGE  Staged for review during ramp-up period.              │
│          Auto-execute once confidence is established.           │
│          Examples: small refunds (<$25), order cancellations    │
│          (customer-initiated), bulk reassignments               │
│                                                                │
│  RED     Always requires human approval.                        │
│          Examples: large refunds (>=$25), driver deactivation,  │
│          system-wide changes, customer escalations to           │
│          management                                             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Tier Progression

As Sisyphus proves reliability, actions graduate:

```
Week 1-2:  Most actions are ORANGE or RED (human approves everything)
Week 3-4:  Routine actions move to YELLOW (auto-execute, visible)
Week 5-8:  Proven actions move to GREEN (auto-execute, quiet)
Ongoing:   RED actions stay RED (always human-approved)
```

This matches Palantir's "version control for reality" — proposed changes staged for review until trust is established.

---

## 6. Guardrails Framework

### 6.1 Submission Criteria (Per-Action Validation)

Every action has machine-enforceable rules checked BEFORE execution:

```typescript
function validateSubmissionCriteria(
  action: ActionCall,
  state: OntologyState
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const rule of action.definition.criteria) {
    const result = rule.check(action.params, state);
    if (!result.passed) {
      errors.push({
        rule: rule.name,
        message: rule.failureMessage,
        context: result.context,
      });
    }
  }

  return { passed: errors.length === 0, errors };
}
```

### 6.2 Cooldown Enforcement (Temporal Guardrail)

Already designed in `04-memory-system.md`. Now it's enforced at the ontology layer — the action won't execute if cooldown hasn't elapsed. The agent doesn't need to remember to check; the system prevents it.

### 6.3 Rate Limits (Per-Agent, Per-Action)

```yaml
rate_limits:
  driver_comms:
    SendDriverMessage: 10/hour per driver
    FollowUpWithDriver: 3/hour per driver
  customer_support:
    ResolveTicket: 30/hour total
    IssueRefund: 5/hour total
  supervisor:
    ReassignOrder: 20/hour total
    CancelOrder: 5/hour total (RED tier, always human-approved anyway)
```

### 6.4 Circuit Breaker

If an agent triggers too many validation failures in a row, it's paused:

```
> 3 failed actions in 5 minutes → Agent paused, supervisor notified
> 5 failed actions in 15 minutes → Agent paused, human alerted
> Any RED-tier failure → Immediate human alert
```

### 6.5 Audit Trail (Non-Negotiable)

Every action execution creates an immutable record:

```typescript
interface AuditRecord {
  id: string;                      // UUID
  timestamp: Date;
  actionType: string;              // "AssignDriverToOrder"
  agentId: string;                 // "driver_comms" or "supervisor"
  params: Record<string, unknown>; // Full action parameters
  reasoning: string;               // LLM's explanation of why it chose this action
  submissionCheck: Record<string, unknown>; // Which criteria were checked and passed/failed
  outcome: "executed" | "rejected" | "staged" | "failed";
  beforeState: Record<string, unknown>; // Relevant object state before action
  afterState: Record<string, unknown>;  // Relevant object state after action
  sideEffectsFired: string[];    // Which side effects were triggered
  executionTimeMs: number;
  llmModel: string;              // Which model made the decision
  llmTokensUsed: number;
  correlationId: string;         // Links related actions together
}
```

---

## 7. How Agents Interact with the Ontology

### 7.1 Agent Tools (Palantir-Inspired)

Each agent gets a set of typed tools. These are the ONLY way agents interact with the world:

```typescript
// Tool types available to agents (mirrors Palantir's 6 tool types)

// 1. QUERY TOOL — Read objects with filters
async function queryOrders(
  filters: OrderFilters,       // status, zone, driver, date range, etc.
  sort = "placedAt",
  limit = 50
): Promise<Order[]> {
  // Query orders from the ontology. Returns typed Order objects.
}

// 2. ACTION TOOL — Execute a named action
async function executeAction(
  actionType: string,          // "AssignDriverToOrder"
  params: Record<string, unknown>, // { orderId: "123", driverId: "456" }
  reasoning: string            // Agent's explanation (logged to audit)
): Promise<ActionResult> {
  // Validates submission criteria, checks permissions,
  // enforces cooldowns, logs audit trail.
}

// 3. FUNCTION TOOL — Run business logic
async function calculateEta(
  driverId: string,
  restaurantId: string,
  customerAddress: string
): Promise<ETAResult> {
  // Calculate estimated delivery time. Pure computation, no side effects.
}

// 4. CONTEXT TOOL — Get rich object detail with links
async function getOrderDetails(orderId: string): Promise<OrderWithContext> {
  // Get order with all linked objects (customer, driver, restaurant, tickets).
  // Single call gives the agent full context for decision-making.
}

// 5. HISTORY TOOL — Check temporal state
async function getEntityTimeline(
  entityType: string,
  entityId: string,
  hours = 24
): Promise<TimelineEvent[]> {
  // Get recent actions/events for an entity. Agents use this to understand
  // what's already happened before deciding what to do next.
}

// 6. CLARIFICATION TOOL — Ask supervisor or human
async function requestClarification(
  question: string,
  context: Record<string, unknown>,
  urgency: "normal" | "high" | "critical" = "normal"
): Promise<ClarificationResponse> {
  // Pause and ask the supervisor agent (or human) for guidance.
}
```

### 7.2 Agent Decision Flow

```
Agent receives task from supervisor
    │
    ▼
Query relevant objects (query tool)
    │ "Get order #1234 with context"
    │ "Get available drivers in zone A"
    │
    ▼
Check timeline (history tool)
    │ "What's happened with this order in the last hour?"
    │ "When did we last message this driver?"
    │
    ▼
Reason over objects + process file + history
    │ (LLM with structured context, not raw HTML)
    │
    ▼
Decide on action
    │
    ▼
Call execute_action()
    │
    ├── Submission criteria check ─── FAIL → log, try alternative or escalate
    │
    ├── Cooldown check ─── BLOCKED → wait or escalate
    │
    ├── Autonomy tier check:
    │   ├── GREEN/YELLOW → execute immediately
    │   ├── ORANGE → stage for review (during ramp-up)
    │   └── RED → stage for human approval
    │
    ├── Execute action rules (modify objects, create links)
    │
    ├── Fire side effects (notifications, browser actions)
    │
    └── Write audit record
    │
    ▼
Report result to supervisor
```

---

## 8. The Execution Layer: Ontology → Reality

The ontology is the agent's view of the world. The execution layer translates ontology actions into real-world effects:

### 8.1 Browser Executor

Some actions need to happen through the dispatch UI for visibility:

```typescript
class BrowserExecutor {
  constructor(private page: Page) {} // Playwright Page connected via CDP

  async execute(action: ActionCall): Promise<void> {
    switch (action.type) {
      case "AssignDriverToOrder":
        await this.navigateToOrder(action.params.orderId);
        await this.page.click('[data-testid="assign-driver-btn"]');
        await this.selectDriver(action.params.driverId);
        await this.page.click('[data-testid="confirm-assign"]');
        break;

      case "SendDriverMessage":
        await this.openMessagingPanel();
        await this.selectConversation(action.params.driverId);
        await this.page.fill('[data-testid="message-input"]', action.params.message);
        await this.page.click('[data-testid="send-message-btn"]');
        break;

      case "UpdateOrderStatus":
        await this.navigateToOrder(action.params.orderId);
        await this.changeStatus(action.params.newStatus);
        break;
    }
  }
}
```

### 8.2 API Executor

Some actions go through the REST API directly (faster, for non-visible operations):

```typescript
class APIExecutor {
  constructor(private client: DispatchAPIClient) {} // httpx/fetch client with auth

  async execute(action: ActionCall): Promise<void> {
    switch (action.type) {
      case "AddTicketNote":
        await this.client.post(
          `/support/issues/${action.params.ticketId}/note`,
          { note: action.params.note }
        );
        break;

      case "UpdateOrderStatus":
        await this.client.post(
          `/orders/${action.params.orderId}/status`,
          { status: action.params.newStatus }
        );
        break;
    }
  }
}
```

### 8.3 Choosing Browser vs API

```yaml
execution_routing:
  # Browser (visible to other dispatchers)
  browser:
    - AssignDriverToOrder       # Human should see this happening
    - ReassignOrder             # Visible in real-time
    - SendDriverMessage         # Shows in messaging panel
    - ResolveTicket             # Shows ticket activity

  # API (faster, for high-frequency or background operations)
  api:
    - AddTicketNote             # Background documentation
    - FlagMarketIssue           # Internal alert
    - Query operations          # All reads go through API

  # Configurable (start with browser, move to API as trust builds)
  configurable:
    - UpdateOrderStatus         # Initially browser for visibility
    - CancelOrder               # Always browser (for now)
```

---

## 9. Ontology Sync: Keeping Objects Current

The ontology must reflect reality. Two sync mechanisms:

### 9.1 Pull Sync (Polling)

```
Every 30 seconds:
  1. Fetch dispatch snapshot from S3
  2. Fetch orders from GET /orders
  3. Fetch drivers from GET /drivers
  4. Diff against current ontology state
  5. Update changed objects
  6. Recompute computed properties (is_late, health_score, etc.)
```

### 9.2 Push Sync (WebSocket Events)

```
WebSocket events update ontology in real-time:
  - new_message → Create/update Message object, update Conversation
  - presence_update → Update who's viewing what (for coordination)
  - (future: order_status_changed, driver_location_updated)
```

### 9.3 Writeback (Ontology → Dispatch)

When the ontology changes due to an action:
1. Action modifies ontology objects
2. Execution layer translates to browser/API calls
3. Dispatch system processes the change
4. Next pull sync confirms the change was applied
5. If not confirmed → flag discrepancy, retry or alert

---

## 10. Scenario Sandboxing (Future)

Inspired by Palantir's Scenarios feature. When Sisyphus needs to make a batch decision:

**Example**: A driver goes offline with 3 active orders.

```
1. Create a scenario branch of the ontology
2. In the branch:
   - Find 3 best replacement drivers
   - Simulate all 3 reassignments
   - Calculate new ETAs for each
   - Check for conflicts (driver already at capacity, etc.)
3. Present the scenario to supervisor agent (or human):
   "If we reassign:
    Order #101 → Driver Sarah (new ETA: 18 min, was 12 min)
    Order #102 → Driver Mike (new ETA: 25 min, was 20 min)
    Order #103 → Driver Sarah (new ETA: 35 min, was 15 min) ⚠️ significant delay"
4. Accept → execute all 3 reassignments atomically
   Reject → try different assignments
```

This is a Phase 4+ feature but the ontology architecture supports it from day one.

---

## 11. Impact on Original Design Documents

This ontology layer **replaces and improves** several aspects of the original plan:

| Original Plan | Updated With Ontology |
|--------------|----------------------|
| Agents reason over DOM/page state | Agents reason over typed objects |
| Actions = "click this button" | Actions = "call AssignDriverToOrder with params" |
| Validation happens at form submission | Validation happens at ontology layer BEFORE execution |
| Audit = activity logs from dispatch | Audit = rich records with reasoning, before/after state |
| Process files describe UI navigation | Process files describe decision logic over objects |
| Browser-use for everything | Browser-use only for execution, not reasoning |
| Cooldowns checked by agent | Cooldowns enforced by ontology layer |

**Documents 01-07 remain valid** for infrastructure, memory, and deployment. This document adds the missing middle layer that makes the whole system more robust.

---

## 12. Implementation Priority

The ontology layer should be built in Phase 1 (Foundation), not bolted on later:

1. **Define object types** (Python dataclasses/Pydantic models)
2. **Build the sync layer** (poll dispatch API → populate objects)
3. **Define action types** with submission criteria
4. **Build the execution layer** (action → browser/API)
5. **Build the audit system** (log every action)
6. **Wire LangGraph tools** to ontology queries and actions
7. **Add guardrails** (cooldowns, rate limits, circuit breaker)

This is additional upfront work but dramatically reduces complexity in Phases 2-4, because agents operate against a stable, validated interface rather than a shifting UI.
