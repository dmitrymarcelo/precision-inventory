const STATE_KEY = 'inventory';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export async function onRequestGet({ env }) {
  await ensureSchema(env.DB);

  const row = await env.DB
    .prepare('SELECT value, updated_at FROM app_state WHERE key = ?')
    .bind(STATE_KEY)
    .first();

  return Response.json({
    state: row ? JSON.parse(row.value) : null,
    updatedAt: row?.updated_at ?? null
  }, { headers: jsonHeaders });
}

export async function onRequestPut({ request, env }) {
  await ensureSchema(env.DB);

  const body = await request.json();
  const state = normalizeState(body);
  const updatedAt = new Date().toISOString();

  await env.DB
    .prepare(`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .bind(STATE_KEY, JSON.stringify(state), updatedAt)
    .run();

  return Response.json({ ok: true, updatedAt }, { headers: jsonHeaders });
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      ...jsonHeaders,
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

async function ensureSchema(db) {
  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    .run();
}

function normalizeState(body) {
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    logs: Array.isArray(body?.logs) ? body.logs : [],
    settings: body?.settings && typeof body.settings === 'object' ? body.settings : {},
    requests: Array.isArray(body?.requests) ? body.requests : [],
    vehicles: Array.isArray(body?.vehicles) ? body.vehicles : [],
    ocrAliases: body?.ocrAliases && typeof body.ocrAliases === 'object' ? body.ocrAliases : {}
  };
}
