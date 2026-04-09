// scripts/whitepaper/sections/proof-of-concept.ts

export function proofOfConceptSection(): string {
  return `
    <div class="divider-page">
      <div class="divider-content">
        <div class="divider-num">Section II</div>
        <div class="divider-title">Proof of Concept</div>
        <div class="divider-rule"></div>
      </div>
    </div>

    <div class="section">
      <div class="section-num">Section II</div>
      <h2 class="section-title" id="poc">Proof of Concept</h2>
      <div class="section-rule"></div>

      <p class="lead">
        Project Sisyphus is an autonomous multi-agent AI system designed to
        monitor, triage, and act on delivery operations in real time. Named for
        the figure of Greek mythology condemned to roll a boulder uphill for
        eternity, it embraces the relentless, repetitive nature of dispatch
        operations&mdash;and brings tireless, consistent execution to a domain
        that demands it.
      </p>

      <p>
        Built in TypeScript on <strong>LangChain</strong> and
        <strong>LangGraph.js</strong>, Sisyphus uses a typed ontology layer
        (Zod schemas for every entity), Redis-backed cooldowns and locks,
        and PostgreSQL audit trails. LangGraph&rsquo;s <code>StateGraph</code>
        with parallel dispatch via <code>Send</code> enables the supervisor to
        route multiple sub-agents simultaneously in a single graph invocation.
      </p>

      <p>
        Every LLM call is traced through <strong>Langfuse</strong> (self-hosted),
        providing long-term auditability of the exact prompts, context windows,
        tool calls, reasoning chains, and token usage for every AI decision.
        When reviewing a past action&mdash;days or weeks later&mdash;operators
        can inspect the full trace: what the model saw, what it considered, and
        why it chose that action. This is critical for compliance, debugging,
        and continuous improvement of agent behavior.
      </p>

      <p>
        Crucially, the audit trail is not limited to AI actions. <strong>Human
        dispatcher actions</strong> are recorded in the same timeline&mdash;manual
        assignments, overrides, approvals, and rejections all appear alongside
        AI decisions. Over time, the system will also capture other operational
        events: router-based auto-assignments, driver order rejections, restaurant
        pause triggers, and other system decisions. This unified history means
        any entity&rsquo;s full story&mdash;AI and human actions
        interleaved&mdash;can be reconstructed from a single query.
      </p>

      <h3 id="arch">Multi-Agent Architecture</h3>

      <p>
        Rather than a single monolithic AI making all decisions, Sisyphus employs
        a <strong>supervisor-worker architecture</strong> where a central routing
        agent delegates specific tasks to specialized sub-agents. Each agent has
        deep expertise in its domain and access to only the tools it needs.
      </p>

      <div class="arch">
        <div class="arch-row">
          <div class="arch-box arch-supervisor">
            SUPERVISOR<br>
            <span style="font-weight:400;font-size:8pt;color:#a0967e">Monitor &bull; Triage &bull; Route</span>
          </div>
        </div>
        <div class="arch-arrows">&#9660; &nbsp; &#9660; &nbsp; &#9660;</div>
        <div class="arch-row">
          <div class="arch-box arch-agent">
            <strong>Driver Comms</strong><br>
            <span style="font-size:7.5pt;color:#666">Messages, follow-ups,<br>reassignments</span>
          </div>
          <div class="arch-box arch-agent">
            <strong>Customer Support</strong><br>
            <span style="font-size:7.5pt;color:#666">Ticket investigation<br>&amp; resolution</span>
          </div>
          <div class="arch-box arch-agent">
            <strong>Task Executor</strong><br>
            <span style="font-size:7.5pt;color:#666">Admin actions,<br>status updates</span>
          </div>
        </div>
        <div class="arch-label">Sub-agents execute in parallel via LangGraph Send</div>
      </div>

      <p>
        The <strong>Supervisor</strong> reads the full dispatch board every cycle
        and makes routing decisions&mdash;it never investigates or acts directly.
        Sub-agents only receive tasks when there's specific work to do: a ticket
        to resolve, a driver to message, an order to reassign. Critically,
        sub-agents <strong>execute in parallel</strong>&mdash;when the Supervisor
        identifies five tickets and two driver issues, all seven tasks dispatch at once.
      </p>

      <div class="keep-together">
        <h3 id="cycle">The Cycle</h3>

        <p>
          Sisyphus operates on a continuous polling cycle, syncing fresh data
          every 20 seconds from production systems:
        </p>

        <ol>
          <li><strong>Sync</strong> &mdash; Fetch latest dispatch data, open tickets, and driver messages</li>
          <li><strong>Detect</strong> &mdash; Diff against previous state to identify what changed</li>
          <li><strong>Decide</strong> &mdash; Determine whether the LLM needs to be invoked (changes detected, heartbeat timeout, or first cycle)</li>
          <li><strong>Build</strong> &mdash; Assemble a focused prompt with context, action history, and pending events</li>
          <li><strong>Invoke</strong> &mdash; Run the agent graph; Supervisor routes, sub-agents execute in parallel</li>
          <li><strong>Record</strong> &mdash; Log all actions to an immutable audit trail with reasoning</li>
        </ol>
      </div>

      <div class="callout">
        <p>
          <strong>Intelligent invocation:</strong> The LLM is not called every
          20 seconds. If nothing has changed and no heartbeat is due, the cycle
          skips invocation entirely&mdash;keeping costs low while maintaining
          responsiveness when conditions change.
        </p>
      </div>

      <div class="keep-together">
        <h3 id="guardrails">Guardrails &amp; Autonomy Tiers</h3>

        <p>
          Every action Sisyphus proposes passes through a multi-stage validation
          pipeline before execution:
        </p>

        <div class="pipeline">
          <div class="pipeline-step">Schema<br>Validation</div>
          <div class="pipeline-step">Cooldown<br>Check</div>
          <div class="pipeline-step">Rate<br>Limit</div>
          <div class="pipeline-step">Circuit<br>Breaker</div>
          <div class="pipeline-step">Domain<br>Criteria</div>
          <div class="pipeline-step active">Tier<br>Decision</div>
          <div class="pipeline-step">Execute<br>or Stage</div>
          <div class="pipeline-step">Audit<br>Log</div>
        </div>
      </div>

      <p>
        Actions are classified into four <strong>autonomy tiers</strong> that
        govern how they are handled:
      </p>

      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Policy</th>
            <th>Examples</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="tier tier-green">Green</span></td>
            <td>Auto-execute. Safe, reversible.</td>
            <td>Add ticket note, flag market issue, escalate ticket</td>
          </tr>
          <tr>
            <td><span class="tier tier-yellow">Yellow</span></td>
            <td>Auto-execute, logged prominently.</td>
            <td>Send driver message, assign driver, reassign order</td>
          </tr>
          <tr>
            <td><span class="tier tier-orange">Orange</span></td>
            <td>Staged for review during ramp-up.</td>
            <td>Resolve ticket, small refunds (&lt; $25)</td>
          </tr>
          <tr>
            <td><span class="tier tier-red">Red</span></td>
            <td>Always requires human approval.</td>
            <td>Cancel order, refunds &ge; $25</td>
          </tr>
        </tbody>
      </table>

      <div class="keep-together">
        <h3 id="memory">Institutional Memory</h3>

        <p>
          One of the most insidious AI failure modes is <strong>retry
          thrashing</strong>&mdash;an agent repeatedly attempting the same action
          because it has no memory of having tried it before. Sisyphus solves this
          with an <strong>Action Ledger</strong>: a rolling 30-minute history of
          all actions across cycles, injected directly into the Supervisor's prompt.
          Combined with per-entity cooldowns at the guardrail level, this dual-layer
          memory ensures the system never sends the same driver three messages in
          two minutes or resolves the same ticket twice.
        </p>
      </div>

      <div class="keep-together">
        <h3 id="shadow">Shadow Testing</h3>

        <p>
          The proof of concept was validated in <strong>shadow mode</strong>&mdash;connected
          to live production data from S3, DynamoDB, and WebSocket feeds, but executing
          through a <strong>ShadowExecutor</strong> that records proposals without
          triggering real side effects. The LLM backbone is <strong>Gemini 3
          Flash</strong>, selected after testing against DeepSeek, Kimi K2.5,
          and Gemini Lite for structured tool-calling accuracy. No synthetic
          scenarios or cherry-picked test cases&mdash;every edge case that
          production presents, shadow mode encounters.
        </p>
      </div>

      <div class="keep-together">
        <h3 id="sample">Sample Cycle: Morning Ticket Triage</h3>

        <p>
          On March 31, 2026, at 7:09 AM, Sisyphus encountered 5 unresolved support
          tickets across the Pembroke market:
        </p>
      </div>

      <div class="log">
<span class="time">[7:09:10]</span> Ready. 5 tickets synced, 1414 driver conversations loaded<br><br>
<span class="time">[7:09:14]</span> <span class="agent">[supervisor]</span> <span class="route">ROUTE</span> &rarr; customer_support: Resolve ticket 6267a660 (Driver Issue)<br>
<span class="time">[7:09:14]</span> <span class="agent">[supervisor]</span> <span class="route">ROUTE</span> &rarr; customer_support: Resolve ticket a45db6d8 (Dropped Shift)<br>
<span class="time">[7:09:14]</span> <span class="agent">[supervisor]</span> <span class="route">ROUTE</span> &rarr; customer_support: Resolve ticket 7c631029 (Dropped Shift)<br>
<span class="time">[7:09:14]</span> <span class="agent">[supervisor]</span> <span class="route">ROUTE</span> &rarr; customer_support: Resolve ticket 4bfb4a70 (System Error)<br>
<span class="time">[7:09:14]</span> <span class="agent">[supervisor]</span> <span class="route">ROUTE</span> &rarr; customer_support: Resolve ticket 4e3561d1 (Driver Not Responding)<br><br>
<span class="time">[7:09:16]</span> <span class="agent">[customer_support]</span> <span class="action">QUERY</span> get_ticket_details, get_entity_timeline &times;5 (parallel)<br>
<span class="time">[7:09:17]</span> <span class="agent">[customer_support]</span> <span class="action">QUERY</span> query_driver_shifts, query_orders (context gathering)<br><br>
<span class="time">[7:09:20]</span> <span class="agent">[customer_support]</span> <span class="ok">&check; AddTicketNote</span> &rarr; executed | 6267a660<br>
<span class="time">[7:09:20]</span> <span class="agent">[customer_support]</span> <span class="ok">&check; ResolveTicket</span> &rarr; staged | 6267a660<br>
<span class="time">[7:09:22]</span> <span class="agent">[customer_support]</span> <span class="ok">&check; AddTicketNote</span> &rarr; executed | a45db6d8<br>
<span class="time">[7:09:22]</span> <span class="agent">[customer_support]</span> <span class="ok">&check; FlagMarketIssue</span> &rarr; executed | Pembroke<br>
<span class="time">[7:09:22]</span> <span class="agent">[customer_support]</span> <span class="ok">&check; ResolveTicket</span> &rarr; staged | a45db6d8<br>
<span class="time">[7:09:24]</span> <span class="agent">[customer_support]</span> <span class="ok">&check; ResolveTicket</span> &rarr; staged | 7c631029<br>
<span class="time">[7:09:22]</span> <span class="agent">[customer_support]</span> <span class="action">ESCALATE</span> tickets 4e3561d1 + 4bfb4a70 (linked, needs human review)<br>
      </div>

      <p>
        In <strong>10 seconds</strong>, Sisyphus investigated all 5 tickets in
        parallel: queried ticket details and entity timelines, checked driver
        shift coverage, looked up relevant procedures, and took differentiated
        action on each:
      </p>

      <table>
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Type</th>
            <th>AI Decision</th>
            <th>Reasoning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>6267a660</code></td>
            <td>Driver Issue</td>
            <td><span class="tier tier-orange">Staged</span></td>
            <td>Acknowledged medical excuse, documented absence, resolved as no-action</td>
          </tr>
          <tr>
            <td><code>a45db6d8</code></td>
            <td>Dropped Shift</td>
            <td><span class="tier tier-orange">Staged</span></td>
            <td>Flagged coverage gap, noted DynamoDB unavailability, documented workaround</td>
          </tr>
          <tr>
            <td><code>7c631029</code></td>
            <td>Dropped Shift</td>
            <td><span class="tier tier-orange">Staged</span></td>
            <td>Confirmed market inactive, no immediate impact, resolved with documentation</td>
          </tr>
          <tr>
            <td><code>4bfb4a70</code></td>
            <td>System Error</td>
            <td><span class="tier tier-red">Escalated</span></td>
            <td>Linked to driver non-response ticket, order status unclear, needs human review</td>
          </tr>
          <tr>
            <td><code>4e3561d1</code></td>
            <td>Driver Not Responding</td>
            <td><span class="tier tier-red">Escalated</span></td>
            <td>Related to system error ticket, complex multi-entity situation</td>
          </tr>
        </tbody>
      </table>

      <div class="keep-together">
        <h3>Key Observations</h3>

        <div class="two-col">
          <div>
            <h4>What Worked Well</h4>
            <ul>
              <li>Correctly identified linked tickets (4bfb4a70 + 4e3561d1) and escalated as a pair</li>
              <li>Investigated before acting&mdash;queried timelines, shift data, and order history</li>
              <li>Adapted to system degradation (DynamoDB unavailable) by flagging the limitation</li>
              <li>All resolutions staged, not auto-executed&mdash;guardrails working as designed</li>
              <li>Parallel execution: 5 investigations in 10 seconds</li>
            </ul>
          </div>
          <div>
            <h4>What the Guardrails Caught</h4>
            <ul>
              <li>Ticket resolutions staged at ORANGE tier for human review</li>
              <li>Cooldowns prevented duplicate actions on same entities</li>
              <li>Entity timelines checked before every action to prevent re-work</li>
              <li>No fabricated IDs&mdash;all referenced real ticket and order identifiers</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="stats">
        <div class="stat-card">
          <div class="stat-value">10s</div>
          <div class="stat-label">Total Resolution Time</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">5</div>
          <div class="stat-label">Tickets Triaged</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">0</div>
          <div class="stat-label">Invalid Actions</div>
        </div>
      </div>
    </div>
  `;
}
