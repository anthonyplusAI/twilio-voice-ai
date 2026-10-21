export function renderAdminPage(data) {
  const { range, overview, funnel, chapters, audience, calls, agentConfig, pacing, timePerChapter, hourlyActivity, skipAhead, engagement, shares, feedback, recent } = data;
  const rangeLabel = range === 'today' ? 'Today' : 'Current run';
  const completionRate = overview.totalSessions > 0
    ? Math.round((overview.totalCompleted / overview.totalSessions) * 100) : 0;
  const callRate = overview.totalSessions > 0
    ? Math.round((calls.sessionsWithCalls / overview.totalSessions) * 100) : 0;
  const configRate = overview.totalSessions > 0
    ? Math.round((engagement.sessionsWithConfig / overview.totalSessions) * 100) : 0;
  // Share buttons only appear on the completion screen, so use completed
  // sessions as the denominator -- otherwise the percentage looks artificially
  // low just because most sessions haven't reached the sharing surface yet.
  const shareRate = overview.totalCompleted > 0
    ? Math.round((shares.sessionsShared / overview.totalCompleted) * 100) : 0;

  const hourlyMax = Math.max(1, ...hourlyActivity.map(h => h.events));
  const hourlyBars = Array.from({ length: 24 }, (_, i) => {
    const match = hourlyActivity.find(h => h.hour === i);
    return match ? match.events : 0;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workshop Analytics — Voice AI</title>
<style>
:root {
  --navy: #000D25;
  --surface-1: #181D3C;
  --surface-2: #181D3C;
  --surface-3: #222848;
  --border: #181D3C;
  --border-subtle: rgba(255,255,255,0.06);
  --red: #EF223A;
  --red-dim: rgba(239,34,58,0.15);
  --blue: #1866EE;
  --gold: #F4B400;
  --success: #10B981;
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255,255,255,0.88);
  --text-muted: rgba(255,255,255,0.5);
  --font-display: "Twilio Sans Display", system-ui, sans-serif;
  --font-text: "Twilio Sans Text", system-ui, sans-serif;
  --font-mono: "Twilio Sans Mono", ui-monospace, monospace;
}
@font-face { font-family: "Twilio Sans Display"; src: url("/fonts/TwilioSansDisplay-Bold.otf") format("opentype"); font-weight: 700; }
@font-face { font-family: "Twilio Sans Display"; src: url("/fonts/TwilioSansDisplay-Extrabold.otf") format("opentype"); font-weight: 800; }
@font-face { font-family: "Twilio Sans Display"; src: url("/fonts/TwilioSansDisplay-Medium.otf") format("opentype"); font-weight: 500; }
@font-face { font-family: "Twilio Sans Text"; src: url("/fonts/TwilioSansText-Regular.otf") format("opentype"); font-weight: 400; }
@font-face { font-family: "Twilio Sans Text"; src: url("/fonts/TwilioSansText-Medium.otf") format("opentype"); font-weight: 500; }
@font-face { font-family: "Twilio Sans Text"; src: url("/fonts/TwilioSansText-Semibold.otf") format("opentype"); font-weight: 600; }
@font-face { font-family: "Twilio Sans Mono"; src: url("/fonts/TwilioSansMono-Regular.otf") format("opentype"); font-weight: 400; }
@font-face { font-family: "Twilio Sans Mono"; src: url("/fonts/TwilioSansMono-Medium.otf") format("opentype"); font-weight: 500; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font-text); background: var(--navy); color: var(--text-secondary); line-height: 1.5; }
.container { max-width: 1200px; margin: 0 auto; padding: 32px 32px 64px; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; flex-wrap: wrap; gap: 16px; }
.header-left { display: flex; align-items: center; gap: 16px; }
.header-left img { height: 28px; }
.header h1 { font-family: var(--font-display); font-weight: 800; font-size: 22px; color: var(--text-primary); }
.header-meta { font-size: 13px; color: var(--text-muted); display: flex; gap: 16px; align-items: center; }
.header-meta span { display: flex; align-items: center; gap: 4px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block; animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-family: var(--font-display); font-weight: 700; font-size: 13px; text-decoration: none; cursor: pointer; border: none; transition: all 0.15s; }
.btn-red { background: var(--red); color: #fff; }
.btn-red:hover { background: #d91e32; }
.btn-outline { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-subtle); }
.btn-outline:hover { background: var(--surface-3); }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 32px; }
.stat-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; }
.stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.8px; font-family: var(--font-display); font-weight: 500; margin-bottom: 2px; }
.stat-value { font-size: 28px; font-weight: 800; font-family: var(--font-display); color: var(--text-primary); line-height: 1.2; }
.stat-value.accent { color: var(--red); }
.stat-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.section { margin-bottom: 28px; }
.section-title { font-family: var(--font-display); font-weight: 800; font-size: 16px; color: var(--text-primary); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.section-title::before { content: ''; width: 3px; height: 16px; background: var(--red); border-radius: 2px; }
.panel { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
/* Multi-column sections use stretched items so all panels in a row match
   the tallest one, and the column itself is a flex column so the panel can
   grow to fill the leftover space below the .section-title. */
.two-col, .three-col { display: grid; gap: 16px; align-items: stretch; }
.two-col { grid-template-columns: 1fr 1fr; }
.three-col { grid-template-columns: 1fr 1fr 1fr; }
.two-col > div, .three-col > div { display: flex; flex-direction: column; }
.two-col > div > .panel, .three-col > div > .panel { flex: 1; }
@media (max-width: 900px) { .two-col, .three-col { grid-template-columns: 1fr; } }
/* Fixed-height scroll regions for panels that otherwise grow unbounded
   (completion funnel, recent activity, per-chapter times on big workshops). */
.scroll-panel { max-height: 320px; overflow-y: auto; padding-right: 6px; }
.scroll-panel::-webkit-scrollbar { width: 8px; }
.scroll-panel::-webkit-scrollbar-track { background: transparent; }
.scroll-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
.scroll-panel::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
.scroll-table { max-height: 420px; overflow-y: auto; }
.bar-row { display: flex; align-items: center; margin-bottom: 6px; font-size: 13px; }
.bar-label { width: 180px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.bar-track { flex: 1; height: 20px; background: rgba(255,255,255,0.04); border-radius: 4px; margin: 0 10px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; min-width: 2px; transition: width 0.4s ease; }
.bar-fill.red { background: var(--red); }
.bar-fill.blue { background: var(--blue); }
.bar-fill.success { background: var(--success); }
.bar-fill.gold { background: var(--gold); }
.bar-count { width: 44px; text-align: right; flex-shrink: 0; font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
.bar-pct { width: 40px; text-align: right; flex-shrink: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
.kv-list { list-style: none; }
.kv-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
.kv-row:last-child { border-bottom: none; }
.kv-row .label { color: var(--text-secondary); }
.kv-row .value { font-family: var(--font-mono); font-weight: 500; color: var(--text-primary); font-size: 13px; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; font-family: var(--font-display); }
.tag-builder { background: rgba(24,102,238,0.15); color: #60a5fa; }
.tag-explorer { background: rgba(168,85,247,0.15); color: #c084fc; }
.tag-event { background: rgba(255,255,255,0.06); color: var(--text-muted); }
.hourly-chart { display: flex; align-items: flex-end; gap: 3px; height: 80px; padding-top: 8px; }
.hourly-bar { flex: 1; background: var(--red); border-radius: 2px 2px 0 0; min-height: 2px; transition: height 0.3s; position: relative; }
.hourly-bar:hover { opacity: 0.8; }
.hourly-labels { display: flex; gap: 3px; margin-top: 4px; }
.hourly-labels span { flex: 1; text-align: center; font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th { text-align: left; padding: 8px 12px; color: var(--text-muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-subtle); }
tbody td { padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); color: var(--text-secondary); }
tbody tr:hover td { background: rgba(255,255,255,0.02); }
.sub-label { font-size: 11px; color: var(--text-muted); margin-top: 14px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; font-family: var(--font-display); font-weight: 500; }
.empty { color: var(--text-muted); font-size: 13px; font-style: italic; padding: 12px 0; }
.footer { text-align: center; padding: 24px 0 0; color: var(--text-muted); font-size: 11px; border-top: 1px solid var(--border-subtle); margin-top: 16px; }
</style>
</head>
<body>
<div class="container">

<div class="header">
  <div class="header-left">
    <img src="/images/twilio-bug-red.svg" alt="Twilio">
    <h1>Workshop Analytics</h1>
    <div style="display:inline-flex;border:1px solid var(--border-subtle);border-radius:8px;overflow:hidden">
      <a href="/admin?range=today" class="btn ${range === 'today' ? 'btn-red' : 'btn-outline'}" style="border-radius:0;border:0;font-size:12px;padding:6px 12px" title="Show only events from today (server time)">Today</a>
      <a href="/admin?range=all" class="btn ${range === 'all' ? 'btn-red' : 'btn-outline'}" style="border-radius:0;border:0;font-size:12px;padding:6px 12px" title="Show all events in the current analytics run">Current run</a>
    </div>
  </div>
  <div style="display:flex;gap:8px;align-items:center">
    <div class="header-meta">
      <span><span class="dot"></span> ${rangeLabel}</span>
      <span id="lastUpdate"></span>
    </div>
    <a href="/" class="btn btn-outline" title="Back to workshop home">Home</a>
    <button id="resetProgressBtn" class="btn btn-outline" title="Clears this browser's workshop progress (localStorage). Does not affect other attendees or server analytics.">Reset My Progress</button>
    <button id="resetAllBtn" class="btn btn-outline" style="border-color:rgba(239,34,58,0.5);color:#ff8a9a" title="Starts a fresh analytics run. Previous events stay archived in Azure Table storage for recovery.">Start New Run</button>
    <a href="/slides" class="btn btn-outline" title="Open the workshop slide deck. Visiting /admin also enables the presenter-only backslash (\\) shortcut for toggling slides ⇄ workshop anywhere in the app.">View Slides</a>
    <a href="/admin/report?range=${range}" class="btn btn-red">Download PDF Report</a>
  </div>
</div>

<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-label">Total Attendees</div>
    <div class="stat-value">${overview.totalSessions}</div>
    <div class="stat-sub">${overview.sessionsToday} active today</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Completion Rate</div>
    <div class="stat-value accent">${completionRate}%</div>
    <div class="stat-sub">${overview.totalCompleted} finished all chapters</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Builders</div>
    <div class="stat-value">${overview.builders}</div>
    <div class="stat-sub">${overview.totalSessions > 0 ? Math.round(overview.builders / overview.totalSessions * 100) : 0}% of attendees</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Explorers</div>
    <div class="stat-value">${overview.explorers}</div>
    <div class="stat-sub">${overview.totalSessions > 0 ? Math.round(overview.explorers / overview.totalSessions * 100) : 0}% of attendees</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Calls Made</div>
    <div class="stat-value">${calls.totalCalls}</div>
    <div class="stat-sub">${callRate}% of users called</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Avg Session</div>
    <div class="stat-value">${pacing.avgMinutes}<span style="font-size:14px;font-weight:500;color:var(--text-muted)"> min</span></div>
    <div class="stat-sub">median ${pacing.medianMinutes} min</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Steps Completed</div>
    <div class="stat-value">${overview.totalStepCompleted}</div>
    <div class="stat-sub">${overview.totalBadges} badges earned</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Customized Agent</div>
    <div class="stat-value">${configRate}%</div>
    <div class="stat-sub">${engagement.sessionsWithConfig} users configured</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Shares</div>
    <div class="stat-value">${shares.totalShares}</div>
    <div class="stat-sub">${shares.sessionsShared} users${overview.totalCompleted > 0 ? ` · ${shareRate}% of finishers` : ''}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Completion Funnel</div>
  <div class="panel scroll-panel">
    ${funnel.length === 0 ? '<p class="empty">No completion data yet</p>' : funnel.map(row => {
      const pct = overview.totalSessions > 0 ? Math.round((row.sessions / overview.totalSessions) * 100) : 0;
      return `<div class="bar-row">
        <span class="bar-label">${esc(row.chapter)}/${esc(row.step)}</span>
        <div class="bar-track"><div class="bar-fill red" style="width:${pct}%"></div></div>
        <span class="bar-pct">${pct}%</span>
        <span class="bar-count">${row.sessions}</span>
      </div>`;
    }).join('')}
  </div>
</div>

<div class="two-col section">
  <div>
    <div class="section-title">Chapter Completion</div>
    <div class="panel">
      ${chapters.length === 0 ? '<p class="empty">No chapter completions yet</p>' : chapters.map(ch => {
        const pct = overview.totalSessions > 0 ? Math.round((ch.sessions / overview.totalSessions) * 100) : 0;
        return `<div class="bar-row">
          <span class="bar-label">${esc(ch.badgeId)}</span>
          <div class="bar-track"><div class="bar-fill success" style="width:${pct}%"></div></div>
          <span class="bar-pct">${pct}%</span>
          <span class="bar-count">${ch.sessions}</span>
        </div>`;
      }).join('')}
    </div>
  </div>
  <div>
    <div class="section-title">Time per Chapter</div>
    <div class="panel">
      ${timePerChapter.length === 0 ? '<p class="empty">Not enough data yet</p>' : timePerChapter.map(ch => {
        return `<div class="bar-row">
          <span class="bar-label">${esc(ch.chapterSlug)}</span>
          <div class="bar-track"><div class="bar-fill blue" style="width:${Math.min(100, ch.medianMinutes * 3)}%"></div></div>
          <span class="bar-count">${ch.medianMinutes}m</span>
        </div>`;
      }).join('')}
    </div>
  </div>
</div>

${hourlyActivity.length > 0 ? `<div class="section">
  <div class="section-title">Activity by Hour</div>
  <div class="panel">
    <div class="hourly-chart">
      ${hourlyBars.map(v => `<div class="hourly-bar" style="height:${v === 0 ? '0' : Math.max(4, (v / hourlyMax) * 100)}%" title="${v} events"></div>`).join('')}
    </div>
    <div class="hourly-labels">
      ${hourlyBars.map((_, i) => `<span>${i}</span>`).join('')}
    </div>
  </div>
</div>` : ''}

<div class="two-col section">
  <div>
    <div class="section-title">Audience Breakdown</div>
    <div class="panel">
      <ul class="kv-list">
      ${audience.audiences.map(a => `<li class="kv-row">
        <span class="label"><span class="tag tag-${cssClass(a.audience)}">${esc(a.audience)}</span></span>
        <span class="value">${a.sessions}</span>
      </li>`).join('')}
      </ul>
      ${audience.completionByAudience.length > 0 ? `<div class="sub-label">Completed workshop</div><ul class="kv-list">${
        audience.completionByAudience.map(a => `<li class="kv-row">
          <span class="label"><span class="tag tag-${cssClass(a.audience)}">${esc(a.audience)}</span></span>
          <span class="value">${a.completed}</span>
        </li>`).join('')
      }</ul>` : ''}
      ${audience.stepsPerAudience.length > 0 ? `<div class="sub-label">Total step completions</div><ul class="kv-list">${
        audience.stepsPerAudience.map(a => `<li class="kv-row">
          <span class="label"><span class="tag tag-${cssClass(a.audience)}">${esc(a.audience)}</span></span>
          <span class="value">${a.steps}</span>
        </li>`).join('')
      }</ul>` : ''}
    </div>
  </div>
  <div>
    <div class="section-title">Call Analytics</div>
    <div class="panel">
      <ul class="kv-list">
        <li class="kv-row"><span class="label">Total calls</span><span class="value">${calls.totalCalls}</span></li>
        <li class="kv-row"><span class="label">Users who called</span><span class="value">${calls.sessionsWithCalls}</span></li>
        <li class="kv-row"><span class="label">Avg call duration</span><span class="value">${calls.avgCallDuration}s</span></li>
        <li class="kv-row"><span class="label">Median call duration</span><span class="value">${calls.medianCallDuration}s</span></li>
        <li class="kv-row"><span class="label">Longest call</span><span class="value">${calls.longestCall}s</span></li>
        <li class="kv-row"><span class="label">Handoffs triggered</span><span class="value">${calls.handoffs}</span></li>
        <li class="kv-row"><span class="label">Language switches</span><span class="value">${calls.langSwitches}</span></li>
      </ul>
      ${calls.toolUsage.length > 0 ? `<div class="sub-label">Tool usage</div><ul class="kv-list">${
        calls.toolUsage.map(t => `<li class="kv-row"><span class="label">${esc(t.tool)}</span><span class="value">${t.c}</span></li>`).join('')
      }</ul>` : ''}
    </div>
  </div>
</div>

<div class="three-col section">
  <div>
    <div class="section-title">Popular Voices</div>
    <div class="panel">
      ${agentConfig.voices.length === 0 ? '<p class="empty">No voice data</p>' : `<ul class="kv-list">${
        agentConfig.voices.map(v => `<li class="kv-row"><span class="label">${esc(v.voice || '(default)')}</span><span class="value">${v.c}</span></li>`).join('')
      }</ul>`}
    </div>
  </div>
  <div>
    <div class="section-title">Languages</div>
    <div class="panel">
      ${agentConfig.languages.length === 0 ? '<p class="empty">No language data</p>' : `<ul class="kv-list">${
        agentConfig.languages.map(l => `<li class="kv-row"><span class="label">${esc(l.language)}</span><span class="value">${l.c}</span></li>`).join('')
      }</ul>`}
    </div>
  </div>
  <div>
    <div class="section-title">Agent Names</div>
    <div class="panel">
      ${agentConfig.names.length === 0 ? '<p class="empty">No name data</p>' : `<ul class="kv-list">${
        agentConfig.names.slice(0, 10).map(n => `<li class="kv-row"><span class="label">${esc(n.name || '(unnamed)')}</span><span class="value">${n.c}</span></li>`).join('')
      }</ul>`}
    </div>
  </div>
</div>

<div class="two-col section">
  <div>
    <div class="section-title">Pacing</div>
    <div class="panel">
      <ul class="kv-list">
        <li class="kv-row"><span class="label">Median session</span><span class="value">${pacing.medianMinutes} min</span></li>
        <li class="kv-row"><span class="label">Average session</span><span class="value">${pacing.avgMinutes} min</span></li>
        <li class="kv-row"><span class="label">Fastest</span><span class="value">${pacing.fastest} min</span></li>
        <li class="kv-row"><span class="label">Slowest</span><span class="value">${pacing.slowest} min</span></li>
        <li class="kv-row"><span class="label">Sessions tracked</span><span class="value">${pacing.totalSessions}</span></li>
      </ul>
    </div>
  </div>
  <div>
    <div class="section-title">Engagement</div>
    <div class="panel">
      <ul class="kv-list">
        <li class="kv-row"><span class="label">Avg events per user</span><span class="value">${engagement.avgEvents}</span></li>
        <li class="kv-row"><span class="label">Most active user</span><span class="value">${engagement.maxEvents} events</span></li>
        <li class="kv-row"><span class="label">Users who earned badges</span><span class="value">${engagement.sessionsWithBadges}</span></li>
        <li class="kv-row"><span class="label">Progress resets</span><span class="value">${engagement.totalResets}</span></li>
        ${skipAhead.totalSkips > 0 ? `
          <li class="kv-row"><span class="label">Skip-aheads</span><span class="value">${skipAhead.totalSkips}</span></li>
          <li class="kv-row"><span class="label">Users who skipped</span><span class="value">${skipAhead.sessionsSkipped}</span></li>
        ` : ''}
      </ul>
    </div>
  </div>
</div>

<div class="two-col section">
  <div>
    <div class="section-title">Social Shares</div>
    <div class="panel">
      <ul class="kv-list">
        <li class="kv-row"><span class="label">Total share clicks</span><span class="value">${shares.totalShares}</span></li>
        <li class="kv-row"><span class="label">Users who shared</span><span class="value">${shares.sessionsShared}</span></li>
        ${overview.totalCompleted > 0 ? `<li class="kv-row"><span class="label">Share rate (of finishers)</span><span class="value">${shareRate}%</span></li>` : ''}
      </ul>
      ${shares.byPlatform.length > 0 ? `<div class="sub-label">By platform</div>${
        shares.byPlatform.map(p => {
          const max = shares.byPlatform[0].clicks || 1;
          const pct = Math.round((p.clicks / max) * 100);
          return `<div class="bar-row">
            <span class="bar-label">${esc(platformLabel(p.platform))}</span>
            <div class="bar-track"><div class="bar-fill gold" style="width:${pct}%"></div></div>
            <span class="bar-count">${p.clicks}</span>
          </div>`;
        }).join('')
      }` : '<p class="empty">No shares yet</p>'}
    </div>
  </div>
  <div>
    <div class="section-title">Shares by Audience</div>
    <div class="panel">
      ${shares.byAudience.length === 0 ? '<p class="empty">No shares yet</p>' : `<ul class="kv-list">${
        shares.byAudience.map(r => `<li class="kv-row">
          <span class="label"><span class="tag tag-${cssClass(r.audience)}">${esc(r.audience)}</span> ${esc(platformLabel(r.platform))}</span>
          <span class="value">${r.clicks}</span>
        </li>`).join('')
      }</ul>`}
    </div>
  </div>
</div>

<div class="two-col section">
  <div>
    <div class="section-title">Feedback Score</div>
    <div class="panel">
      <ul class="kv-list">
        <li class="kv-row"><span class="label">Responses</span><span class="value">${feedback.total}</span></li>
        <li class="kv-row"><span class="label">Average rating</span><span class="value">${feedback.total > 0 ? `${feedback.avgNps} / 10` : '—'}</span></li>
        <li class="kv-row"><span class="label">NPS score</span><span class="value">${feedback.total > 0 ? feedback.npsScore : '—'}</span></li>
        <li class="kv-row"><span class="label">Promoters (9–10)</span><span class="value">${feedback.promoters}</span></li>
        <li class="kv-row"><span class="label">Passives (7–8)</span><span class="value">${feedback.passives}</span></li>
        <li class="kv-row"><span class="label">Detractors (0–6)</span><span class="value">${feedback.detractors}</span></li>
      </ul>
    </div>
  </div>
  <div>
    <div class="section-title">Recent Comments</div>
    <div class="panel scroll-table" style="max-height:340px;overflow-y:auto">
      ${feedback.items.length === 0 ? '<p class="empty">No feedback yet</p>' : feedback.items.map(item => {
        const headerBits = [
          typeof item.nps === 'number' ? `<span class="value">${item.nps}/10</span>` : '',
          item.name ? `<span class="label">${esc(item.name)}</span>` : '',
          item.email ? `<span class="label" style="font-family:var(--font-mono);font-size:11px">${esc(item.email)}</span>` : '',
        ].filter(Boolean).join(' · ');
        return `<div style="padding:10px 0;border-bottom:1px solid var(--border-subtle)">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:4px">
            <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">${headerBits}</div>
            <span class="label" style="font-size:11px;white-space:nowrap">${esc(item.createdAt)}</span>
          </div>
          ${item.comment ? `<div style="font-size:13px;color:var(--text-secondary);line-height:1.5;white-space:pre-wrap">${esc(item.comment)}</div>` : '<div class="empty" style="font-size:12px">(no comment)</div>'}
        </div>`;
      }).join('')}
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Recent Activity</div>
  <div class="panel scroll-table" style="overflow-x:auto">
    <table>
      <thead><tr><th>Time</th><th>Session</th><th>Event</th><th>Details</th></tr></thead>
      <tbody>
      ${recent.map(r => {
        const payload = r.payload ? tryParse(r.payload) : null;
        const detail = payload ? summarize(r.event_type, payload) : '';
        return `<tr>
          <td style="white-space:nowrap">${esc(r.created_at)}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${esc(r.session_id.slice(0, 8))}</td>
          <td><span class="tag tag-event">${esc(r.event_type)}</span></td>
          <td>${esc(detail)}</td>
        </tr>`;
      }).join('')}
      ${recent.length === 0 ? '<tr><td colspan="4" class="empty">No events recorded yet</td></tr>' : ''}
      </tbody>
    </table>
  </div>
</div>

<div class="footer">
  Auto-refreshes every 30s${overview.firstEvent ? ` &middot; Data since ${esc(overview.firstEvent)}` : ''}
</div>

</div>
<script>
document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
setInterval(() => location.reload(), 30000);

// Opt this browser into presenter mode. SlidesHost reads this flag to enable
// the global "S" shortcut that toggles between /slides and the last workshop
// page. Attendees never visit /admin, so their browsers never get the flag
// and pressing S does nothing. Scoped to this browser only -- clearing
// localStorage (or using a different browser) resets it.
try { localStorage.setItem("workshop-presenter-mode", "1"); } catch (e) {}

// Reset workshop progress for the current browser. This clears the
// localStorage keys the workshop app writes (progress + session-scoped
// skip-ahead unlock) and sessionStorage entries. Server-side analytics are
// untouched -- this is strictly a per-browser nuke for re-running the flow.
//
// NOTE: this block is interpolated inside a template literal in
// renderAdminPage(), so any backslash escapes must be DOUBLED (\\n, not \\n)
// to survive the outer template-literal pass into the emitted HTML.
document.getElementById("resetProgressBtn").addEventListener("click", function () {
  var ok = window.confirm("Reset this browser's workshop progress? This clears completed steps, badges, and celebrations saved in this browser. It does NOT affect other attendees or the analytics shown on this page.");
  if (!ok) return;
  try {
    var removed = [];
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var key = localStorage.key(i);
      if (key && key.indexOf("workshop-") === 0) {
        localStorage.removeItem(key);
        removed.push(key);
      }
    }
    for (var j = sessionStorage.length - 1; j >= 0; j--) {
      var skey = sessionStorage.key(j);
      if (skey && skey.indexOf("workshop-") === 0) {
        sessionStorage.removeItem(skey);
      }
    }
    window.alert("Progress cleared (" + removed.length + " key" + (removed.length === 1 ? "" : "s") + "). Open the workshop in a new tab to start fresh.");
  } catch (err) {
    window.alert("Could not clear storage: " + (err && err.message ? err.message : err));
  }
});

// Start a new analytics generation. Double-confirmed because it hides every
// attendee's session from the current dashboard. Refreshes the page after a
// successful reset so the counters snap to zero without waiting for the 30s
// auto-refresh.
document.getElementById("resetAllBtn").addEventListener("click", function () {
  var first = window.confirm("Start a fresh analytics run? Previous events remain archived for recovery. Do this while the prior workshop is idle; open tabs and returning attendees may still send older queued activity. Ask attendees to reload after a reset.");
  if (!first) return;
  var second = window.prompt("Type RESET to start a new analytics run.");
  if (second !== "RESET") {
    window.alert("Cancelled (confirmation phrase did not match).");
    return;
  }
  fetch("/admin/reset-all", { method: "POST" })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
    .then(function (result) {
      if (result.ok && result.body && result.body.ok) {
        window.alert("Started a new analytics run. " + result.body.removed + " event" + (result.body.removed === 1 ? "" : "s") + " hidden from this dashboard.");
        location.reload();
      } else {
        window.alert("Reset status could not be confirmed. Refresh the dashboard before trying again. " + (result.body && result.body.error ? result.body.error : "Unknown error"));
      }
    })
    .catch(function (err) {
      window.alert("Reset status could not be confirmed. Refresh the dashboard before trying again. " + (err && err.message ? err.message : err));
    });
});
</script>
</body>
</html>`;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cssClass(str) {
  return String(str || '').replace(/[^a-zA-Z0-9-]/g, '');
}

function platformLabel(p) {
  if (p === 'x') return 'X';
  if (p === 'linkedin') return 'LinkedIn';
  return p || '(unknown)';
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function summarize(type, p) {
  switch (type) {
    case 'step_completed': return `${p.chapterSlug}/${p.stepSlug}`;
    case 'step_viewed': return `${p.chapterSlug}/${p.stepSlug}`;
    case 'session_started': return p.audience;
    case 'audience_changed': return `${p.from} \u2192 ${p.to}`;
    case 'call_initiated': return p.agentName || p.callSid?.slice(0, 10) || '';
    case 'agent_configured': return `${p.field}: ${p.value}`;
    case 'badge_earned': return p.badgeId;
    case 'skip_ahead': return `\u2192 ${p.toStep}`;
    case 'tool_used': return p.toolName;
    case 'call_connected': return p.callSid?.slice(0, 10) || '';
    case 'call_ended': return p.durationMs ? `${Math.round(p.durationMs / 1000)}s` : '';
    case 'share_clicked': return platformLabel(p.platform);
    default: return '';
  }
}
