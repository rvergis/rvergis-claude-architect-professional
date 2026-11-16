// POST /api/progress  -> store a new in-progress exam under a fresh 4-letter code.

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


export async function onRequestPost({ request, env }) {
  const { text, error } = await readState(request);
  if (error) return error;
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    if (await env.PROGRESS.get(code) === null) {
      await env.PROGRESS.put(code, text, { expirationTtl: TTL_SECONDS });
      return json({ code }, 201);
    }
  }
  return json({ error: "no free code, try again" }, 503);
}
