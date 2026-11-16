// GET / PUT / DELETE /api/progress/ABCD  -> load, update or remove an in-progress exam.

// Shared helpers for the resume-code API (Cloudflare Pages Functions + KV).
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U: easy to read and type
const CODE_RE = /^[ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;
const TTL_SECONDS = 60 * 60 * 24 * 30; // codes expire 30 days after the last save
const MAX_BYTES = 64 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readState(request) {
  const text = await request.text();
  if (text.length > MAX_BYTES) return { error: json({ error: "too large" }, 413) };
  let state;
  try { state = JSON.parse(text); } catch (e) { return { error: json({ error: "invalid JSON" }, 400) }; }
  if (!state || state.v !== 1 || !Array.isArray(state.items)) return { error: json({ error: "invalid state" }, 400) };
  return { text };
}

function randomCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}


function codeFrom(params) {
  const code = String(params.code || "").toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export async function onRequestGet({ params, env }) {
  const code = codeFrom(params);
  if (!code) return json({ error: "invalid code" }, 400);
  const text = await env.PROGRESS.get(code);
  if (text === null) return json({ error: "not found" }, 404);
  return new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function onRequestPut({ params, request, env }) {
  const code = codeFrom(params);
  if (!code) return json({ error: "invalid code" }, 400);
  const { text, error } = await readState(request);
  if (error) return error;
  await env.PROGRESS.put(code, text, { expirationTtl: TTL_SECONDS });
  return json({ ok: true });
}

export async function onRequestDelete({ params, env }) {
  const code = codeFrom(params);
  if (!code) return json({ error: "invalid code" }, 400);
  await env.PROGRESS.delete(code);
  return json({ ok: true });
}
