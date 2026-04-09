// scripts/whitepaper/sections/cover.ts

export function coverPage(coverImgSrc: string | null): string {
  const imgTag = coverImgSrc
    ? `<img class="cover-img" src="${coverImgSrc}" alt="">`
    : '';
  return `
    <div class="cover">
      ${imgTag}
      <div class="cover-vignette"></div>
      <div class="cover-frame"></div>
      <div class="cover-corner-tr"></div>
      <div class="cover-corner-bl"></div>
      <div class="cover-content">
        <div class="cover-label">Whitepaper</div>
        <h1 class="cover-title">Project</h1>
        <div class="cover-title-sub">Sisyphus</div>
        <div class="cover-ornament">&mdash;&nbsp; &diams; &nbsp;&mdash;</div>
        <p class="cover-subtitle">
          Autonomous AI Dispatch<br>for Food Delivery Operations
        </p>
        <p class="cover-meta">
          <span class="cover-meta-rule"></span>
          ValleyEats &nbsp;&bull;&nbsp; April 2026
          <span class="cover-meta-rule"></span>
        </p>
      </div>
    </div>
  `;
}
