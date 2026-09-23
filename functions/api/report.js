// POST /api/report
// Receives one battle report, validates it, and stores it in D1.
//
// Runs on Cloudflare's servers, not in the visitor's browser — so the checks
// here cannot be skipped by editing the page.

const MODES = ['parking', 'p25', 'rally', 'hq', 'landmark'];
const OUTCOMES = ['a', 'b', 'draw'];

// Fields every report must carry, per side.
const NUMS = ['fans', 'loss', 'sing', 'dance', 'active'];
const PCTS = ['natk', 'nred', 'sb', 'sred'];

function bad(msg, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// A stable fingerprint of the numbers that matter, so the same fight submitted
// twice (by both players, say) is stored once rather than skewing the dataset.
async function fingerprint(r) {
  const key = [r.mode, r.outcome,
    r.a_fans, r.a_loss, r.a_sing, r.a_dance,
    r.b_fans, r.b_loss, r.b_sing, r.b_dance].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return bad('Database is not connected yet.', 500);

  let body;
  try { body = await request.json(); }
  catch { return bad('Could not read the submission.'); }

  // --- validate ---
  if (!MODES.includes(body.mode)) return bad('Pick which kind of battle this was.');
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
      // accept either 205 or 2.05 — anything above 20 is assumed to be a percentage
      if (v > 20) v = v / 100;
      row[`${side}_${f}`] = v;
    }
  }

  // --- sanity checks against how the game actually behaves ---
  // Loss is always 20% of the damage taken, so damage taken = 5 x loss,
  // and that can never exceed the fan pool.
  for (const side of ['a', 'b']) {
    const taken = row[`${side}_loss`] * 5;
    if (taken > row[`${side}_fans`] * 1.02) {
      return bad(`The ${side.toUpperCase()} side's loss is too big for their fan pool — check the numbers.`);
    }
  }
  // The loser (or both, in a draw) should have been fully depleted.
  const aFull = row.a_loss * 5 >= row.a_fans * 0.98;
  const bFull = row.b_loss * 5 >= row.b_fans * 0.98;
  if (row.outcome === 'a' && !bFull) return bad('You marked A as the winner, but B was not fully depleted.');
  if (row.outcome === 'b' && !aFull) return bad('You marked B as the winner, but A was not fully depleted.');
  if (row.outcome === 'draw' && !(aFull && bFull)) return bad('A draw means both sides ran out — check the numbers.');

  row.fingerprint = await fingerprint(row);
  row.created_at = new Date().toISOString();

  const cols = Object.keys(row);
  const sql = `INSERT INTO reports (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;

  try {
    await env.DB.prepare(sql).bind(...cols.map(c => row[c])).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return bad('Could not save that — please try again.', 500);
  }

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM reports').first();
  return new Response(JSON.stringify({ ok: true, total: count }), {
    headers: { 'content-type': 'application/json' },
  });
}
