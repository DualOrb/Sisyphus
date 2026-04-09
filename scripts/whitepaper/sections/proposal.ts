// scripts/whitepaper/sections/proposal.ts

export function proposalSection(icons: Record<string, string>): string {
  return `
    <div class="divider-page">
      <div class="divider-content">
        <div class="divider-num">Section III</div>
        <div class="divider-title">The Proposal</div>
        <div class="divider-rule"></div>
      </div>
    </div>

    <div class="section">
      <div class="section-num">Section III</div>
      <h2 class="section-title" id="proposal">The Proposal</h2>
      <div class="section-rule"></div>

      <p class="lead">
        The proof of concept validated that AI can make sound dispatch decisions
        against real operational data. The path to production requires a
        fundamental architectural shift&mdash;from polling a static dispatch file
        to reacting to a real-time event stream, and from a single supervisor
        to event-driven agents that spin up on demand.
      </p>

      <h3 id="pipeline">Unified Event Pipeline</h3>

      <p>
        The current proof of concept polls an S3 dispatch file every 20 seconds.
        This works for shadow testing but introduces latency, misses transient
        state changes, and requires parsing a monolithic text file. The production
        architecture replaces polling with a <strong>real-time event
        pipeline</strong>&mdash;built on infrastructure that already exists.
      </p>

      <p>
        ValleyEats already operates <strong>DynaClone</strong>: a system that
        consumes DynamoDB Streams (NEW_AND_OLD_IMAGES) from all 7 tables via
        a Lambda that forwards events to a PHP endpoint on EC2, which then
        syncs the data to a SQL database&mdash;a real-time mirror of the
        entire DynamoDB state. Rather than building a new event pipeline from
        scratch, Sisyphus extends DynaClone at the PHP layer: alongside the
        existing table sync, the endpoint also writes <strong>filtered
        timeline events</strong> to a new <code>entity_timeline</code> table
        in the same SQL database.
      </p>

      <div class="aws-flow">
        <div class="aws-step">
          <div class="aws-box primary">
            <img src="${icons.dynamodb || ''}" alt="DynamoDB">
            <div><strong>DynamoDB Tables (7)</strong><br><span style="font-size:7.5pt;font-weight:400;color:#a0967e">Streams: NEW_AND_OLD_IMAGES</span></div>
          </div>
          <div class="aws-desc">Orders, Drivers, Restaurants, Messages,<br>Shifts, Availability, Transactions</div>
        </div>
        <div class="aws-arrow">&#9660;</div>
        <div class="aws-step">
          <div class="aws-box secondary">
            <img src="${icons.lambda || ''}" alt="Lambda">
            <div><strong>DynaClone Lambda</strong><br><span style="font-size:7.5pt;color:#888">Existing, forwards events</span></div>
          </div>
          <div class="aws-desc">Receives stream events, forwards<br>to PHP endpoint on EC2.</div>
        </div>
        <div class="aws-arrow">&#9660;</div>
        <div class="aws-step">
          <div class="aws-box secondary" style="min-width:300px;">
            <div><strong>DynaClone PHP Endpoint</strong> <span style="font-size:7pt;color:#888">(EC2)</span><br><span style="font-size:7.5pt;color:#888">Existing sync layer, extended</span></div>
          </div>
          <div class="aws-desc">Already syncs all tables to SQL.<br>New: also writes filtered timeline events.</div>
        </div>
        <div class="aws-arrow" style="position:relative;">&#9660; &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; &#9660;</div>
        <div class="aws-step" style="gap:16px;">
          <div class="aws-box secondary" style="min-width:180px;">
            <div><strong>SQL Tables</strong><br><span style="font-size:7.5pt;color:#888">Existing mirror</span></div>
          </div>
          <div class="aws-box primary" style="min-width:180px;">
            <div><strong style="color:#f5f0e8">Entity Timeline</strong><br><span style="font-size:7.5pt;font-weight:400;color:#a0967e">New table</span></div>
          </div>
          <div class="aws-desc">Same database, two functions:<br>full table sync + event history.</div>
        </div>
        <div class="aws-arrow">&#9660;</div>
        <div class="aws-step">
          <div class="aws-box" style="background:#1a1f2e;color:#c9a96e;font-family:'Inter',sans-serif;font-size:9pt;font-weight:500;padding:10px 16px;border-radius:6px;border:2px solid #c9a96e;min-width:300px;">
            <div><strong style="color:#f5f0e8;font-size:10pt;">Sisyphus Service</strong> <span style="font-size:7pt;color:#a0967e">(Docker, on-premise)</span><br>
            <span style="font-size:7.5pt;font-weight:400;color:#a0967e">Reads timeline &bull; Detection algorithms &bull; Cycle processor &bull; Agents</span></div>
          </div>
          <div class="aws-desc">Queries SQL timeline every 20s.<br>Runs algorithms, dispatches agents.</div>
        </div>
      </div>

      <div class="callout">
        <p>
          <strong>Zero new infrastructure.</strong> DynaClone already processes
          every DynamoDB stream event. The only changes are: a few lines of
          filtering logic in the existing PHP endpoint, one new SQL table, and
          the Sisyphus Docker service on the office server. No new AWS services,
          no new costs. The same server that runs Sisyphus can later host the
          local AI model.
        </p>
      </div>

      <div class="keep-together">
        <h4>Smart Filtering</h4>

        <p>
          Not every database write is a meaningful signal. The DynaClone PHP
          endpoint applies field-level filters before writing to the timeline,
          dramatically reducing noise:
        </p>

        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th>Pass When</th>
              <th>Drop</th>
              <th>Reduction</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Restaurants</strong></td>
              <td>status, isOpen, hours, pausedUntil, acceptingOrders change</td>
              <td>Health-check heartbeats</td>
              <td>~95%</td>
            </tr>
            <tr>
              <td><strong>Drivers</strong></td>
              <td>status, currentOrderId, isAvailable, isOnline, shiftId change</td>
              <td>Location-only updates</td>
              <td>~80%</td>
            </tr>
            <tr>
              <td><strong>All others</strong></td>
              <td>Everything (low volume, all signal)</td>
              <td>&mdash;</td>
              <td>0%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="keep-together">
        <h4>What Sisyphus Sees</h4>

        <p>
          A single SQL query by entity ID returns the complete, filtered
          history. Every entity&rsquo;s story is told in one timeline:
        </p>

        <div class="timeline-block">
<span class="entity">ORDER#4821</span><br>
&nbsp;&nbsp;<span class="ts">11:02:01</span>  <span class="change">Created &rarr; InProgress</span><br>
&nbsp;&nbsp;<span class="ts">11:14:32</span>  <span class="change">InProgress &rarr; AtRestaurant</span><br>
&nbsp;&nbsp;<span class="ts">11:18:45</span>  <span class="change">assigned driverId: d55</span><br>
&nbsp;&nbsp;<span class="ts">11:22:10</span>  <span class="change">AtRestaurant &rarr; InTransit</span><br>
&nbsp;&nbsp;<span class="ts">11:31:02</span>  <span class="change">InTransit &rarr; Delivered</span><br>
<br>
<span class="entity">DRIVER#d55</span><br>
&nbsp;&nbsp;<span class="ts">10:58:00</span>  <span class="change">status: Available</span><br>
&nbsp;&nbsp;<span class="ts">11:18:45</span>  <span class="change">assigned order #4821</span><br>
&nbsp;&nbsp;<span class="ts">11:22:15</span>  <span class="change">status: InTransit</span><br>
&nbsp;&nbsp;<span class="ts">11:31:05</span>  <span class="change">status: Available</span>
        </div>
      </div>

      <h3 id="detection">Algorithm-Driven Event Detection</h3>

      <p>
        Raw state changes from the stream are only half the picture. Sisyphus
        will layer <strong>custom detection algorithms</strong> on top of the
        event pipeline and location data from the existing dispatch files,
        identifying operational anomalies that no single database write reveals:
      </p>

      <ul>
        <li><strong>Order assigned to offline driver</strong> &mdash; mismatch between order assignment and driver status</li>
        <li><strong>Predicted late delivery</strong> &mdash; ETA calculation based on driver location, distance, and current speed</li>
        <li><strong>Stationary driver</strong> &mdash; driver hasn't moved in 5+ minutes with an active order</li>
        <li><strong>Ready order with no driver</strong> &mdash; order marked ready at restaurant but no driver assigned after 3 minutes</li>
        <li><strong>Driver near restaurant</strong> &mdash; geofence triggers for arrival detection</li>
      </ul>

      <p>
        These derived signals are written back to the same timeline as
        <strong>signal processor events</strong>, appearing alongside raw state
        changes. Because the detection algorithms run in-process alongside the
        Kinesis consumer, derived signals are computed with zero additional
        latency or infrastructure cost.
      </p>

      <h3 id="cycleproc">The Cycle Processor</h3>

      <p>
        Rather than triggering on every individual event&mdash;which at 5+ changes
        per second during peak hours would create overlapping, competing
        processes&mdash;Sisyphus collects and processes changes on a
        <strong>20-second schedule</strong>. Each cycle sees the complete picture
        of what happened since the last run.
      </p>

      <div class="keep-together">
        <h4>How a Cycle Runs</h4>
        <p>
          A simple interval timer within the Sisyphus service triggers the cycle
          processor every 20 seconds. The processor:
        </p>
        <ol style="margin-bottom:14px;">
          <li style="margin-bottom:6px;"><strong>Queries the local timeline</strong> for all events since the last
            cycle&mdash;new order status changes, driver updates, restaurant state transitions,
            and any derived signals from the detection algorithms.</li>
          <li style="margin-bottom:6px;"><strong>Groups by entity</strong> to build a per-entity view: what changed
            for each order, each driver, each restaurant in this window.</li>
          <li style="margin-bottom:6px;"><strong>Runs detection algorithms</strong> against the accumulated state.
            These algorithms cross-reference the timeline with current entity state:
            an order that has been ready for 4 minutes with no driver assigned, a
            driver whose last 10 GPS pings show zero movement, an order assigned
            to a driver who went offline.</li>
          <li style="margin-bottom:6px;"><strong>Writes derived signal events</strong> back to the timeline table.
            These appear alongside raw changes: <code>SIGNAL: ready_no_driver_3min</code>,
            <code>SIGNAL: driver_stationary_5min</code>.</li>
          <li style="margin-bottom:6px;"><strong>Dispatches agents</strong> for anything that requires AI reasoning
            or action. Each signal maps to an agent type: driver anomalies route to
            the Market Supervisor, incoming messages spawn a Driver Agent,
            new tickets trigger Customer Support.</li>
        </ol>
      </div>

      <div class="callout">
        <p><strong>Why batched, not per-event:</strong> AI inference takes time&mdash;even
        a fast model needs seconds to reason through a dispatch decision. Triggering
        an agent on every individual event would overwhelm the system during peak
        hours when dozens of state changes arrive per second. Batching into 20-second
        cycles ensures the AI has time to process each dispatch thoroughly. The
        detection algorithms themselves are designed to account for incomplete
        information&mdash;they know more events may arrive in the next cycle and
        calibrate their signals accordingly.</p>
      </div>

      <div class="keep-together">
        <h4>What the AI Receives</h4>
        <p>
          When a cycle determines that an agent is needed, it assembles a
          <strong>context package</strong> from the local timeline&mdash;not just
          the triggering signal, but the entity's complete recent history:
        </p>

        <pre style="background:#1a1f2e;color:#d4d4d4;padding:16px 20px;border-radius:6px;font-family:'Fira Code',monospace;font-size:8.5pt;line-height:1.6;margin:16px 0;white-space:pre;overflow:hidden;">
<span style="color:#c9a96e">Cycle 14:22:40 &mdash; 3 events, 1 signal, 1 agent dispatch</span>

<span style="color:#6a9955">ORDER#4821</span>
  14:22:01  status: InProgress &rarr; AtRestaurant
  14:22:01  readyAt: 14:22:00
  14:25:45  <span style="color:#ce9178">SIGNAL: ready_no_driver_3min</span>

<span style="color:#6a9955">RESTAURANT#r12</span>
  14:20:00  acceptingOrders: true
  14:22:01  activeOrders: 3 &rarr; 4

<span style="color:#c9a96e">&rarr; Dispatch: Market Supervisor (Pembroke)</span>
  Context: order ready 3+ min, no driver assigned
  Timeline: ORDER#4821 (last 30 min), DRIVER pool (Pembroke)</pre>

        <p>
          The agent doesn't need to query for context&mdash;it arrives pre-assembled
          from the timeline. The AI starts reasoning immediately, with full visibility
          into what led to this moment.
        </p>
      </div>

      <h3 id="agents">Event-Driven Agent Architecture</h3>

      <p>
        The proof of concept uses a single supervisor that polls the full dispatch
        board. The production architecture inverts this: <strong>agents spin up
        on demand</strong> in response to stream events and algorithm-detected
        anomalies. Instead of one AI reading everything and deciding what matters,
        the infrastructure identifies what matters and spins up the right AI to
        handle it.
      </p>

      <div class="arch">
        <div class="arch-row">
          <div class="arch-box" style="background:#f0ece4;color:#1a1f2e;min-width:480px;border-color:#c9a96e">
            <strong style="color:#c9a96e">Event Stream + Algorithm Signals</strong><br>
            <span style="font-size:7.5pt;color:#666">Kinesis events &bull; Detection algorithms &bull; Incoming messages</span>
          </div>
        </div>
        <div class="arch-arrows">&#9660; &nbsp; &#9660; &nbsp; &#9660;</div>
        <div class="arch-row">
          <div class="arch-box arch-supervisor" style="min-width:140px">
            Market<br>Supervisor<br>
            <span style="font-weight:400;font-size:7pt;color:#a0967e">1 per market (max)</span>
          </div>
          <div class="arch-box arch-supervisor" style="min-width:140px">
            Driver<br>Agent<br>
            <span style="font-weight:400;font-size:7pt;color:#a0967e">per message</span>
          </div>
          <div class="arch-box arch-supervisor" style="min-width:140px">
            Customer<br>Support<br>
            <span style="font-weight:400;font-size:7pt;color:#a0967e">per ticket</span>
          </div>
        </div>
        <div class="arch-label">Agents may hand off to specialized agents after completing research</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Trigger</th>
            <th>Scope</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Market Supervisor</strong></td>
            <td>Order events, driver anomalies, algorithm signals</td>
            <td>At most 1 per market. Handles routing, assignments, driver issues within that market.</td>
          </tr>
          <tr>
            <td><strong>Driver Agent</strong></td>
            <td>Incoming driver message</td>
            <td>1 per conversation. Responds to driver queries, handles communication.</td>
          </tr>
          <tr>
            <td><strong>Customer Support</strong></td>
            <td>New or updated ticket</td>
            <td>Investigates and resolves support tickets. Can escalate to Market Supervisor.</td>
          </tr>
        </tbody>
      </table>

      <p>
        Each agent may choose to <strong>hand off</strong> to a more specialized
        agent after completing its research. A Customer Support agent investigating
        a late delivery may hand off to the Market Supervisor for driver
        reassignment. A Market Supervisor may hand off to a Driver Agent for
        targeted communication.
      </p>

      <div class="keep-together">
        <h3 id="reasoning">AI Reasoning Trail &amp; Shared Memory</h3>

        <p>
          When multiple agents work on related entities, context cannot be lost
          between them. The production system introduces two mechanisms:
        </p>

        <div class="two-col">
          <div>
            <h4>Decision Traces</h4>
            <p>
              Every agent&rsquo;s reasoning is recorded as a structured
              <strong>decision trace</strong>&mdash;not just the final action,
              but the alternatives considered, the guardrail checks passed,
              and the data that informed the decision. When an agent hands off
              to another, the full trace transfers with it. The receiving agent
              knows what was investigated, what was concluded, and what remains
              unresolved.
            </p>
          </div>
          <div>
            <h4>Central AI Memory</h4>
            <p>
              A shared memory layer ensures agents are aware of what other
              agents have done across the system. Ontology snapshots are
              frozen at cycle start so all parallel agents see the same world
              state. Cross-agent visibility comes from the Redis action
              timeline: if the Market Supervisor already messaged a driver,
              the Driver Agent handling that driver&rsquo;s reply sees the
              full interaction history before composing its response.
            </p>
          </div>
        </div>
      </div>

      <h3 id="oversight">Human Oversight &amp; Transition</h3>

      <p>
        The existing guardrails carry forward: ontology layer, autonomy tiers,
        human review flagging, and immutable audit trails. What changes is
        visibility. Human dispatchers will be able to:
      </p>

      <ul>
        <li><strong>Review AI reasoning</strong> &mdash; see exactly what each agent investigated, concluded, and did, with full chain-of-thought</li>
        <li><strong>See algorithm-flagged events</strong> &mdash; the same anomalies that trigger agents are surfaced to humans in a new event-driven dashboard</li>
        <li><strong>Override and intervene</strong> &mdash; staged actions remain reviewable; RED tier actions still require human approval</li>
      </ul>

      <p>
        This enables a gradual phase-out of the legacy map-based dispatch
        interface. As operators build confidence in the event-driven system,
        the AI handles more autonomously while humans shift to strategic
        oversight&mdash;reviewing patterns, tuning algorithms, and handling
        the genuinely novel situations that the system correctly escalates.
      </p>

      <h3 id="dashboard">The Operator Dashboard</h3>

      <p>
        The dashboard is where human dispatchers and Sisyphus meet. It
        replaces the legacy map-based dispatch view with an
        <strong>event-driven operations console</strong> that surfaces
        everything the AI sees, does, and needs help with.
      </p>

      <!-- Dashboard Mockup -->
      <div style="border:1px solid #d0ccc4;border-radius:8px;overflow:hidden;margin:24px 0;font-family:'Inter',sans-serif;font-size:8pt;page-break-inside:avoid;background:#fff;">
        <!-- Title bar -->
        <div style="background:#1a1f2e;color:#c9a96e;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;">
          <div style="font-weight:600;font-size:9pt;letter-spacing:1px;">SISYPHUS &nbsp;<span style="color:#666;font-weight:400;font-size:7pt;">DISPATCH CONSOLE</span></div>
          <div style="color:#888;font-size:7pt;">Pembroke &bull; 3 active &bull; 14:25:40</div>
        </div>
        <!-- Tabs -->
        <div style="display:flex;border-bottom:2px solid #e8e0d4;background:#faf8f5;">
          <div style="padding:8px 20px;font-weight:600;color:#1a1f2e;border-bottom:2px solid #c9a96e;margin-bottom:-2px;font-size:8pt;">Issues (3)</div>
          <div style="padding:8px 20px;color:#999;font-size:8pt;">AI Audit Trail</div>
          <div style="padding:8px 20px;color:#999;font-size:8pt;">Markets</div>
        </div>
        <!-- Body: two panels -->
        <div style="display:flex;min-height:320px;">
          <!-- Left: issue list -->
          <div style="width:200px;border-right:1px solid #e8e0d4;background:#faf8f5;flex-shrink:0;">
            <!-- Selected issue -->
            <div style="padding:10px 12px;background:#f0ece4;border-left:3px solid #c9a96e;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                <span style="background:#f8d7da;color:#721c24;padding:0 6px;border-radius:8px;font-size:6.5pt;font-weight:600;">CRITICAL</span>
              </div>
              <div style="font-weight:600;color:#1a1f2e;font-size:8pt;">Order #4821</div>
              <div style="color:#888;font-size:6.5pt;">Ready 4min, no driver &bull; 14:25</div>
            </div>
            <!-- Other issues -->
            <div style="padding:10px 12px;border-bottom:1px solid #eee;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                <span style="background:#ffe0cc;color:#a84300;padding:0 6px;border-radius:8px;font-size:6.5pt;font-weight:600;">WARNING</span>
              </div>
              <div style="font-weight:500;color:#1a1f2e;font-size:8pt;">Driver M. Chen</div>
              <div style="color:#888;font-size:6.5pt;">Stationary 6min &bull; 14:22</div>
            </div>
            <div style="padding:10px 12px;border-bottom:1px solid #eee;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                <span style="background:#fff3cd;color:#856404;padding:0 6px;border-radius:8px;font-size:6.5pt;font-weight:600;">CAUTION</span>
              </div>
              <div style="font-weight:500;color:#1a1f2e;font-size:8pt;">Shift Coverage</div>
              <div style="color:#888;font-size:6.5pt;">Arnprior: 0 drivers &bull; 14:20</div>
            </div>
            <div style="padding:10px 12px;border-bottom:1px solid #eee;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                <span style="background:#d4edda;color:#155724;padding:0 6px;border-radius:8px;font-size:6.5pt;font-weight:600;">RESOLVED</span>
              </div>
              <div style="font-weight:500;color:#999;font-size:8pt;">Ticket #a45d</div>
              <div style="color:#bbb;font-size:6.5pt;">Dropped shift &bull; 14:09</div>
            </div>
          </div>
          <!-- Right: detail panel -->
          <div style="flex:1;padding:14px 18px;background:#fff;">
            <!-- Issue header -->
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
              <div>
                <div style="font-size:11pt;font-weight:600;color:#1a1f2e;">Order #4821 &mdash; Ready, No Driver</div>
                <div style="color:#888;font-size:7pt;margin-top:2px;">Pembroke Beckers &bull; Detected 14:25:45 &bull; Signal: <code style="background:#f0ece4;padding:1px 4px;border-radius:3px;font-size:6.5pt;">ready_no_driver_3min</code></div>
              </div>
              <span style="background:#f8d7da;color:#721c24;padding:2px 10px;border-radius:10px;font-size:7pt;font-weight:600;">CRITICAL</span>
            </div>
            <!-- AI Actions -->
            <div style="background:#faf8f5;border-radius:6px;padding:10px 14px;margin-bottom:10px;">
              <div style="font-weight:600;color:#c9a96e;font-size:7pt;letter-spacing:1px;margin-bottom:6px;">AI REASONING</div>
              <div style="color:#2d2d2d;font-size:7.5pt;line-height:1.5;">
                <div style="margin-bottom:4px;">1. Queried timeline: order ready at 14:22:00, no driver assigned after 3m45s.</div>
                <div style="margin-bottom:4px;">2. Checked Pembroke driver pool: 2 online (J. Thibeau <span style="color:#155724;">available</span>, M. Chen <span style="color:#a84300;">stationary</span>).</div>
                <div style="margin-bottom:4px;">3. J. Thibeau is closest (2.1 km). Proposing assignment.</div>
              </div>
            </div>
            <!-- Proposed action -->
            <div style="border:1px solid #c9a96e;border-radius:6px;padding:10px 14px;margin-bottom:10px;background:rgba(201,169,110,0.04);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:600;color:#1a1f2e;font-size:8pt;">Proposed: AssignDriverToOrder</div>
                  <div style="color:#888;font-size:7pt;">J. Thibeau &rarr; Order #4821 &nbsp;&bull;&nbsp; <span style="background:#fff3cd;color:#856404;padding:0 6px;border-radius:8px;font-size:6pt;font-weight:600;">YELLOW</span></div>
                </div>
                <div style="display:flex;gap:6px;">
                  <div style="background:#1a1f2e;color:#c9a96e;padding:4px 14px;border-radius:4px;font-size:7pt;font-weight:600;">Approve</div>
                  <div style="background:#f0ece4;color:#666;padding:4px 14px;border-radius:4px;font-size:7pt;font-weight:500;">Reject</div>
                </div>
              </div>
            </div>
            <!-- Related entities -->
            <div style="font-weight:600;color:#888;font-size:6.5pt;letter-spacing:1px;margin-bottom:6px;">RELATED ENTITIES</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <div style="background:#f0ece4;padding:4px 10px;border-radius:4px;font-size:7pt;color:#1a1f2e;cursor:pointer;">
                <span style="color:#c9a96e;">&#9679;</span> ORDER #4821 <span style="color:#bbb;">&rsaquo;</span>
              </div>
              <div style="background:#f0ece4;padding:4px 10px;border-radius:4px;font-size:7pt;color:#1a1f2e;cursor:pointer;">
                <span style="color:#c9a96e;">&#9679;</span> DRIVER J. Thibeau <span style="color:#bbb;">&rsaquo;</span>
              </div>
              <div style="background:#f0ece4;padding:4px 10px;border-radius:4px;font-size:7pt;color:#1a1f2e;cursor:pointer;">
                <span style="color:#c9a96e;">&#9679;</span> RESTAURANT Pembroke Beckers <span style="color:#bbb;">&rsaquo;</span>
              </div>
              <div style="background:#f0ece4;padding:4px 10px;border-radius:4px;font-size:7pt;color:#1a1f2e;cursor:pointer;">
                <span style="color:#c9a96e;">&#9679;</span> DRIVER M. Chen <span style="color:#bbb;">&rsaquo;</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="keep-together">
        <h4>Algorithm-Detected Events</h4>

        <p>
          Every anomaly detected by the cycle processor appears in a
          real-time event feed, whether or not an agent was dispatched.
          Dispatchers see the same signals the AI sees:
        </p>

        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th>Severity</th>
              <th>Description</th>
              <th>AI Response</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>ready_no_driver</code></td>
              <td><span class="tier tier-red">Critical</span></td>
              <td>Order ready 3+ min, no driver assigned</td>
              <td>Market Supervisor dispatched</td>
            </tr>
            <tr>
              <td><code>driver_stationary</code></td>
              <td><span class="tier tier-orange">Warning</span></td>
              <td>Driver not moving 5+ min with active order</td>
              <td>Market Supervisor alerted</td>
            </tr>
            <tr>
              <td><code>predicted_late</code></td>
              <td><span class="tier tier-orange">Warning</span></td>
              <td>ETA exceeds promise time based on distance + speed</td>
              <td>Customer notified, driver checked</td>
            </tr>
            <tr>
              <td><code>driver_offline_with_order</code></td>
              <td><span class="tier tier-red">Critical</span></td>
              <td>Assigned driver went offline or lost connectivity</td>
              <td>Reassignment initiated</td>
            </tr>
            <tr>
              <td><code>order_assigned_offline</code></td>
              <td><span class="tier tier-orange">Warning</span></td>
              <td>Order assigned to driver who is not online</td>
              <td>Reassignment or driver contact</td>
            </tr>
            <tr>
              <td><code>driver_near_restaurant</code></td>
              <td><span class="tier tier-green">Info</span></td>
              <td>Geofence: driver within pickup radius</td>
              <td>Logged for ETA accuracy</td>
            </tr>
            <tr>
              <td><code>shift_coverage_gap</code></td>
              <td><span class="tier tier-yellow">Caution</span></td>
              <td>Market has orders but no drivers on shift</td>
              <td>Market issue flagged</td>
            </tr>
            <tr>
              <td><code>restaurant_paused</code></td>
              <td><span class="tier tier-yellow">Caution</span></td>
              <td>Restaurant stopped accepting orders mid-shift</td>
              <td>Pending orders checked</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        Dispatchers can filter by market, severity, and time range. Each event
        links to the entity timeline, showing the full context that triggered
        the detection. Events that the AI acted on are tagged with the
        agent&rsquo;s response; events below the dispatch threshold are
        visible but unactioned&mdash;giving dispatchers the option to
        intervene manually on anything the algorithms surface.
      </p>

      <div class="keep-together">
        <h4>AI Action History</h4>

        <p>
          Every action Sisyphus takes or proposes is logged with its full
          reasoning chain, autonomy tier, and outcome. The dashboard presents
          this as a filterable, color-coded history:
        </p>

        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>What Dispatchers See</th>
              <th>Dispatcher Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tier tier-green">Green</span></td>
              <td>Action executed automatically. Reasoning trail available on click. Appears in the activity feed.</td>
              <td>Review only. Can flag as incorrect for feedback loop.</td>
            </tr>
            <tr>
              <td><span class="tier tier-yellow">Yellow</span></td>
              <td>Action executed automatically with prominent highlight. Full reasoning, parameters, and entity context shown.</td>
              <td>Review, flag, or undo if within rollback window.</td>
            </tr>
            <tr>
              <td><span class="tier tier-orange">Orange</span></td>
              <td>Action staged for review. AI&rsquo;s reasoning, proposed parameters, and expected outcome displayed.</td>
              <td>Approve, modify, or reject. Can add notes.</td>
            </tr>
            <tr>
              <td><span class="tier tier-red">Red</span></td>
              <td>Action requires human approval. Full investigation summary, financial impact, and recommended action shown.</td>
              <td>Must explicitly approve or reject. Cannot auto-escalate.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="keep-together">
        <h4>Human Action Queue</h4>

        <p>
          Not everything the AI encounters can be resolved autonomously. The
          dashboard maintains a prioritized queue of items that need human
          attention:
        </p>

        <ul>
          <li><strong>Pending approvals</strong> &mdash; ORANGE and RED tier actions waiting for dispatcher sign-off</li>
          <li><strong>Escalations</strong> &mdash; situations the AI investigated but determined require human judgment (complex multi-entity issues, policy edge cases, customer exceptions)</li>
          <li><strong>Flagged anomalies</strong> &mdash; algorithm detections that didn&rsquo;t trigger an agent but exceed severity thresholds</li>
          <li><strong>Review samples</strong> &mdash; randomly sampled AUTO actions queued for quality scoring (correct / acceptable / incorrect)</li>
          <li><strong>System alerts</strong> &mdash; AI model errors, timeline ingestion delays, or cycle processor failures</li>
        </ul>

        <p>
          Each queue item includes the entity timeline, AI reasoning trail (if
          applicable), and one-click actions for common responses. The goal is
          that a dispatcher can review and act on any item in under 30
          seconds&mdash;the AI does the investigation, the human makes the
          final call.
        </p>
      </div>

      <div class="callout">
        <p>
          <strong>The shift in workflow:</strong> Today, dispatchers stare at a
          map and react to problems they notice. With Sisyphus, dispatchers
          review a prioritized queue of pre-investigated issues, approve or
          reject AI proposals, and monitor system health. The cognitive load
          moves from &ldquo;find the problem&rdquo; to &ldquo;verify the
          solution.&rdquo;
        </p>
      </div>

      <h3 id="integration">Incremental Integration Plan</h3>

      <p>
        Sisyphus will not be switched on all at once. The transition from
        shadow to production follows a controlled, phased approach where each
        stage builds confidence before expanding autonomy.
      </p>

      <div class="keep-together">
        <h4>Phase 1: Full Shadow Mode</h4>
        <p>
          The system connects to the real-time event pipeline and processes
          live production data through the full ontology layer&mdash;but every
          action is recorded, not executed. Human dispatchers continue operating
          as normal. Shadow reports are reviewed daily to evaluate decision quality,
          catch edge cases, and tune agent behavior. This phase runs until
          accuracy consistently meets confidence thresholds across all markets.
        </p>
      </div>

      <div class="keep-together">
        <h4>Phase 2: Autonomy Control Board</h4>
        <p>
          An operator-facing dashboard provides <strong>per-action toggle
          controls</strong>. For each action type (send message, assign driver,
          resolve ticket, etc.), operators can set the mode:
        </p>

        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th>Behavior</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Shadow</strong></td>
              <td>Action is proposed and logged but not executed. Appears in the review queue for scoring.</td>
            </tr>
            <tr>
              <td><strong>Confirm</strong></td>
              <td>Action is staged and requires human approval before execution. Operator sees the AI&rsquo;s reasoning and can approve, reject, or modify.</td>
            </tr>
            <tr>
              <td><strong>Auto</strong></td>
              <td>Action executes automatically. Still logged with full reasoning trail for post-hoc review.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        This gives operators granular control: they might enable
        <strong>Auto</strong> for low-risk actions (ticket notes, market flags)
        while keeping driver messages on <strong>Confirm</strong> and order
        cancellations on <strong>Shadow</strong>. As each action type proves
        reliable, its mode graduates upward.
      </p>

      <div class="keep-together">
        <h4>Phase 3: Human Review Loop</h4>
        <p>
          Even after an action type reaches <strong>Auto</strong> mode, a
          configurable percentage of executed actions are randomly sampled and
          queued for human review. Reviewers score each action as
          <em>correct</em>, <em>acceptable</em>, or <em>incorrect</em>.
          If the incorrect rate exceeds a threshold, the action type is
          automatically demoted back to <strong>Confirm</strong> mode until
          the issue is diagnosed. This creates a continuous feedback loop that
          catches regression without requiring constant oversight.
        </p>
      </div>

      <div class="callout">
        <p>
          <strong>The principle:</strong> At every stage, human dispatchers see
          exactly what the AI would do (or did do) and why. Trust is earned
          incrementally, action by action, market by market. The system is
          designed so that pulling back autonomy is as easy as flipping a toggle.
        </p>
      </div>

      <h3 id="hardening">Production Hardening</h3>

      <p>
        Shadow mode proves decision quality. Production demands something
        harder: an 8&ndash;12 hour autonomous shift where the system stays
        coherent, recovers from failures, manages its own resource limits,
        and never silently degrades. The following subsystems are designed to
        close the gap between &ldquo;works in testing&rdquo; and
        &ldquo;runs unattended.&rdquo;
      </p>

      <div class="keep-together">
        <h4>Context Window Management</h4>

        <p>
          The single hardest problem in a long-running agent is
          <strong>context exhaustion</strong>. Every cycle adds to the
          supervisor&rsquo;s prompt: new dispatch state, action ledger entries,
          sub-agent results, escalation notes. Over an 8-hour shift, the
          context window fills. If unmanaged, the agent either loses older
          context silently or hits the token limit and fails.
        </p>

        <p>
          Sisyphus manages context as a <strong>finite, budgeted
          resource</strong> with four mechanisms:
        </p>

        <div class="layer-stack">
          <div class="layer-row">
            <div class="layer-box dark" style="flex:2;">
              <strong>Token Budget Per Tool Result</strong><br>
              <span style="font-size:7pt;color:#a0967e">Ontology queries return summaries, not full objects. Each tool result capped at N tokens. Large results replaced with a reference key for on-demand retrieval.</span>
            </div>
          </div>
          <div class="layer-arrow">&#9660;</div>
          <div class="layer-row">
            <div class="layer-box mid">
              <strong>Rolling Prompt Window</strong><br>
              <span style="font-size:7pt;color:#a0967e">Action ledger keeps 30 min.<br>Older entries summarized into<br>a compact &ldquo;shift digest.&rdquo;</span>
            </div>
            <div class="layer-box mid">
              <strong>Inter-Cycle Compaction</strong><br>
              <span style="font-size:7pt;color:#a0967e">After each cycle, stale sub-agent<br>results compressed. Only decisions<br>and outcomes survive.</span>
            </div>
          </div>
          <div class="layer-arrow">&#9660;</div>
          <div class="layer-row">
            <div class="layer-box light" style="flex:2;">
              <strong>Session Memory</strong><br>
              <span style="font-size:7pt;color:#666">A structured document (max 12K tokens) that survives compaction: current shift state, active issues, key decisions, and open follow-ups. Rebuilt every N cycles. This is what the supervisor &ldquo;remembers&rdquo; about the shift even after older context is pruned.</span>
            </div>
          </div>
        </div>

        <div class="callout">
          <p>
            <strong>The budget math:</strong> At each cycle start, the system
            measures prompt token consumption by category&mdash;dispatch board,
            action ledger, session memory, tool results&mdash;and trends it over
            time. Compaction triggers at 75% of the effective context window,
            not at the limit. A 13,000-token buffer ensures there is always room
            for the LLM&rsquo;s response, even if the prompt estimate is slightly
            off.
          </p>
        </div>
      </div>

      <div class="keep-together">
        <h4>Layered Retry &amp; Error Recovery</h4>

        <p>
          Not all failures are equal, and not all callers deserve the same
          retry budget. Sisyphus classifies errors by type and adjusts its
          response based on <strong>who is asking</strong> and <strong>what
          went wrong</strong>:
        </p>

        <table>
          <thead>
            <tr>
              <th>Error Class</th>
              <th>Strategy</th>
              <th>Max Retries</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Rate limit</strong> (429)</td>
              <td>Exponential backoff with jitter</td>
              <td>5</td>
            </tr>
            <tr>
              <td><strong>Model overloaded</strong> (529)</td>
              <td>Retry for foreground (supervisor, active agents); skip for background (market health)</td>
              <td>3 foreground / 0 background</td>
            </tr>
            <tr>
              <td><strong>Malformed output</strong></td>
              <td>Withhold error, re-prompt with tighter constraints, surface only if recovery fails</td>
              <td>2</td>
            </tr>
            <tr>
              <td><strong>Connection error</strong></td>
              <td>Immediate retry, then fall back to cloud provider</td>
              <td>1 + fallback</td>
            </tr>
            <tr>
              <td><strong>Prompt too long</strong></td>
              <td>Trigger reactive compaction, then retry with reduced context</td>
              <td>2</td>
            </tr>
          </tbody>
        </table>

        <p>
          The key pattern is <strong>withholding</strong>: when the LLM returns
          a recoverable error (malformed tool call, exceeded output tokens),
          the system attempts recovery silently&mdash;compacting context,
          constraining output, re-prompting&mdash;before surfacing the failure
          to the cycle. Most transient errors resolve within one retry and
          never appear in the audit trail.
        </p>
      </div>

      <div class="keep-together">
        <h4>Defense-in-Depth Validation</h4>

        <p>
          The guardrails pipeline (schema &rarr; cooldown &rarr; rate limit
          &rarr; circuit breaker &rarr; domain criteria &rarr; tier &rarr;
          execute) is the action-level safety net. Production adds three
          system-level defenses around it:
        </p>

        <div class="compare-grid">
          <div class="compare-col before">
            <div class="compare-header">Proof of Concept</div>
            <ul>
              <li>Single guardrails pipeline per action</li>
              <li>Circuit breaker tracks per-action failures</li>
              <li>Guardrail config mutable at runtime</li>
              <li>All agents share one permission context</li>
            </ul>
          </div>
          <div class="compare-col after">
            <div class="compare-header">Production</div>
            <ul>
              <li><strong>Pre-flight classifier</strong> rejects impossible actions before the pipeline runs</li>
              <li><strong>Denial tracking</strong> detects confused agents: 3+ rejections in one cycle &rarr; agent paused, supervisor notified</li>
              <li><strong>Immutable config</strong>: tier definitions and action registry frozen at shift start</li>
              <li><strong>Cascading rule sources</strong>: operator overrides via Redis flag (e.g., &ldquo;GREEN-only during rush&rdquo;) without code changes</li>
            </ul>
          </div>
        </div>

        <p>
          Denial tracking deserves emphasis. In testing, we observed cycles where
          an agent attempted the same blocked action repeatedly&mdash;each
          rejection counted against the circuit breaker, eventually tripping it
          for <em>all</em> agents, not just the confused one. The production
          system isolates failure tracking per agent instance and pauses the
          offending agent after three consecutive rejections within a single
          cycle, keeping the circuit breaker clean for healthy agents.
        </p>
      </div>

      <div class="keep-together">
        <h4>Tool Concurrency &amp; Deduplication</h4>

        <p>
          When the supervisor investigates a situation, it often queries
          multiple data sources in the same turn: orders, drivers, tickets,
          market state. In the proof of concept, these run sequentially.
          Production partitions tool calls by safety profile and batches
          accordingly:
        </p>

        <div class="layer-stack">
          <div class="layer-label">Agent emits tool calls</div>
          <div class="layer-row">
            <div class="layer-box light"><strong>query_orders</strong><br><span style="font-size:7pt;color:#888">read-only</span></div>
            <div class="layer-box light"><strong>query_drivers</strong><br><span style="font-size:7pt;color:#888">read-only</span></div>
            <div class="layer-box light"><strong>get_market</strong><br><span style="font-size:7pt;color:#888">read-only</span></div>
            <div class="layer-box accent"><strong>execute_action</strong><br><span style="font-size:7pt">write</span></div>
          </div>
          <div class="layer-arrow">&#9660;</div>
          <div class="layer-label">Orchestrator partitions</div>
          <div class="layer-row">
            <div class="layer-box mid" style="flex:3;">
              <strong>Concurrent Batch</strong><br>
              <span style="font-size:7pt;color:#a0967e">Read-only tools run in parallel (max 10). Identical calls within the same turn served from a deduplication cache.</span>
            </div>
            <div class="layer-box dark" style="flex:1;">
              <strong>Serial</strong><br>
              <span style="font-size:7pt;color:#a0967e">Writes run one at a time</span>
            </div>
          </div>
        </div>

        <p>
          Every ontology tool declares its safety profile:
          <strong>isReadOnly</strong>, <strong>isConcurrencySafe</strong>,
          and <strong>isDestructive</strong>. The orchestrator uses these
          flags to make batching decisions automatically&mdash;no manual
          concurrency annotations per agent. This typically saves 2&ndash;4
          seconds per supervisor turn during peak hours when multiple queries
          are needed.
        </p>
      </div>

      <div class="keep-together">
        <h4>Ontology Snapshot Isolation</h4>

        <p>
          The ontology store syncs from the dispatch API every 20 seconds.
          But a dispatch cycle&mdash;especially one with parallel
          sub-agents&mdash;can take 10&ndash;15 seconds to complete. If a
          sync lands mid-cycle, different agents see different world states.
        </p>

        <p>
          Production freezes the ontology at cycle start. All agents in that
          cycle read from the <strong>same snapshot</strong>. The sync
          continues in the background but only promotes to the active snapshot
          between cycles. This guarantees that if the supervisor sees an order
          as unassigned, the driver_comms agent it dispatches sees the same thing.
        </p>
      </div>

      <div class="keep-together">
        <h4>Operator Hook System</h4>

        <p>
          Process files define <em>what agents should do</em>. Hooks define
          <em>what the system should do around agent actions</em>&mdash;without
          code changes.
        </p>

        <table>
          <thead>
            <tr>
              <th>Hook</th>
              <th>Fires When</th>
              <th>Can</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>preAction</strong></td>
              <td>Before guardrails pipeline</td>
              <td>Block action, modify params, inject system message</td>
            </tr>
            <tr>
              <td><strong>postAction</strong></td>
              <td>After execution</td>
              <td>Trigger alert (Slack, PagerDuty), log to external system</td>
            </tr>
            <tr>
              <td><strong>onCycleEnd</strong></td>
              <td>Cycle completes</td>
              <td>Push metrics, trigger dashboard refresh</td>
            </tr>
            <tr>
              <td><strong>onEscalation</strong></td>
              <td>Agent escalates to human</td>
              <td>Route notification, page on-call dispatcher</td>
            </tr>
          </tbody>
        </table>

        <p>
          Hooks are defined in a JSON configuration file alongside the process
          files, not in agent code. An operator can add a
          <code>preAction</code> hook that reads a Redis flag and blocks all
          non-GREEN actions during a delivery rush&mdash;then remove it when
          the rush subsides. The system&rsquo;s behavior changes without a
          restart.
        </p>
      </div>

      <div class="keep-together">
        <h4>Decision Tracing &amp; Observability</h4>

        <p>
          The proof of concept logs <em>what action was taken</em>. Production
          logs the full decision chain: <strong>why the supervisor routed to
          this agent</strong>, what the agent considered before deciding, which
          alternatives it rejected, and what the guardrails checked. Every
          decision point in the pipeline emits a structured trace event.
        </p>

        <div class="layer-stack">
          <div class="layer-row">
            <div class="layer-box dark">
              <strong>Cycle Event Log</strong><br>
              <span style="font-size:7pt;color:#a0967e">In-memory ring buffer (last 200 events). Powers the health endpoint without database queries.</span>
            </div>
          </div>
          <div class="layer-arrow">&#9660;</div>
          <div class="layer-row">
            <div class="layer-box mid">
              <strong>Decision Traces</strong><br>
              <span style="font-size:7pt;color:#a0967e">Supervisor routing reason &bull; Agent reasoning chain &bull; Guardrail check results &bull; Alternatives rejected</span>
            </div>
          </div>
          <div class="layer-arrow">&#9660;</div>
          <div class="layer-row">
            <div class="layer-box light">
              <strong>Structured Error Taxonomy</strong><br>
              <span style="font-size:7pt;color:#666">Every error classified: <em>llm_error</em>, <em>guardrail_rejection</em>, <em>execution_failure</em>, <em>sync_error</em>, <em>auth_error</em>. Each type has its own retry, alert, and escalation behavior.</span>
            </div>
          </div>
        </div>

        <p>
          A startup error queue captures failures during the critical bootstrap
          phase (connections, authentication, first sync). Errors are queued
          in memory and drained once the logging infrastructure initializes&mdash;no
          silent failures during the first 30 seconds of a shift.
        </p>
      </div>

      <div class="callout">
        <p>
          <strong>The design philosophy:</strong> Every production hardening
          measure follows one principle&mdash;the system should degrade
          gracefully, never silently. A lost LLM connection skips background
          health checks but retries the active dispatch. A confused agent is
          paused, not allowed to trip the circuit breaker for everyone.
          Context is compacted before it overflows, not after. The goal is
          an 8-hour shift where the operator dashboard stays green, and the
          only human interventions are the ones the system correctly
          requested.
        </p>
      </div>

      <h3 id="models">AI Models &amp; Infrastructure</h3>

      <p>
        The proof of concept runs on <strong>Gemini 3 Flash</strong> via
        OpenRouter&mdash;a fast, inexpensive cloud model well-suited to
        structured tool calling. At typical dispatch volumes (75 invocations/hour,
        ~2,500 tokens each), cloud API costs are modest:
      </p>

      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Monthly Volume</th>
            <th>Est. Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Single market, Flash-tier only</td>
            <td>~100M tokens</td>
            <td>~$16/mo</td>
          </tr>
          <tr>
            <td>Single market, mixed models (routing + reasoning)</td>
            <td>~100M tokens</td>
            <td>~$170/mo</td>
          </tr>
          <tr>
            <td>10 markets, blended</td>
            <td>~1B tokens</td>
            <td>~$1,700/mo</td>
          </tr>
        </tbody>
      </table>

      <p>
        Cloud APIs are the right choice for initial deployment: zero
        infrastructure, instant scaling, and the ability to swap models as
        the landscape evolves. But as Sisyphus scales to dozens of markets,
        the economics and operational profile of <strong>local inference</strong>
        become compelling.
      </p>

      <div class="keep-together">
        <h4>The Local Inference Path: AMD Halo</h4>

        <p>
          AMD&rsquo;s <strong>Ryzen AI Max</strong> (codenamed &ldquo;Strix
          Halo&rdquo;) represents a step change in local AI capability. The
          key specification: <strong>128 GB of unified memory</strong> shared
          across CPU, GPU, and NPU at <strong>256 GB/s bandwidth</strong>.
          This is enough to load and run a 70B parameter model entirely in
          memory&mdash;something that previously required multi-GPU server
          configurations costing $10,000+.
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Spec</th>
            <th>AMD Ryzen AI Max+ 395</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>CPU</td><td>16 Zen 5 cores / 32 threads</td></tr>
          <tr><td>GPU</td><td>40 RDNA 3.5 CUs (~8.5 TFLOPS)</td></tr>
          <tr><td>NPU</td><td>XDNA 2, 50 TOPS (INT8)</td></tr>
          <tr><td>Unified Memory</td><td>Up to 128 GB shared</td></tr>
          <tr><td>Memory Bandwidth</td><td>256 GB/s (LPDDR5X-8000)</td></tr>
          <tr><td>TDP</td><td>55&ndash;120W configurable</td></tr>
          <tr><td>Est. hardware cost</td><td>$3,000&ndash;$4,500</td></tr>
        </tbody>
      </table>

      <div class="keep-together">
        <h4>Open Source Models for Dispatch</h4>

        <p>
          The dispatch use case requires <strong>structured tool calling</strong>
          &mdash;selecting actions, filling Zod-validated parameters, reasoning
          about entity state&mdash;not creative writing. Several open source models
          now match cloud APIs for this workload:
        </p>

        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Size</th>
              <th>RAM (Q4)</th>
              <th>~tok/s on Halo</th>
              <th>Fit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Qwen 3 32B</strong></td>
              <td>32B</td>
              <td>~18 GB</td>
              <td>~7</td>
              <td>Best balance of speed and tool-calling accuracy</td>
            </tr>
            <tr>
              <td><strong>Llama 4 Scout</strong></td>
              <td>17B active (MoE)</td>
              <td>~30 GB</td>
              <td>~13</td>
              <td>MoE architecture: 109B knowledge, 17B inference cost</td>
            </tr>
            <tr>
              <td><strong>Qwen 3 72B</strong></td>
              <td>72B</td>
              <td>~42 GB</td>
              <td>~3</td>
              <td>Highest quality; fits in 128GB with room for context</td>
            </tr>
            <tr>
              <td><strong>Qwen 3 14B</strong></td>
              <td>14B</td>
              <td>~8 GB</td>
              <td>~16</td>
              <td>Fastest option for high-volume simple routing</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="keep-together">
        <h4>Economics at Scale</h4>

        <p>
          The Halo breakeven depends on market count. A single box running
          Qwen 3 32B can serve multiple markets simultaneously:
        </p>

        <div class="stats">
          <div class="stat-card">
            <div class="stat-value">$7</div>
            <div class="stat-label">Monthly Power Cost</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">5</div>
            <div class="stat-label">Months to Breakeven (5 markets)</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">0</div>
            <div class="stat-label">Marginal Cost Per Extra Run</div>
          </div>
        </div>
      </div>

      <div class="callout">
        <p>
          <strong>The path:</strong> Launch on cloud APIs for speed and flexibility.
          As the system proves itself and market count grows, transition the
          inference layer to a local Halo-class machine running Qwen 3 or
          Llama 4 Scout. The agent architecture, guardrails, and event pipeline
          are model-agnostic&mdash;swapping the inference backend is a
          configuration change, not a rewrite.
        </p>
      </div>
    </div>
  `;
}
