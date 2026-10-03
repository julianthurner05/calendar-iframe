/* ================================================================
   Signatur-Check für signierte Embed-URLs (Cloudflare Worker)
   Gegenstück zu signUrlPlusExpire() im SpotTool-Backend:
   hash = HMAC-SHA256(secret, `${pathname}:${expires}`)

   Statische Auslieferung läuft über das Assets-Binding (wrangler.jsonc).
   Geprüft werden nur Dokument-Requests (die Kalender-Seite selbst).
   css/, js/, data/ und robots.txt laufen frei durch – das iframe
   lädt sie selbst nach, ohne Signatur in der URL.
   ================================================================ */

/* DEV-SCHALTER: auf false stellen (und pushen), um den Check abzuschalten.
   Übersteuerbar ohne Push per Umgebungsvariable IFRAME_CHECK am Worker:
   "on" erzwingt den Check, "off" schaltet ihn ab – die Variable gewinnt
   immer gegen diese Konstante. */
const CHECK_ACTIVE = true;

/* Gleiches Secret wie im SpotTool-Backend. Produktiv als Secret
   IFRAME_SECRET am Worker setzen; der Fallback hier ist nur der
   Dev-Wert aus dem Backend-Snippet. */
const FALLBACK_SECRET = "tempSectret";

const PUBLIC_PREFIXES = ["/css/", "/js/", "/data/"];
const PUBLIC_FILES = ["/robots.txt", "/favicon.ico"];

function checkEnabled(env) {
  if (env && env.IFRAME_CHECK === "off") return false;
  if (env && env.IFRAME_CHECK === "on") return true;
  return CHECK_ACTIVE;
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* Konstantzeit-Vergleich der Hex-Strings (wie timingSafeEqual im Backend) */
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const deny = reason => new Response(`Zugriff verweigert: ${reason}`, {
  status: 403,
  headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
    "x-sig-check": "denied",
  },
});

/* Asset ausliefern, Antwort mit x-sig-check-Header markieren */
async function pass(request, env, state) {
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set("x-sig-check", state);
  return out;
}

export default {
  async fetch(request, env) {
    if (!checkEnabled(env)) return pass(request, env, "off");

    const url = new URL(request.url);
    const path = url.pathname;
    if (PUBLIC_PREFIXES.some(p => path.startsWith(p)) || PUBLIC_FILES.includes(path)) {
      return pass(request, env, "public");
    }

    const expires = url.searchParams.get("expires");
    const hash = url.searchParams.get("hash");

    if (!expires || !hash) return deny("Fehlende Signatur oder Ablaufzeit");
    if (Date.now() > Number(expires)) return deny("Link ist abgelaufen");

    const secret = (env && env.IFRAME_SECRET) || FALLBACK_SECRET;
    const expected = await hmacHex(secret, `${path}:${expires}`);
    if (!timingSafeEqualHex(hash, expected)) return deny("Ungültige Signatur");

    return pass(request, env, "valid");
  },
};
