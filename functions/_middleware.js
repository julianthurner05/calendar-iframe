/* ================================================================
   Signatur-Check für signierte Embed-URLs (Cloudflare Pages Function)
   Gegenstück zu signUrlPlusExpire() im SpotTool-Backend:
   hash = HMAC-SHA256(secret, `${pathname}:${expires}`)

   Geprüft werden nur Dokument-Requests (die Kalender-Seite selbst).
   css/, js/, data/ und robots.txt laufen frei durch – das iframe
   lädt sie selbst nach, ohne Signatur in der URL.
   ================================================================ */

/* DEV-SCHALTER: auf true stellen (und pushen), sobald der Check scharf
   sein soll. Solange false, ist der Kalender ohne Signatur aufrufbar.
   Übersteuerbar ohne Push per Umgebungsvariable IFRAME_CHECK im
   Cloudflare-Pages-Projekt: "on" erzwingt den Check, "off" schaltet
   ihn ab – die Variable gewinnt immer gegen diese Konstante. */
const CHECK_ACTIVE = true;

/* Gleiches Secret wie im SpotTool-Backend. Produktiv als Umgebungs-
   variable IFRAME_SECRET im Cloudflare-Pages-Projekt setzen; der
   Fallback hier ist nur der Dev-Wert aus dem Backend-Snippet. */
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
  },
});

export async function onRequest(context) {
  const { request, env, next } = context;
  if (!checkEnabled(env)) return next();

  const url = new URL(request.url);
  const path = url.pathname;
  if (PUBLIC_PREFIXES.some(p => path.startsWith(p)) || PUBLIC_FILES.includes(path)) return next();

  const expires = url.searchParams.get("expires");
  const hash = url.searchParams.get("hash");

  if (!expires || !hash) return deny("Fehlende Signatur oder Ablaufzeit");
  if (Date.now() > Number(expires)) return deny("Link ist abgelaufen");

  const secret = (env && env.IFRAME_SECRET) || FALLBACK_SECRET;
  const expected = await hmacHex(secret, `${path}:${expires}`);
  if (!timingSafeEqualHex(hash, expected)) return deny("Ungültige Signatur");

  return next();
}
