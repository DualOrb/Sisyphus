// scripts/whitepaper/sections/challenge.ts

export function challengeSection(): string {
  return `
    <div class="section">
      <div class="section-num">Section I</div>
      <h2 class="section-title" id="challenge">The Challenge</h2>
      <div class="section-rule"></div>

      <p class="lead">
        Food delivery dispatch sits at the intersection of chaos and precision.
        Every shift, dispatchers must coordinate dozens of drivers across multiple
        markets, managing a constant stream of orders, delays, no-shows, and
        customer complaints&mdash;all in real time, all with consequences measured
        in minutes.
      </p>

      <p>
        The economics of food delivery are unforgiving. A single late order cascades:
        cold food triggers a refund, the refund erodes margin, the negative review
        suppresses future orders, and the driver who waited too long at the restaurant
        is now behind on their next pickup. Every minute of dispatcher inattention
        compounds across the system.
      </p>

      <p>
        The numbers are relentless. On any given shift, a dispatcher may be
        tracking 30+ active orders, coordinating with a dozen or more drivers,
        monitoring restaurant readiness across multiple towns, and fielding
        incoming support tickets&mdash;all simultaneously, all with customer
        expectations measured in minutes, not hours.
      </p>

      <h3 id="bottleneck">The Human Bottleneck</h3>

      <p>
        Human dispatchers are skilled but finite. During peak hours, a single
        dispatcher may be responsible for 30&ndash;50 active orders across
        a dozen markets. The cognitive load is immense: triaging which late order
        needs attention first, deciding whether to reassign an order or wait for a
        delayed driver, messaging drivers without overwhelming them, resolving
        customer complaints before they escalate to chargebacks.
      </p>

      <p>
        The failure modes are predictable:
      </p>

      <ul>
        <li><strong>Attention saturation</strong> &mdash; critical issues are missed while resolving less urgent ones</li>
        <li><strong>Inconsistent decisions</strong> &mdash; the same scenario gets different treatment depending on who's on shift</li>
        <li><strong>Slow escalation</strong> &mdash; problems that need immediate intervention wait in a queue</li>
        <li><strong>Knowledge loss</strong> &mdash; institutional knowledge walks out the door with every employee departure</li>
        <li><strong>Coverage gaps</strong> &mdash; nights, weekends, and holidays leave markets understaffed or unmonitored</li>
      </ul>

      <div class="keep-together">
        <h3 id="dilemma">The Regional Operator&rsquo;s Dilemma</h3>

        <p>
          For a regional food delivery service like ValleyEats, operating across
          dozens of small-to-mid-size markets in Ontario and Alberta, these
          challenges are amplified. Unlike urban platforms with massive driver pools
          and dedicated operations teams, each market may have only a handful of
          drivers. A single no-show can leave an entire town without coverage.
          Every decision carries more weight. Every mistake costs more.
        </p>
      </div>

      <div class="callout">
        <p>
          <strong>The core tension:</strong> regional operators need the same
          operational sophistication as national platforms, but can't justify
          the same headcount. The dispatcher-to-market ratio is unsustainable
          at scale.
        </p>
      </div>

      <p>
        The question isn't whether to bring intelligence to dispatch&mdash;it's
        how to do it without introducing new failure modes that are harder to
        detect and more expensive to fix than the human errors they replace.
      </p>
    </div>
  `;
}
