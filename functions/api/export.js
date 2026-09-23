// GET /api/export?key=YOUR_KEY
// Downloads every stored report as one JSON file, ready to hand to Claude.
//
// Protected by a key you set in the Cloudflare dashboard as the environment
// variable EXPORT_KEY. Without it the endpoint refuses, so a leaked site
// address does not also leak the whole dataset.
//
// Add &format=csv for a spreadsheet-friendly version.

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return new Response('Database is not connected yet.', { status: 500 });
  }
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!env.EXPORT_KEY || key !== env.EXPORT_KEY) {
    return new Response('Not found', { status: 404 });   // 404, not 403 — do not advertise that it exists
  }

  const { results } = await env.DB
    .prepare('SELECT * FROM reports ORDER BY created_at ASC')
    .all();

  const stamp = new Date().toISOString().slice(0, 10);

  if (url.searchParams.get('format') === 'csv') {
    if (!results.length) return new Response('', { headers: { 'content-type': 'text/csv' } });
    const cols = Object.keys(results[0]);
    const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
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
