const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export async function onRequestGet({ request, env }) {
  await ensureAuthSchema(env.DB);

  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();

  if (action === 'me') {
    const session = await getSessionFromRequest(request, env.DB);
    if (!session) {
      return Response.json({ ok: false }, { status: 401, headers: jsonHeaders });
    }

    return Response.json(
      {
        ok: true,
        user: {
          id: session.userId,
          matricula: session.matricula,
          name: session.name,
          role: session.role
        }
      },
      { headers: jsonHeaders }
    );
  }

  return Response.json({ ok: false }, { status: 404, headers: jsonHeaders });
}

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.DB);

  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();

  if (action === 'login') {
    const body = await safeJson(request);
    const matricula = normalizeMatricula(body?.matricula);
    const password = typeof body?.senha === 'string' ? body.senha : '';

    if (!matricula || !password) {
      return Response.json({ ok: false, message: 'Informe matrícula e senha.' }, { status: 400, headers: jsonHeaders });
    }

    const user = await env.DB
      .prepare(
        `
          SELECT id, matricula, name, role, password_hash, password_salt, password_iters, active, must_change_password
          FROM users
          WHERE matricula = ?
          LIMIT 1
        `
      )
      .bind(matricula)
      .first();

    if (!user || Number(user.active) !== 1) {
      return Response.json({ ok: false, message: 'Usuário ou senha inválidos.' }, { status: 401, headers: jsonHeaders });
    }

    const iterations = Number(user.password_iters) || 50000;
    const computed = hashPassword(password, String(user.password_salt), iterations);
    const ok = timingSafeEqualString(computed, String(user.password_hash));

    if (!ok) {
      return Response.json({ ok: false, message: 'Usuário ou senha inválidos.' }, { status: 401, headers: jsonHeaders });
    }

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);

    await env.DB
      .prepare(
        `
          INSERT INTO sessions (token, user_id, role, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .bind(token, String(user.id), String(user.role), now.toISOString(), expiresAt.toISOString())
      .run();

    return Response.json(
      {
        ok: true,
        token,
        mustChangePassword: Number(user.must_change_password) === 1,
        user: {
          id: String(user.id),
          matricula: String(user.matricula),
          name: String(user.name || ''),
          role: String(user.role)
        }
      },
      { headers: jsonHeaders }
    );
  }

  if (action === 'change-password') {
    try {
      const session = await getSessionFromRequest(request, env.DB);
      if (!session) {
        return Response.json({ ok: false, message: 'Sessão inválida.' }, { status: 401, headers: jsonHeaders });
      }

      const body = await safeJson(request);
      const password = typeof body?.senha === 'string' ? body.senha : '';
      if (!password) {
        return Response.json({ ok: false, message: 'Informe a nova senha.' }, { status: 400, headers: jsonHeaders });
      }
      if (password.length < 4) {
        return Response.json(
          { ok: false, message: 'Senha muito curta (mínimo 4).' },
          { status: 400, headers: jsonHeaders }
        );
      }

      const now = new Date().toISOString();
      const iterations = 50000;
      const saltBytes = getRandomBytes(16);
      const salt = bytesToHex(saltBytes);
      const hash = hashPassword(password, salt, iterations);

      await env.DB
        .prepare(
          `
            UPDATE users
            SET password_hash = ?, password_salt = ?, password_iters = ?, must_change_password = 0, updated_at = ?
            WHERE id = ?
          `
        )
        .bind(hash, salt, iterations, now, session.userId)
        .run();

      return Response.json({ ok: true }, { headers: jsonHeaders });
    } catch {
      return Response.json(
        {
          ok: false,
          message: 'Não foi possível salvar a senha agora. Atualize a página e tente novamente.'
        },
        { status: 500, headers: jsonHeaders }
      );
    }
  }

  if (action === 'logout') {
    const session = await getSessionFromRequest(request, env.DB);
    if (session) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(session.token).run();
    }

    return Response.json({ ok: true }, { headers: jsonHeaders });
  }

  return Response.json({ ok: false }, { status: 404, headers: jsonHeaders });
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      ...jsonHeaders,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization'
    }
  });
}

async function ensureAuthSchema(db) {
  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          matricula TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_iters INTEGER NOT NULL,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `
    )
    .run();

  try {
    await db.prepare('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0').run();
  } catch {}

  await db
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )
      `
    )
    .run();
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function normalizeMatricula(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.replace(/\s+/g, '');
}

function timingSafeEqualString(a, b) {
  const left = String(a);
  const right = String(b);
  const max = Math.max(left.length, right.length);
  let result = left.length === right.length ? 0 : 1;

  for (let index = 0; index < max; index += 1) {
    const ca = left.charCodeAt(index) || 0;
    const cb = right.charCodeAt(index) || 0;
    result |= ca ^ cb;
  }

  return result === 0;
}

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex) {
  const text = String(hex || '').trim().toLowerCase();
  if (!text || text.length % 2 !== 0 || /[^0-9a-f]/.test(text)) {
    return null;
  }
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64Decode(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeSalt(value) {
  const hex = hexToBytes(value);
  if (hex) return hex;
  return base64Decode(String(value || ''));
}

function sha256(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  const l = bytes.length;
  const bitLenHi = Math.floor((l * 8) / 0x100000000);
  const bitLenLo = (l * 8) >>> 0;
  const padLen = ((56 - ((l + 1) % 64)) + 64) % 64;
  const padded = new Uint8Array(l + 1 + padLen + 8);
  padded.set(bytes, 0);
  padded[l] = 0x80;
  padded[padded.length - 8] = (bitLenHi >>> 24) & 0xff;
  padded[padded.length - 7] = (bitLenHi >>> 16) & 0xff;
  padded[padded.length - 6] = (bitLenHi >>> 8) & 0xff;
  padded[padded.length - 5] = bitLenHi & 0xff;
  padded[padded.length - 4] = (bitLenLo >>> 24) & 0xff;
  padded[padded.length - 3] = (bitLenLo >>> 16) & 0xff;
  padded[padded.length - 2] = (bitLenLo >>> 8) & 0xff;
  padded[padded.length - 1] = bitLenLo & 0xff;

  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

function getRandomBytes(length) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function generateToken() {
  return bytesToHex(getRandomBytes(32));
}

function generateId() {
  return bytesToHex(getRandomBytes(16));
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function hashPassword(password, saltValue, iterations) {
  const enc = new TextEncoder();
  const salt = decodeSalt(saltValue);
  let data = concatBytes(salt, enc.encode(':'), enc.encode(password));
  const rounds = Number.isFinite(iterations) && iterations > 0 ? Math.floor(iterations) : 50000;
  for (let i = 0; i < rounds; i += 1) {
    data = sha256(data);
  }
  return bytesToHex(data);
}

export async function createUser(db, { matricula, name, role, password }) {
  const id = generateId();
  const now = new Date().toISOString();
  const iterations = 50000;
  const saltBytes = getRandomBytes(16);
  const salt = bytesToHex(saltBytes);
  const hash = hashPassword(password, salt, iterations);

  await db
    .prepare(
      `
        INSERT INTO users (id, matricula, name, role, password_hash, password_salt, password_iters, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `
    )
    .bind(id, matricula, name, role, hash, salt, iterations, now, now)
    .run();

  return { id, createdAt: now };
}

export async function getSessionFromRequest(request, db) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : '';
  if (!token) return null;

  const now = new Date().toISOString();
  const session = await db
    .prepare(
      `
        SELECT s.token, s.user_id as userId, s.role, s.expires_at as expiresAt, u.matricula, u.name, u.active
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
          AND s.expires_at > ?
        LIMIT 1
      `
    )
    .bind(token, now)
    .first();

  if (!session) return null;
  if (Number(session.active) !== 1) return null;

  return {
    token: String(session.token),
    userId: String(session.userId),
    matricula: String(session.matricula || ''),
    name: String(session.name || ''),
    role: String(session.role || '')
  };
}
