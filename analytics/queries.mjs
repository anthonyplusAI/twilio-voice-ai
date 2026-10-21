import { getDb } from "./db.mjs";

const stmtCache = new Map();

// These events identify a workshop browser session. Hosted voice telemetry uses
// a Twilio Call SID as session_id, so counting every distinct session_id would
// count one Explorer and their phone call as two attendees. Progress and call
// initiation also qualify because an open browser tab can keep emitting after
// the organizer starts a new run and archives its earlier session_started.
// Feedback is omitted: the public feedback endpoint also accepts "anonymous".
const browserEventTypesSQL = `(
  'session_started', 'audience_changed', 'step_viewed', 'step_completed',
  'badge_earned', 'agent_configured', 'skip_ahead', 'share_clicked',
  'progress_reset', 'call_initiated'
)`;

function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

// `range` is 'today' or 'all'. Returns a SQL fragment ready to append to a
// WHERE clause. Empty string for 'all' so the queries stay readable.
function dateClause(range) {
  return range === 'today'
    ? `AND created_at >= datetime('now', 'start of day')`
    : '';
}

// Same idea but emits a leading WHERE when there's no existing WHERE in the
// host query (used by the few queries that don't already filter on event_type).
function leadingDateClause(range) {
  return range === 'today'
    ? `WHERE created_at >= datetime('now', 'start of day')`
    : '';
}

// Each session's "current" audience = the `to` of its latest audience_changed,
// otherwise the `audience` from session_started. Computed once and reused so
// the overview numbers match the audience-breakdown panel (otherwise switching
// from builder to explorer left both counters stale/doubled).
function currentAudienceSQL(range) {
  const dc = dateClause(range);
  // The outer GROUP BY only sees browser sessions active in the range; the
  // inner subqueries then look up audience info across all time so a session
  // that started outside the range keeps its selected audience.
  return `
    WITH session_audience AS (
      SELECT
        session_id,
        COALESCE(
          (
            SELECT json_extract(payload, '$.to')
            FROM events e2
            WHERE e2.session_id = e1.session_id AND e2.event_type = 'audience_changed'
            ORDER BY e2.id DESC LIMIT 1
          ),
          (
            SELECT json_extract(payload, '$.audience')
            FROM events e3
            WHERE e3.session_id = e1.session_id AND e3.event_type = 'session_started'
            ORDER BY e3.id ASC LIMIT 1
          )
        ) AS audience
      FROM events e1
      WHERE event_type IN ${browserEventTypesSQL} ${dc}
      GROUP BY session_id
    )
  `;
}

