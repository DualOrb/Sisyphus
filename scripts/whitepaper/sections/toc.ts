// scripts/whitepaper/sections/toc.ts

export function tocPage(): string {
  return `
    <div class="section" style="page:auto;">
      <div class="section-num">Contents</div>
      <h2 class="section-title">Table of Contents</h2>
      <div class="section-rule"></div>

      <div style="font-family:'Source Serif 4',Georgia,serif;font-size:11pt;line-height:2.4;">

        <div style="display:flex;justify-content:space-between;border-bottom:1px dotted #d0ccc4;padding-bottom:2px;">
          <a href="#challenge" style="color:#1a1f2e;text-decoration:none;font-weight:600;">I. The Challenge</a>
        </div>
        <div style="padding-left:20px;font-size:9.5pt;color:#666;line-height:1.8;">
          <a href="#bottleneck" style="color:#666;text-decoration:none;">The Human Bottleneck</a> &nbsp;&bull;&nbsp; <a href="#dilemma" style="color:#666;text-decoration:none;">The Regional Operator&rsquo;s Dilemma</a>
        </div>

        <div style="display:flex;justify-content:space-between;border-bottom:1px dotted #d0ccc4;padding-bottom:2px;margin-top:12px;">
          <a href="#poc" style="color:#1a1f2e;text-decoration:none;font-weight:600;">II. Proof of Concept</a>
        </div>
        <div style="padding-left:20px;font-size:9.5pt;color:#666;line-height:1.8;">
          <a href="#arch" style="color:#666;text-decoration:none;">Multi-Agent Architecture</a> &nbsp;&bull;&nbsp; <a href="#cycle" style="color:#666;text-decoration:none;">The Cycle</a> &nbsp;&bull;&nbsp; <a href="#guardrails" style="color:#666;text-decoration:none;">Guardrails &amp; Autonomy Tiers</a><br>
          <a href="#memory" style="color:#666;text-decoration:none;">Institutional Memory</a> &nbsp;&bull;&nbsp; <a href="#shadow" style="color:#666;text-decoration:none;">Shadow Testing</a> &nbsp;&bull;&nbsp; <a href="#sample" style="color:#666;text-decoration:none;">Sample Cycle</a>
        </div>

        <div style="display:flex;justify-content:space-between;border-bottom:1px dotted #d0ccc4;padding-bottom:2px;margin-top:12px;">
          <a href="#proposal" style="color:#1a1f2e;text-decoration:none;font-weight:600;">III. The Proposal</a>
        </div>
        <div style="padding-left:20px;font-size:9.5pt;color:#666;line-height:1.8;">
          <a href="#pipeline" style="color:#666;text-decoration:none;">Unified Event Pipeline</a> &nbsp;&bull;&nbsp; <a href="#detection" style="color:#666;text-decoration:none;">Algorithm-Driven Detection</a> &nbsp;&bull;&nbsp; <a href="#cycleproc" style="color:#666;text-decoration:none;">The Cycle Processor</a><br>
          <a href="#agents" style="color:#666;text-decoration:none;">Event-Driven Agent Architecture</a> &nbsp;&bull;&nbsp; <a href="#reasoning" style="color:#666;text-decoration:none;">AI Reasoning Trail &amp; Shared Memory</a><br>
          <a href="#oversight" style="color:#666;text-decoration:none;">Human Oversight</a> &nbsp;&bull;&nbsp; <a href="#dashboard" style="color:#666;text-decoration:none;">The Operator Dashboard</a> &nbsp;&bull;&nbsp; <a href="#integration" style="color:#666;text-decoration:none;">Incremental Integration Plan</a><br>
          <a href="#hardening" style="color:#666;text-decoration:none;">Production Hardening</a> &nbsp;&bull;&nbsp; <a href="#models" style="color:#666;text-decoration:none;">AI Models &amp; Infrastructure</a>
        </div>

        <div style="display:flex;justify-content:space-between;border-bottom:1px dotted #d0ccc4;padding-bottom:2px;margin-top:12px;">
          <a href="#projections" style="color:#1a1f2e;text-decoration:none;font-weight:600;">IV. Projections &amp; Predictions</a>
        </div>
        <div style="padding-left:20px;font-size:9.5pt;color:#666;line-height:1.8;">
          <a href="#impact" style="color:#666;text-decoration:none;">Operational Impact</a> &nbsp;&bull;&nbsp; <a href="#financial" style="color:#666;text-decoration:none;">Financial Projections</a> &nbsp;&bull;&nbsp; <a href="#industry" style="color:#666;text-decoration:none;">Industry Implications</a>
        </div>

      </div>
    </div>
  `;
}
