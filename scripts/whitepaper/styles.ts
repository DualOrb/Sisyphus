// scripts/whitepaper/styles.ts
// All CSS for the whitepaper PDF

export function styles(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,600;1,8..60,400&family=Inter:wght@400;500;600&family=Playfair+Display+SC:wght@400;700;900&family=Cinzel+Decorative:wght@400;700;900&display=swap');

    @page { size: letter; margin: 0; }
    @page content { margin: 36px 0; background: #faf8f5; }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Source Serif 4', Georgia, serif;
      font-size: 11pt;
      line-height: 1.75;
      color: #2d2d2d;
      background: #faf8f5;
    }

    /* ── Cover ── */
    .cover {
      width: 100%; height: 100vh;
      position: relative;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      page-break-after: always;
      overflow: hidden;
      background: #0a0c10;
    }
    .cover-img {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover; object-position: center 20%;
      filter: brightness(0.35) contrast(1.1) saturate(0.8);
    }
    .cover-vignette {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.65) 100%);
      z-index: 1;
    }
    .cover-frame {
      position: absolute;
      inset: 28px;
      border: 1px solid rgba(201,169,110,0.25);
      z-index: 2;
    }
    .cover-frame::before,
    .cover-frame::after {
      content: '';
      position: absolute;
      width: 24px; height: 24px;
      border-color: rgba(201,169,110,0.5);
      border-style: solid;
    }
    .cover-frame::before {
      top: -1px; left: -1px;
      border-width: 2px 0 0 2px;
    }
    .cover-frame::after {
      bottom: -1px; right: -1px;
      border-width: 0 2px 2px 0;
    }
    .cover-corner-tr,
    .cover-corner-bl {
      position: absolute;
      width: 24px; height: 24px;
      border-color: rgba(201,169,110,0.5);
      border-style: solid;
      z-index: 2;
    }
    .cover-corner-tr {
      top: 27px; right: 27px;
      border-width: 2px 2px 0 0;
    }
    .cover-corner-bl {
      bottom: 27px; left: 27px;
      border-width: 0 0 2px 2px;
    }
    .cover-content {
      position: relative; z-index: 3;
      text-align: center; padding: 0 80px;
    }
    .cover-label {
      font-family: 'Inter', sans-serif;
      font-size: 8pt; letter-spacing: 8px;
      text-transform: uppercase;
      color: rgba(201,169,110,0.6);
      margin-bottom: 24px;
    }
    .cover-title {
      font-family: 'Cinzel Decorative', 'Playfair Display SC', Georgia, serif;
      font-size: 58pt; font-weight: 900;
      letter-spacing: 8px; color: #c9a96e;
      text-shadow: 0 2px 30px rgba(0,0,0,0.8), 0 0 80px rgba(201,169,110,0.15);
      margin-bottom: 0;
      line-height: 1.1;
    }
    .cover-title-sub {
      font-family: 'Playfair Display SC', 'Cormorant Garamond', Georgia, serif;
      font-size: 44pt; font-weight: 400;
      letter-spacing: 14px; color: #c9a96e;
      text-shadow: 0 2px 30px rgba(0,0,0,0.8);
      margin-top: -2px;
    }
    .cover-ornament {
      margin: 28px auto;
      text-align: center;
      color: rgba(201,169,110,0.45);
      font-size: 14pt;
      letter-spacing: 12px;
    }
    .cover-subtitle {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 14.5pt; font-weight: 400;
      font-style: italic;
      letter-spacing: 1.5px; color: #d4cbb8;
      text-shadow: 0 1px 12px rgba(0,0,0,0.7);
      max-width: 440px; margin: 0 auto;
      line-height: 1.6;
    }
    .cover-meta {
      font-family: 'Inter', sans-serif;
      font-size: 7.5pt; letter-spacing: 6px;
      text-transform: uppercase;
      color: rgba(201,169,110,0.45);
      margin-top: 90px;
    }
    .cover-meta-rule {
      width: 40px; height: 1px;
      background: rgba(201,169,110,0.3);
      margin: 0 12px;
      display: inline-block;
      vertical-align: middle;
    }

    /* ── Epigraph ── */
    .epigraph-page {
      width: 100%; height: 100vh;
      background: #faf8f5;
      display: flex; align-items: center; justify-content: center;
      page-break-after: always;
    }
    .epigraph { max-width: 480px; text-align: center; }
    .epigraph blockquote {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 20pt; font-style: italic;
      color: #1a1f2e; line-height: 1.5;
      margin-bottom: 28px;
    }
    .epigraph cite {
      font-family: 'Inter', sans-serif;
      font-size: 8pt; letter-spacing: 4px;
      text-transform: uppercase; color: #9a9a9a;
      font-style: normal;
    }

    /* ── Content Sections ── */
    .section {
      padding: 72px 80px 48px;
      page-break-before: always;
      background: #faf8f5;
      page: content;
    }
    .section-num {
      font-family: 'Inter', sans-serif;
      font-size: 8pt; letter-spacing: 5px;
      text-transform: uppercase; color: #c9a96e;
      margin-bottom: 6px;
    }
    .section-title {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 30pt; font-weight: 700;
      color: #1a1f2e; line-height: 1.15;
      margin-bottom: 6px;
    }
    .section-rule {
      width: 50px; height: 2px;
      background: #c9a96e;
      margin: 20px 0 32px;
    }

    /* ── Page-break safety ── */
    h3 {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 16pt; font-weight: 600;
      color: #1a1f2e;
      margin: 32px 0 12px;
      page-break-after: avoid;
    }
    h4 {
      font-family: 'Inter', sans-serif;
      font-size: 10pt; font-weight: 600;
      color: #1a1f2e; letter-spacing: 0.5px;
      margin: 24px 0 8px;
      page-break-after: avoid;
    }
    .callout { page-break-inside: avoid; }
    .two-col { page-break-inside: avoid; }
    .keep-together { page-break-inside: avoid; }

    p { margin-bottom: 14px; }

    strong { font-weight: 600; color: #1a1f2e; }

    .lead {
      font-size: 12.5pt; line-height: 1.65;
      color: #3d3d3d;
      margin-bottom: 20px;
    }

    /* ── Callout ── */
    .callout {
      border-left: 3px solid #c9a96e;
      padding: 14px 20px; margin: 20px 0;
      background: #f0ece4; border-radius: 0 4px 4px 0;
    }
    .callout p { margin-bottom: 0; font-size: 10.5pt; }
    .callout strong { color: #8a6d2b; }

    /* ── Architecture Diagram ── */
    .arch { margin: 28px 0; page-break-inside: avoid; }
    .arch-row {
      display: flex; justify-content: center;
      gap: 12px; margin-bottom: 8px;
    }
    .arch-box {
      border: 2px solid #1a1f2e; border-radius: 4px;
      padding: 12px 20px; text-align: center;
      font-family: 'Inter', sans-serif; font-size: 9pt;
    }
    .arch-supervisor {
      background: #1a1f2e; color: #c9a96e;
      font-weight: 600; font-size: 10pt;
      min-width: 360px;
    }
    .arch-agent { background: #f0ece4; color: #1a1f2e; min-width: 140px; }
    .arch-arrows {
      text-align: center;
      font-family: 'Inter', sans-serif;
      color: #1a1f2e; font-size: 14pt;
      letter-spacing: 40px; margin: 4px 0;
    }
    .arch-label {
      font-family: 'Inter', sans-serif;
      font-size: 7.5pt; color: #8a8a8a;
      text-align: center; margin-top: 4px;
    }

    /* ── AWS Pipeline Diagram ── */
    .aws-flow { margin: 24px 0; page-break-inside: avoid; }
    .aws-step {
      display: flex; align-items: center;
      margin-bottom: 4px;
    }
    .aws-box {
      display: flex; align-items: center; gap: 12px;
      font-family: 'Inter', sans-serif;
      font-size: 9pt; font-weight: 500;
      padding: 10px 16px; border-radius: 6px;
      min-width: 300px;
    }
    .aws-box img { width: 32px; height: 32px; flex-shrink: 0; }
    .aws-box.primary { background: #1a1f2e; color: #c9a96e; }
    .aws-box.primary strong { color: #f5f0e8; }
    .aws-box.secondary { background: #f0ece4; color: #1a1f2e; }
    .aws-desc {
      font-family: 'Inter', sans-serif;
      font-size: 7.5pt; color: #666;
      margin-left: 16px; line-height: 1.4;
    }
    .aws-arrow {
      font-family: 'Inter', sans-serif;
      font-size: 10pt; color: #c9a96e;
      padding-left: 140px; margin: 2px 0;
    }

    /* ── Tier Badges ── */
    .tier {
      display: inline-block; padding: 1px 10px;
      border-radius: 10px; font-family: 'Inter', sans-serif;
      font-size: 7.5pt; font-weight: 600;
      letter-spacing: 0.8px; text-transform: uppercase;
      vertical-align: middle;
    }
    .tier-green  { background: #d4edda; color: #155724; }
    .tier-yellow { background: #fff3cd; color: #856404; }
    .tier-orange { background: #ffe0cc; color: #a84300; }
    .tier-red    { background: #f8d7da; color: #721c24; }

    /* ── Tables ── */
    table {
      width: 100%; border-collapse: collapse;
      margin: 20px 0; font-size: 9.5pt;
      page-break-inside: avoid;
    }
    th {
      background: #1a1f2e; color: #c9a96e;
      font-family: 'Inter', sans-serif; font-weight: 600;
      text-align: left; padding: 8px 14px;
      font-size: 7.5pt; letter-spacing: 1px;
      text-transform: uppercase;
    }
    td {
      padding: 8px 14px;
      border-bottom: 1px solid #e8e0d4;
    }
    tr:nth-child(even) td { background: #f5f0e8; }

    /* ── Pipeline ── */
    .pipeline {
      display: flex; flex-wrap: wrap;
      gap: 0; margin: 20px 0;
      page-break-inside: avoid;
    }
    .pipeline-step {
      flex: 1; min-width: 90px;
      padding: 8px 6px; text-align: center;
      font-family: 'Inter', sans-serif;
      font-size: 7.5pt; font-weight: 500;
      background: #f0ece4; color: #1a1f2e;
      border-right: 2px solid #faf8f5;
      position: relative;
    }
    .pipeline-step:first-child { border-radius: 4px 0 0 4px; }
    .pipeline-step:last-child { border-radius: 0 4px 4px 0; border-right: none; }
    .pipeline-step.active { background: #1a1f2e; color: #c9a96e; }

    /* ── Log Block ── */
    .log {
      background: #1a1f2e; color: #a8c4a0;
      padding: 16px 20px; border-radius: 4px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 8pt; line-height: 1.6;
      margin: 20px 0; overflow: hidden;
      page-break-inside: avoid;
    }
    .log .time { color: #6a8a6a; }
    .log .agent { color: #c9a96e; }
    .log .action { color: #7ab8d4; }
    .log .ok { color: #8cc88c; }
    .log .route { color: #d4a07a; }

    /* ── Stats Grid ── */
    .stats {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 16px; margin: 24px 0;
      page-break-inside: avoid;
    }
    .stat-card {
      background: #f0ece4; border-radius: 4px;
      padding: 16px 20px; text-align: center;
    }
    .stat-value {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 28pt; font-weight: 700;
      color: #1a1f2e;
    }
    .stat-label {
      font-family: 'Inter', sans-serif;
      font-size: 7.5pt; letter-spacing: 1.5px;
      text-transform: uppercase; color: #8a8a8a;
      margin-top: 4px;
    }

    /* ── Columns ── */
    .two-col {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 28px; margin: 16px 0;
    }

    /* ── Lists ── */
    ul, ol {
      margin: 0 0 14px 20px;
    }
    li { margin-bottom: 6px; }

    /* ── Layered Diagram ── */
    .layer-stack {
      margin: 24px 0; page-break-inside: avoid;
      font-family: 'Inter', sans-serif; font-size: 8.5pt;
    }
    .layer-row {
      display: flex; gap: 0; margin-bottom: 3px;
    }
    .layer-box {
      flex: 1; padding: 10px 14px; text-align: center;
      border-right: 2px solid #faf8f5; line-height: 1.35;
    }
    .layer-box:last-child { border-right: none; }
    .layer-box.dark { background: #1a1f2e; color: #c9a96e; }
    .layer-box.dark strong { color: #f5f0e8; }
    .layer-box.mid { background: #3a3530; color: #e8e0d4; }
    .layer-box.mid strong { color: #c9a96e; }
    .layer-box.light { background: #f0ece4; color: #1a1f2e; }
    .layer-box.accent { background: #c9a96e; color: #1a1f2e; }
    .layer-box.accent strong { color: #1a1f2e; }
    .layer-label {
      font-size: 7pt; color: #888; text-align: center;
      margin: 6px 0 2px; letter-spacing: 2px; text-transform: uppercase;
    }
    .layer-arrow {
      text-align: center; color: #c9a96e;
      font-size: 10pt; margin: 2px 0;
    }

    /* ── Comparison Box ── */
    .compare-grid {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 0; margin: 20px 0; page-break-inside: avoid;
      border: 1px solid #d0ccc4; border-radius: 6px; overflow: hidden;
    }
    .compare-col { padding: 16px 20px; }
    .compare-col.before { background: #f5f0e8; }
    .compare-col.after { background: #1a1f2e; color: #d4d4d4; }
    .compare-col.after strong { color: #c9a96e; }
    .compare-header {
      font-family: 'Inter', sans-serif;
      font-size: 7pt; letter-spacing: 2px;
      text-transform: uppercase; margin-bottom: 10px;
      padding-bottom: 6px; border-bottom: 1px solid rgba(128,128,128,0.3);
    }
    .compare-col.before .compare-header { color: #8a8a8a; }
    .compare-col.after .compare-header { color: #c9a96e; }
    .compare-col ul { margin: 0; padding-left: 16px; }
    .compare-col li { margin-bottom: 6px; font-size: 9pt; line-height: 1.5; }

    /* ── Section Divider Page ── */
    .divider-page {
      width: 100%; height: 100vh;
      background: #1a1f2e;
      display: flex; align-items: center; justify-content: center;
      page-break-after: always; page-break-before: always;
      text-align: center;
    }
    .divider-content {}
    .divider-num {
      font-family: 'Inter', sans-serif;
      font-size: 8pt; letter-spacing: 5px;
      text-transform: uppercase; color: #c9a96e;
      margin-bottom: 12px;
    }
    .divider-title {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 36pt; font-weight: 700;
      color: #f5f0e8; letter-spacing: 3px;
    }
    .divider-rule {
      width: 50px; height: 2px;
      background: #c9a96e; margin: 20px auto 0;
      opacity: 0.5;
    }

    /* ── Timeline Block ── */
    .timeline-block {
      background: #1a1f2e; color: #a8c4a0;
      padding: 16px 20px; border-radius: 4px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 8pt; line-height: 1.7;
      margin: 20px 0; overflow: hidden;
      page-break-inside: avoid;
    }
    .timeline-block .entity { color: #c9a96e; font-weight: 600; }
    .timeline-block .ts { color: #6a8a6a; }
    .timeline-block .change { color: #7ab8d4; }

    /* ── Footer ── */
    .page-foot {
      font-family: 'Inter', sans-serif;
      font-size: 7pt; color: #b0a898;
      text-align: center;
      padding: 24px 0 0;
      margin-top: 40px;
      border-top: 1px solid #e8e0d4;
    }
  `;
}