export function getOverview(range = 'all') {
  const dc = dateClause(range);
  const ldc = leadingDateClause(range);
  const audSql = currentAudienceSQL(range);

  const totalSessions = stmt(`SELECT COUNT(DISTINCT session_id) AS c FROM events WHERE event_type IN ${browserEventTypesSQL} ${dc}`).get().c;
  const sessionsToday = stmt(`SELECT COUNT(DISTINCT session_id) AS c FROM events WHERE event_type IN ${browserEventTypesSQL} AND created_at >= datetime('now', 'start of day')`).get().c;
  const builders = stmt(`${audSql} SELECT COUNT(*) AS c FROM session_audience WHERE audience = 'builder'`).get().c;
  const explorers = stmt(`${audSql} SELECT COUNT(*) AS c FROM session_audience WHERE audience = 'explorer'`).get().c;
  const totalCalls = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'call_initiated' ${dc}`).get().c;
  const totalCompleted = stmt(`
    SELECT COUNT(DISTINCT session_id) AS c FROM events
    WHERE event_type = 'badge_earned' AND json_extract(payload, '$.badgeId') = 'chapter-6' ${dc}
  `).get().c;
  const totalStepCompleted = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'step_completed' ${dc}`).get().c;
  const totalBadges = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'badge_earned' ${dc}`).get().c;
  const firstEvent = stmt(`SELECT MIN(created_at) AS t FROM events ${ldc}`).get().t;
  const lastEvent = stmt(`SELECT MAX(created_at) AS t FROM events ${ldc}`).get().t;
  return { totalSessions, sessionsToday, builders, explorers, totalCalls, totalCompleted, totalStepCompleted, totalBadges, firstEvent, lastEvent };
}

export function getCompletionFunnel(range = 'all') {
  const dc = dateClause(range);
  return stmt(`
    SELECT json_extract(payload, '$.chapterSlug') AS chapter,
           json_extract(payload, '$.stepSlug') AS step,
           json_extract(payload, '$.chapterId') AS chapterId,
           json_extract(payload, '$.stepId') AS stepId,
           COUNT(DISTINCT session_id) AS sessions
    FROM events
    WHERE event_type = 'step_completed' ${dc}
    GROUP BY chapterId, stepId
    ORDER BY CAST(chapterId AS INTEGER), CAST(stepId AS INTEGER)
  `).all();
}

export function getChapterCompletion(range = 'all') {
  const dc = dateClause(range);
  return stmt(`
    SELECT json_extract(payload, '$.badgeId') AS badgeId,
           COUNT(DISTINCT session_id) AS sessions
    FROM events
    WHERE event_type = 'badge_earned' ${dc}
    GROUP BY badgeId
    ORDER BY badgeId
  `).all();
}

export function getAudienceBreakdown(range = 'all') {
  const dc = dateClause(range);
  const audSql = currentAudienceSQL(range);

  const audiences = stmt(`
    ${audSql}
    SELECT audience, COUNT(*) AS sessions
    FROM session_audience
    WHERE audience IS NOT NULL
    GROUP BY audience
  `).all();

  const completionByAudience = stmt(`
    ${audSql}
    SELECT sa.audience, COUNT(DISTINCT e2.session_id) AS completed
    FROM session_audience sa
    JOIN events e2 ON sa.session_id = e2.session_id
      AND e2.event_type = 'badge_earned'
      AND json_extract(e2.payload, '$.badgeId') = 'chapter-6' ${dc}
    WHERE sa.audience IS NOT NULL
    GROUP BY sa.audience
  `).all();

  const stepsPerAudience = stmt(`
    ${audSql}
    SELECT sa.audience,
           COUNT(DISTINCT e2.session_id || ':' || json_extract(e2.payload, '$.chapterId') || ':' || json_extract(e2.payload, '$.stepId')) AS steps
    FROM session_audience sa
    JOIN events e2 ON sa.session_id = e2.session_id AND e2.event_type = 'step_completed' ${dc}
    WHERE sa.audience IS NOT NULL
    GROUP BY sa.audience
  `).all();

  return { audiences, completionByAudience, stepsPerAudience };
}

export function getCallStats(range = 'all') {
  const dc = dateClause(range);

  const totalCalls = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'call_initiated' ${dc}`).get().c;
  const sessionsWithCalls = stmt(`SELECT COUNT(DISTINCT session_id) AS c FROM events WHERE event_type = 'call_initiated' ${dc}`).get().c;
  const toolUsage = stmt(`
    SELECT json_extract(payload, '$.toolName') AS tool, COUNT(*) AS c
    FROM events WHERE event_type = 'tool_used' ${dc}
    GROUP BY tool ORDER BY c DESC
  `).all();
  const handoffs = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'handoff_triggered' ${dc}`).get().c;
  const langSwitches = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'language_switched' ${dc}`).get().c;

  const callDurations = stmt(`
    SELECT json_extract(payload, '$.durationMs') AS ms
    FROM events WHERE event_type = 'call_ended' AND json_extract(payload, '$.durationMs') > 0 ${dc}
    ORDER BY ms
  `).all().map(r => r.ms);

  const avgCallDuration = callDurations.length > 0
    ? Math.round(callDurations.reduce((s, v) => s + v, 0) / callDurations.length / 1000)
    : 0;
  const n = callDurations.length;
  const medianCallDuration = n === 0 ? 0
    : n % 2 === 1 ? Math.round(callDurations[Math.floor(n / 2)] / 1000)
    : Math.round((callDurations[n / 2 - 1] + callDurations[n / 2]) / 2000);
  const longestCall = n > 0 ? Math.round(callDurations[n - 1] / 1000) : 0;

  return { totalCalls, sessionsWithCalls, toolUsage, handoffs, langSwitches, avgCallDuration, medianCallDuration, longestCall };
}

