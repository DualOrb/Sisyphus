// scripts/whitepaper/sections/projections.ts

export function projectionsSection(): string {
  return `
    <div class="divider-page">
      <div class="divider-content">
        <div class="divider-num">Section IV</div>
        <div class="divider-title">If It Works</div>
        <div class="divider-rule"></div>
      </div>
    </div>

    <div class="section">
      <div class="section-num">Section IV</div>
      <h2 class="section-title" id="projections">Projections &amp; Predictions</h2>
      <div class="section-rule"></div>

      <p class="lead">
        If shadow testing results translate to production performance, the
        implications extend beyond simple efficiency gains. Sisyphus represents
        a fundamental shift in how regional delivery operations can scale.
      </p>

      <h3 id="impact">Operational Impact</h3>

      <div class="two-col">
        <div>
          <h4>Response Time</h4>
          <p>
            Human dispatchers typically respond to issues within 2&ndash;10 minutes,
            depending on workload. Sisyphus triages and acts within
            <strong>seconds</strong>. For time-sensitive scenarios&mdash;a driver
            who hasn't confirmed a pickup, an order sitting ready with no
            driver&mdash;this difference can prevent cascading delays.
          </p>
        </div>
        <div>
          <h4>Coverage</h4>
          <p>
            A single Sisyphus instance monitors <strong>all markets
            simultaneously</strong>, 24/7. No shift changes, no handoff gaps,
            no fatigue-induced blind spots. Markets that currently go unmonitored
            during off-peak hours get the same level of attention as peak periods.
          </p>
        </div>
      </div>

      <div class="two-col">
        <div>
          <h4>Consistency</h4>
          <p>
            Every decision follows documented procedures loaded from process files.
            The same scenario receives the same treatment regardless of time of day,
            market, or how many other issues are competing for attention.
            Institutional knowledge is codified, not carried in someone's head.
          </p>
        </div>
        <div>
          <h4>Scalability</h4>
          <p>
            Adding a new market requires zero additional dispatch staff. The system
            discovers new markets through the dispatch data and applies the same
            processes. Growth in markets and order volume is decoupled from growth
            in operations headcount.
          </p>
        </div>
      </div>

      <h3 id="financial">Financial Projections</h3>

      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Mechanism</th>
            <th>Expected Impact</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Refund Reduction</strong></td>
            <td>Faster intervention on late orders prevents food quality issues</td>
            <td>15&ndash;30% reduction in late-delivery refunds</td>
          </tr>
          <tr>
            <td><strong>Support Cost</strong></td>
            <td>Automated ticket resolution for routine issues</td>
            <td>40&ndash;60% of tickets resolved without human touch</td>
          </tr>
          <tr>
            <td><strong>Driver Retention</strong></td>
            <td>Proactive communication reduces frustration and churn</td>
            <td>Measurable improvement in driver satisfaction scores</td>
          </tr>
          <tr>
            <td><strong>Dispatch Staffing</strong></td>
            <td>AI handles monitoring; humans handle exceptions</td>
            <td>Dispatch role shifts from reactive to strategic oversight</td>
          </tr>
          <tr>
            <td><strong>Market Expansion</strong></td>
            <td>New markets require no additional dispatch staff</td>
            <td>Near-zero marginal ops cost per new market</td>
          </tr>
        </tbody>
      </table>

      <div class="keep-together">
        <h3 id="industry">Industry Implications</h3>

        <p>
          The food delivery industry has concentrated around a few national platforms
          largely because operations at scale demand operations staff at scale. If
          AI dispatch performs as demonstrated, this assumption breaks down:
        </p>

        <ul>
          <li>
            <strong>Regional operators become viable at scale.</strong> A service
            like ValleyEats can operate across dozens of markets with the same
            operational sophistication as a national platform, without the
            corresponding headcount.
          </li>
          <li>
            <strong>AI dispatch as a service.</strong> The architecture is not
            ValleyEats-specific. The ontology layer, process files, and guardrail
            system could be adapted for any delivery operation, opening the
            possibility of dispatch-as-a-service for small operators.
          </li>
          <li>
            <strong>Human operators are elevated, not replaced.</strong> Dispatchers
            shift from firefighting to oversight&mdash;reviewing staged actions,
            tuning processes, handling the genuinely novel situations that AI
            correctly escalates. The role becomes more strategic and less reactive.
          </li>
        </ul>
      </div>

      <div class="callout">
        <p>
          <strong>The Sisyphus paradox:</strong> The system is named for endless,
          repetitive labor&mdash;but its purpose is to free human operators from
          exactly that. The boulder still needs to be pushed. The question is
          whether a human needs to be the one pushing it.
        </p>
      </div>

      <p>
        The boulder is already moving. Shadow testing against live production
        data has demonstrated that AI can make sound, auditable dispatch
        decisions. The event pipeline design ensures real-time responsiveness.
        The incremental integration plan ensures human operators stay in
        control at every step. And the model-agnostic architecture means the
        system improves as the underlying AI models improve&mdash;without
        rewriting a single line of dispatch logic.
      </p>

      <p>
        Sisyphus is not a bet on a specific model or vendor. It is an
        architecture for bringing autonomous intelligence to operations&mdash;safely,
        incrementally, and with the humans who know the business best
        always in the loop.
      </p>

      <div class="page-foot">
        Project Sisyphus &nbsp;&bull;&nbsp; ValleyEats &nbsp;&bull;&nbsp; April 2026
        &nbsp;&bull;&nbsp; Confidential
      </div>
    </div>
  `;
}
