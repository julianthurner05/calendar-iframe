# SpotTool Calendar Embed – cal-iframe.sound-dna.com

## Was dieses Projekt ist

Ein statisch gehosteter, schreibgeschützter Durchsagen-Kalender von sound.dna, der als iframe in andere Frontends eingebettet wird. Er ist die Übergangslösung, bis die Barix-API verfügbar ist: Schedule-Änderungen werden manuell im Barix-Portal eingetragen und hier gespiegelt, damit Kunden ihren aktuellen Durchsagen-Plan sehen.

Es gibt EINEN Kalender (index.html + css/ + js/) für alle Stores. Pro Store existiert nur ein Datensatz unter `data/<slug>.json`. Der URL-Parameter wählt den Datensatz:

```
https://cal-iframe.sound-dna.com/?store=ikea-voesendorf
```

Deployment: Cloudflare Pages, direkt an dieses Repo gekoppelt. Kein Build-Schritt – `git push` auf main deployt automatisch in ~30 Sekunden. Es gibt keinen Server und keine Datenbank; die JSON-Dateien im Repo SIND die Daten.

## Die Hauptaufgabe in diesem Projekt

Fast alle Aufträge sind Datenpflege: Schedules in `data/<store>.json` eintragen, ändern, beenden oder löschen – nach einer Kundenmail oder Zuruf. Ablauf:

1. Betroffene `data/<store>.json` lesen
2. Änderung einarbeiten (Schema und Regeln unten strikt einhalten)
3. Validieren (Regeln unten), bei Konflikten NICHT stillschweigend anpassen, sondern rückfragen
4. Committen und pushen (Commit-Message: `data(<slug>): <was geändert wurde>`, z. B. `data(ikea-voesendorf): Family Aktion Oktober hinzugefügt`)

An `index.html`, `css/` oder `js/` wird bei Datenpflege NIE etwas geändert. Code-Änderungen nur, wenn ausdrücklich verlangt.

## Datenschema (data/<slug>.json)

```json
{
  "storeName": "IKEA Vösendorf",
  "timezone": "Europe/Vienna",
  "storeHours": [["09:00","20:00"], ["09:00","20:00"], ["09:00","20:00"], ["09:00","20:00"], ["09:00","21:00"], ["09:00","18:00"], null],
  "quietHours": [{ "day": 2, "from": "16:00", "to": "18:00" }],
  "schedules": [
    {
      "title": "IKEA FAMILY Durchsage",
      "category": "marketing",
      "type": "weekly",
      "start": "31.08.2026",
      "end": "26.09.2026",
      "days": ["Mo", "Tu", "Th", "Fr"],
      "times": ["10:00", "13:00", "16:00", "19:00"]
    }
  ]
}
```

Feldregeln:

- `storeHours`: Array mit genau 7 Einträgen, Index 0 = Montag … 6 = Sonntag. Eintrag ist `["HH:MM","HH:MM"]` (öffnet/schließt) oder `null` (geschlossen).
- `quietHours`: `day` ist 0 = Montag … 6 = Sonntag; in diesen Fenstern läuft nichts (der Kalender zeichnet sie als gesperrten Block).
- `schedules[]`:
  - `title`: frei, so wie der Spot heißt
  - `category`: exakt einer von `food` | `marketing` | `special` | `closing` – nichts anderes, keine neuen Kategorien erfinden
  - `type`: `weekly` (wiederkehrend, braucht `days`) oder `single` (einmalig, läuft nur am `start`-Datum, `days`/`end` entfallen)
  - `start` / `end`: Format exakt `dd.mm.yyyy`. `end` ist optional (ohne `end` läuft der Schedule unbefristet)
  - `days`: Teilmenge von exakt `["Mo","Tu","We","Th","Fr","Sa","Su"]` – genau diese Kürzel, keine anderen Schreibweisen
  - `times`: Uhrzeiten als `"HH:MM"` (24 h, zweistellig). Alternativ zu `times` unterstützt der Renderer auch `from`/`to`/`every` (Intervall in Minuten) oder `once: true` + `from` – für neue Einträge aber immer `times` verwenden, das ist am wartbarsten
  - `locked: true`: nur für fixe Schlussdurchsagen-Blöcke; zeigt im Kalender ein Schloss