export function getAgentConfig(range = 'all') {
  const dc = dateClause(range);
  const voices = stmt(`
    SELECT json_extract(payload, '$.value') AS voice, COUNT(*) AS c
    FROM events
    WHERE event_type = 'agent_configured' AND json_extract(payload, '$.field') = 'voiceLabel' ${dc}
    GROUP BY voice ORDER BY c DESC LIMIT 10
  `).all();
  const languages = stmt(`
    SELECT json_extract(payload, '$.value') AS language, COUNT(*) AS c
    FROM events
    WHERE event_type = 'agent_configured' AND json_extract(payload, '$.field') = 'language' ${dc}
    GROUP BY language ORDER BY c DESC LIMIT 10
  `).all();
  const names = stmt(`
    SELECT json_extract(payload, '$.value') AS name, COUNT(*) AS c
    FROM events
    WHERE event_type = 'agent_configured' AND json_extract(payload, '$.field') = 'agentName' ${dc}
    GROUP BY name ORDER BY c DESC LIMIT 20
  `).all();
  const ttsProviders = stmt(`
    SELECT json_extract(payload, '$.value') AS provider, COUNT(*) AS c
    FROM events
    WHERE event_type = 'agent_configured' AND json_extract(payload, '$.field') = 'ttsProvider' ${dc}
    GROUP BY provider ORDER BY c DESC LIMIT 10
  `).all();
  return { voices, languages, names, ttsProviders };
}

export function getPacing(range = 'all') {
  const dc = dateClause(range);
  const sessionDurations = stmt(`
    SELECT session_id,
           MIN(created_at) AS first_event,
           MAX(created_at) AS last_event,
           CAST((julianday(MAX(created_at)) - julianday(MIN(created_at))) * 1440 AS INTEGER) AS minutes
    FROM events
    WHERE event_type IN ${browserEventTypesSQL} ${dc}
    GROUP BY session_id
    HAVING COUNT(*) > 1
    ORDER BY minutes
  `).all();

  const n = sessionDurations.length;
  const medianMinutes = n === 0 ? 0
    : n % 2 === 1 ? sessionDurations[Math.floor(n / 2)].minutes
    : Math.round((sessionDurations[n / 2 - 1].minutes + sessionDurations[n / 2].minutes) / 2);
  const avgMinutes = n > 0
    ? Math.round(sessionDurations.reduce((s, r) => s + r.minutes, 0) / n)
    : 0;
  const fastest = n > 0 ? sessionDurations[0].minutes : 0;
  const slowest = n > 0 ? sessionDurations[n - 1].minutes : 0;

  return { medianMinutes, avgMinutes, fastest, slowest, totalSessions: n };
}

export function getTimePerChapter(range = 'all') {
  const dc = dateClause(range);
  const rows = stmt(`
    SELECT
      json_extract(e.payload, '$.chapterId') AS chapterId,
      json_extract(e.payload, '$.chapterSlug') AS chapterSlug,
      e.session_id,
      MIN(e.created_at) AS first_step,
      MAX(e.created_at) AS last_step,
      CAST((julianday(MAX(e.created_at)) - julianday(MIN(e.created_at))) * 1440 AS INTEGER) AS minutes
    FROM events e
    WHERE e.event_type IN ('step_completed', 'step_viewed') ${dc}
    GROUP BY e.session_id, chapterId
    HAVING COUNT(DISTINCT json_extract(e.payload, '$.stepId')) > 1
    ORDER BY CAST(chapterId AS INTEGER)
  `).all();

  const byChapter = {};
  for (const r of rows) {
    const key = r.chapterId;
    if (!byChapter[key]) byChapter[key] = { chapterId: r.chapterId, chapterSlug: r.chapterSlug, durations: [] };
    byChapter[key].durations.push(r.minutes);
  }

  return Object.values(byChapter).map(ch => {
    const d = ch.durations.sort((a, b) => a - b);
    const n = d.length;
    const median = n === 0 ? 0
      : n % 2 === 1 ? d[Math.floor(n / 2)]
      : Math.round((d[n / 2 - 1] + d[n / 2]) / 2);
    return { chapterId: ch.chapterId, chapterSlug: ch.chapterSlug, medianMinutes: median, sessions: n };
  });
}

