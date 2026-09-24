// One Worker for the whole site.
//
// Requests to /api/* are handled here; everything else falls through to the
// static files in /public (index.html, submit.html). This replaces the three
// separate Pages Functions — Workers wants a single entry point.

const MODES    = ['parking', 'p25', 'rally', 'hq', 'landmark'];
const OUTCOMES = ['a', 'b', 'draw'];
const NUMS = ['fans', 'loss', 'injured', 'sing', 'dance', 'active'];
const PCTS = ['natk', 'nred', 'sb', 'sred'];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);

// A stable fingerprint of the numbers that matter, so the same fight submitted
// by both players is stored once rather than counted twice.
async function fingerprint(r) {
  const key = [r.mode, r.outcome,
    r.a_fans, r.a_loss, r.a_sing, r.a_dance,
    r.b_fans, r.b_loss, r.b_sing, r.b_dance].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- POST /api/report ----
async function saveReport(request, env) {
  if (!env.DB) return bad('Database is not connected yet.', 500);

  let body;
  try { body = await request.json(); }
  catch { return bad('Could not read the submission.'); }

  if (!MODES.includes(body.mode))       return bad('Pick which kind of battle this was.');
  if (!OUTCOMES.includes(body.outcome)) return bad('Pick who won.');

  const row = {
    mode: body.mode,
    outcome: body.outcome,
    a_name: (body.a_name || '').toString().slice(0, 40) || null,
    b_name: (body.b_name || '').toString().slice(0, 40) || null,
    submitted_by: (body.submitted_by || '').toString().slice(0, 40) || null,
    a_bonus: Number(body.a_bonus) || 0,
    b_bonus: Number(body.b_bonus) || 0,
  };

  for (const side of ['a', 'b']) {
    for (const f of NUMS) {
      const v = Number(body[`${side}_${f}`]);
      if (!isFinite(v) || v < 0) return bad(`Check the ${side.toUpperCase()} side's ${f} value.`);
      row[`${side}_${f}`] = Math.round(v);
    }
    for (const f of PCTS) {
      let v = Number(body[`${side}_${f}`]);
      if (!isFinite(v) || v < 0) return bad(`Check the ${side.toUpperCase()} side's ${f} value.`);
      // The form asks for the number exactly as the game shows it, so 175 means
      // 175% and 17 means 17%. Always divide by a hundred.
      //
      // An earlier version only converted values above 20, on the theory that a
      // small number must already be a fraction. That was wrong: reductions are
      // routinely 5% or 17%, and those were being stored as 500% and 1700%.
      v = v / 100;
      // Nothing in this game goes near 1000%, so a value that high is a typo —
      // an extra digit, or someone entering 1.75 where 175 was wanted.
      if (v > 10) return bad(`The ${side.toUpperCase()} side's ${f} looks too big — enter it as the game shows it, e.g. 175 for 175%.`);
      row[`${side}_${f}`] = v;
    }
  }

  // Sanity checks against how the game actually behaves. Damage taken is loss
  // plus injured, and that can never exceed the fan pool.
  //
  // An earlier version derived injured as four times loss, on the basis that
  // loss is always 20% of damage taken. That holds for parking and P25 but not
  // for HQ defence, where the attacker loses 20% and the defender 10% — so the
  // figure is now collected rather than assumed.
  for (const side of ['a', 'b']) {
    const taken = row[`${side}_loss`] + row[`${side}_injured`];
    if (taken > row[`${side}_fans`] * 1.02) {
      return bad(`The ${side.toUpperCase()} side's loss and injured add up to more than their fan pool — check the numbers.`);
    }
    // Any side that lost fans must also have injured ones, so a zero here
    // almost always means the box was skipped rather than genuinely zero.
    if (row[`${side}_loss`] > 0 && row[`${side}_injured`] === 0) {
      return bad(`The ${side.toUpperCase()} side has a loss but no injured — the injured figure is the yellow number, just below loss.`);
    }
  }
  const aFull = (row.a_loss + row.a_injured) >= row.a_fans * 0.98;
  const bFull = (row.b_loss + row.b_injured) >= row.b_fans * 0.98;
  if (row.outcome === 'a' && !bFull)   return bad('You marked A as the winner, but B was not fully depleted.');
  if (row.outcome === 'b' && !aFull)   return bad('You marked B as the winner, but A was not fully depleted.');
  if (row.outcome === 'draw' && !(aFull && bFull))
    return bad('A draw means both sides ran out — check the numbers.');

  row.fingerprint = await fingerprint(row);
  row.created_at  = new Date().toISOString();

  const cols = Object.keys(row);
  const sql = `INSERT INTO reports (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;

  try {
    await env.DB.prepare(sql).bind(...cols.map(c => row[c])).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return json({ ok: true, duplicate: true });
    return bad('Could not save that — please try again.', 500);
  }

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM reports').first();
  return json({ ok: true, total: count });
}

// ---- GET /api/export?key=... ----
async function exportReports(url, env) {
  if (!env.DB) return new Response('Database is not connected yet.', { status: 500 });

  // 404 rather than 403 — no point advertising that this endpoint exists
  if (!env.EXPORT_KEY || url.searchParams.get('key') !== env.EXPORT_KEY) {
    return new Response('Not found', { status: 404 });
  }

  const { results } = await env.DB
    .prepare('SELECT * FROM reports ORDER BY created_at ASC').all();
  const stamp = new Date().toISOString().slice(0, 10);

  if (url.searchParams.get('format') === 'csv') {
    if (!results.length) return new Response('', { headers: { 'content-type': 'text/csv' } });
    const cols = Object.keys(results[0]);
    const esc = v => v == null ? '' :
      /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const csv = [cols.join(','), ...results.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="battle-reports-${stamp}.csv"`,
      },
    });
  }

  return new Response(JSON.stringify({
    exported_at: new Date().toISOString(),
    count: results.length,
    reports: results,
  }, null, 1), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="battle-reports-${stamp}.json"`,
    },
  });
}

// ---- GET /api/count ----  public, but it is only a number
async function countReports(env) {
  if (!env.DB) return json({ total: 0 });
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM reports').first();
    return json({ total: row.total });
  } catch {
    return json({ total: 0 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/report' && request.method === 'POST')
      return saveReport(request, env);

    if (url.pathname === '/api/export' && request.method === 'GET')
      return exportReports(url, env);

    if (url.pathname === '/api/count' && request.method === 'GET')
      return countReports(env);

    if (url.pathname.startsWith('/api/'))
      return new Response('Not found', { status: 404 });

    // Everything else is a static file — index.html, submit.html and so on.
    return env.ASSETS.fetch(request);
  },
};
