// GET /api/count
// Returns just how many reports have been collected. Public and harmless —
// it exposes a single number, nothing about the reports themselves.

export async function onRequestGet({ env }) {
  if (!env.DB) {
    return new Response(JSON.stringify({ total: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM reports').first();
    return new Response(JSON.stringify({ total: row.total }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ total: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }
}