export function getHourlyActivity(range = 'all') {
  const ldc = leadingDateClause(range);
  return stmt(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS events
    FROM events
    ${ldc}
    GROUP BY hour
    ORDER BY hour
  `).all();
}

export function getDropOffPoints(range = 'all') {
  const dc = dateClause(range);
  return stmt(`
    SELECT json_extract(payload, '$.chapterSlug') AS chapter,
           json_extract(payload, '$.stepSlug') AS step,
           json_extract(payload, '$.chapterId') AS chapterId,
           json_extract(payload, '$.stepId') AS stepId,
           COUNT(DISTINCT session_id) AS viewed
    FROM events
    WHERE event_type = 'step_viewed' ${dc}
    GROUP BY chapterId, stepId
    ORDER BY CAST(chapterId AS INTEGER), CAST(stepId AS INTEGER)
  `).all();
}

export function getSkipAheadStats(range = 'all') {
  const dc = dateClause(range);
  const skips = stmt(`
    SELECT json_extract(payload, '$.toStep') AS toStep, COUNT(*) AS c
    FROM events WHERE event_type = 'skip_ahead' ${dc}
    GROUP BY toStep ORDER BY c DESC
  `).all();
  const totalSkips = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'skip_ahead' ${dc}`).get().c;
  const sessionsSkipped = stmt(`SELECT COUNT(DISTINCT session_id) AS c FROM events WHERE event_type = 'skip_ahead' ${dc}`).get().c;
  return { skips, totalSkips, sessionsSkipped };
}

export function getRecentActivity() {
  // Recent activity is intentionally not range-filtered — it's the "last N
  // events regardless of date" feed, used for live monitoring.
  return stmt(`
    SELECT session_id, event_type, payload, created_at
    FROM events ORDER BY id DESC LIMIT 50
  `).all();
}