## Validierungsregeln (vor jedem Commit prüfen)

1. **Öffnungszeiten:** Jede Zeit in `times` muss an jedem Tag in `days` innerhalb der Öffnungszeit liegen (≥ Öffnung, < Schließung). Einzige Ausnahme: `category: "closing"` darf bis EINSCHLIESSLICH Schließzeit liegen (z. B. 20:00 bei Schließung 20:00).
2. **Quiet Hours:** Keine Zeit darf in ein Quiet-Hour-Fenster des jeweiligen Tages fallen. (Der Renderer würde sie stumm ausfiltern – solche Einträge sind Datenmüll und dürfen gar nicht erst entstehen.)
3. **Ein Spot pro Slot:** Der Kalender rastert in 30-Minuten-Slots (08:00–22:00). Pro Tag und Slot darf nur EIN Schedule eine Zeit haben – Ausnahme sind mehrere `closing`-Zeiten im selben Slot (werden als „+N" zusammengefasst). Bei Konflikt mit einem bestehenden Schedule: rückfragen, nicht selbst umlegen.
4. **Kalenderraster:** Zeiten vor 08:00 oder ab 22:00 werden nicht angezeigt – falls ein Kunde so etwas wünscht, darauf hinweisen statt eintragen.
5. **Wochentags-Varianten:** Wenn ein Spot an Tagen mit abweichenden Regeln andere Zeiten braucht (z. B. Mittwoch wegen Quiet Hour, Samstag wegen kürzerer Öffnung), wird er als eigener Schedule-Eintrag mit Suffix im Titel geführt, z. B. `"IKEA FAMILY Durchsage (Mittwoch)"` – so ist es im Bestand gelöst, dieses Muster beibehalten.
6. **JSON-Hygiene:** Gültiges JSON, UTF-8, keine Kommentare, keine trailing commas. Bestehende Feldreihenfolge und Einrückung (2 Spaces) beibehalten.

## Neuen Store anlegen

1. Slug festlegen: kleinschreibung-mit-bindestrichen (z. B. `ikea-westbahnhof`), Dateiname = `data/<slug>.json`
2. Schema von einem bestehenden Store übernehmen, `storeName`, `storeHours`, `quietHours` und `schedules` mit den echten Werten befüllen – Öffnungszeiten und Quiet Hours beim Auftraggeber erfragen, falls nicht mitgeliefert, NIE annehmen
3. Embed-URL zurückmelden: `https://cal-iframe.sound-dna.com/?store=<slug>`

## Lokal prüfen

```bash
node scripts/validate.js
```

Prüft alle `data/*.json` gegen die Validierungsregeln oben und bricht bei Verstößen mit Exit-Code 1 und klarer Fehlermeldung ab. **Vor jedem Commit von Datenänderungen läuft dieses Skript.**

```bash
python3 -m http.server 8000
# → http://localhost:8000/?store=<slug>
```

`fetch` auf die JSON braucht einen Server – `index.html` direkt als Datei öffnen funktioniert nicht. Nach Datenänderungen reicht als Prüfung: `node scripts/validate.js`; ein Screenshot-Durchlauf ist nur bei Code-/CSS-Änderungen nötig.

## Repo-Struktur

```
/
├── CLAUDE.md            ← diese Datei
├── index.html           ← Kalender-Shell (eine für alle Stores)
├── css/
│   ├── tokens.css       ← Design-Variablen (Quelle: SpotTool) – nicht anfassen
│   ├── embed.css        ← Basis (Reset, Icons, Switch, Tooltip, Layout)
│   └── calendar.css     ← Kalender-Styles
├── js/
│   └── embed.js         ← Rendering + Datenladen (?store=… oder Pfadsegment)
├── data/
│   └── <slug>.json      ← ein Datensatz pro Store
├── scripts/
│   └── validate.js      ← prüft alle data/*.json gegen die Validierungsregeln (Node, ohne Dependencies)
├── worker/
│   └── index.js         ← Cloudflare Worker: Signatur-Check + statische Auslieferung (Assets-Binding)
├── wrangler.jsonc       ← Worker-Konfiguration (Assets aus Repo-Root, run_worker_first)
├── .assetsignore        ← schließt .git, worker/, scripts/, CLAUDE.md etc. von der öffentlichen Auslieferung aus
├── _headers             ← X-Robots-Tag noindex, frame-ancestors sound-dna.com, Cache-Regeln
└── robots.txt           ← Disallow all
```

Deployment-Detail: Das Projekt läuft als **Cloudflare Worker** (Name `calendar-iframe`, Workers-Git-Integration – NICHT klassisches Pages; ein `functions/`-Verzeichnis würde ignoriert). Der Build nutzt die `wrangler.jsonc` im Repo; die `.assetsignore` muss erhalten bleiben, sonst wird u. a. das `.git`-Verzeichnis öffentlich ausgeliefert.

## Rahmenbedingungen, die erhalten bleiben müssen

- **Nicht-Indexierung:** `<meta name="robots">` in index.html, `robots.txt` und `X-Robots-Tag` in `_headers` – keines davon entfernen oder aufweichen.
- **Framing:** `frame-ancestors` in `_headers` erlaubt Einbettung von sound-dna.com, sound-dna.media (jeweils inkl. Subdomains) sowie – vorläufig für Dev-Tests – localhost/127.0.0.1. Neue erlaubte Einbettungs-Domains nur auf ausdrückliche Anweisung ergänzen.
- **Caching:** HTML und JSON laufen mit `no-store` (Kunden sollen nach einem Push sofort den neuen Stand sehen), css/js mit max-age 86400. So lassen.
- **Design:** Das Erscheinungsbild ist 1:1 aus dem SpotTool übernommen (dunkles Design, tokens.css). Bei Code-Arbeit: ausschließlich bestehende CSS-Variablen aus tokens.css verwenden, keine neuen Tokens und keine harten Werte einführen, keine ungefragten Zusatzelemente ins UI.
- Der Kalender ist strikt read-only – keine Edit-, Klick- oder Formulier-Funktionen einbauen. Bearbeitung passiert ausschließlich über diese JSON-Dateien.

## Signierte Embed-URLs (worker/index.js)

Das SpotTool-Backend signiert Embed-URLs mit `signUrlPlusExpire()`: `hash = HMAC-SHA256(IFRAME_SECRET, "<pathname>:<expires>")`, angehängt als `?expires=…&hash=…`. Der Worker prüft das serverseitig und liefert sonst 403 (Antwort-Header `x-sig-check` zeigt den Prüfstatus: valid/denied/public/off). Geprüft werden nur Dokument-Requests; `css/`, `js/`, `data/` und `robots.txt` laufen frei durch (das iframe lädt sie selbst ohne Signatur nach).

- **Dev-Schalter:** `CHECK_ACTIVE` in `worker/index.js` – steht auf `true` (Check scharf). Zum Abschalten auf `false` setzen und pushen. Ohne Push übersteuerbar per Umgebungsvariable `IFRAME_CHECK` (`"on"`/`"off"`) am Worker – die Variable gewinnt immer.
- **Secret:** Als Secret `IFRAME_SECRET` am Worker `calendar-iframe` setzen (Settings → Variables and Secrets; gleicher Wert wie im SpotTool-Backend). Fallback ist der Dev-Wert aus dem Backend-Snippet.

## Kontext: Barix-Workflow (Übergangsphase)

Quelle der Wahrheit für die tatsächliche Ausspielung ist das Barix-Portal (dort tragen wir Schedules manuell ein). Dieses Repo spiegelt den Stand nur zur Anzeige. Wenn ein Auftrag hier eintrifft, gilt: Der Eintrag im Barix-Portal passiert separat durch das Team – hier wird nur der Kalender aktuell gehalten. Später wird die Barix-API diese manuelle Spiegelung ersetzen; die Datenstruktur ist bewusst so gehalten, dass sie dann aus der API befüllt werden kann.