export function getShareStats(range = 'all') {
  const dc = dateClause(range);
  const audSql = currentAudienceSQL(range);

  const totalShares = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'share_clicked' ${dc}`).get().c;
  const sessionsShared = stmt(`SELECT COUNT(DISTINCT session_id) AS c FROM events WHERE event_type = 'share_clicked' ${dc}`).get().c;

  const byPlatform = stmt(`
    SELECT json_extract(payload, '$.platform') AS platform,
           COUNT(*) AS clicks,
           COUNT(DISTINCT session_id) AS sessions
    FROM events
    WHERE event_type = 'share_clicked' ${dc}
    GROUP BY platform
    ORDER BY clicks DESC
  `).all();

  const byAudience = stmt(`
    ${audSql}
    SELECT sa.audience,
           json_extract(e2.payload, '$.platform') AS platform,
           COUNT(*) AS clicks,
           COUNT(DISTINCT e2.session_id) AS sessions
    FROM session_audience sa
    JOIN events e2 ON sa.session_id = e2.session_id AND e2.event_type = 'share_clicked' ${dc}
    WHERE sa.audience IS NOT NULL
    GROUP BY sa.audience, platform
    ORDER BY sa.audience, clicks DESC
  `).all();

  return { totalShares, sessionsShared, byPlatform, byAudience };
}

export function getEngagementStats(range = 'all') {
  const dc = dateClause(range);

  const eventsPerSession = stmt(`
    SELECT session_id, COUNT(*) AS events
    FROM events
    WHERE event_type IN ${browserEventTypesSQL} ${dc}
    GROUP BY session_id
    ORDER BY events DESC
  `).all();

  const n = eventsPerSession.length;
  const avgEvents = n > 0
    ? Math.round(eventsPerSession.reduce((s, r) => s + r.events, 0) / n)
    : 0;
  const maxEvents = n > 0 ? eventsPerSession[0].events : 0;
  const minEvents = n > 0 ? eventsPerSession[n - 1].events : 0;

  const sessionsWithConfig = stmt(`SELECT COUNT(DISTINCT session_id) AS c FROM events WHERE event_type = 'agent_configured' ${dc}`).get().c;
  const sessionsWithBadges = stmt(`SELECT COUNT(DISTINCT session_id) AS c FROM events WHERE event_type = 'badge_earned' ${dc}`).get().c;
  const totalResets = stmt(`SELECT COUNT(*) AS c FROM events WHERE event_type = 'progress_reset' ${dc}`).get().c;

  return { avgEvents, maxEvents, minEvents, sessionsWithConfig, sessionsWithBadges, totalResets };
}

export function getFeedback(range = 'all') {
  const dc = dateClause(range);
  // Aggregate every valid numeric response in the selected range. The list
  // below is deliberately capped for the dashboard, but that cap must not
  // change totals, ratings, or the NPS score.
  const summary = stmt(`
    WITH ratings AS (
      SELECT CASE WHEN json_valid(payload) THEN
        CASE WHEN json_type(payload, '$.nps') IN ('integer', 'real')
          THEN json_extract(payload, '$.nps') END
      END AS nps
      FROM events
      WHERE event_type = 'feedback' ${dc}
    )
    SELECT COUNT(nps) AS total,
           SUM(nps) AS npsSum,
           SUM(CASE WHEN nps >= 9 THEN 1 ELSE 0 END) AS promoters,
           SUM(CASE WHEN nps >= 7 AND nps <= 8 THEN 1 ELSE 0 END) AS passives,
           SUM(CASE WHEN nps <= 6 THEN 1 ELSE 0 END) AS detractors
    FROM ratings
  `).get();
  const rows = stmt(`
    SELECT session_id, payload, created_at
    FROM events
    WHERE event_type = 'feedback' ${dc}
    ORDER BY id DESC
    LIMIT 200
  `).all();

  const items = rows.map(r => {
    const p = r.payload ? (() => { try { return JSON.parse(r.payload); } catch { return {}; } })() : {};
    return {
      sessionId: r.session_id,
      createdAt: r.created_at,
      nps: typeof p.nps === 'number' ? p.nps : null,
      comment: p.comment || '',
      name: p.name || '',
      email: p.email || '',
    };
  });

  const total = summary.total;
  const avgNps = total > 0
    ? Math.round((summary.npsSum / total) * 10) / 10
    : 0;
  const promoters = summary.promoters ?? 0;
  const passives = summary.passives ?? 0;
  const detractors = summary.detractors ?? 0;
  const npsScore = total > 0
    ? Math.round(((promoters - detractors) / total) * 100)
    : 0;

  return { items, total, avgNps, promoters, passives, detractors, npsScore };
}

export function getAllMetrics(range = 'all') {
  return {
    range,
    overview: getOverview(range),
    funnel: getCompletionFunnel(range),
    chapters: getChapterCompletion(range),
    audience: getAudienceBreakdown(range),
    calls: getCallStats(range),
    agentConfig: getAgentConfig(range),
    pacing: getPacing(range),
    timePerChapter: getTimePerChapter(range),
    hourlyActivity: getHourlyActivity(range),
    dropOff: getDropOffPoints(range),
    skipAhead: getSkipAheadStats(range),
    engagement: getEngagementStats(range),
    shares: getShareStats(range),
    feedback: getFeedback(range),
    recent: getRecentActivity(),
  };
}
