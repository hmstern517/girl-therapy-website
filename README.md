# Girl Therapy — girltherapy.org

"Coming soon" waitlist landing page for Girl Therapy, a telehealth therapy
platform built exclusively for women, by women. Operated by Finally Therapy, LLC.

## Stack

Static HTML / CSS / JS. No build step. Deploy as-is to GitHub Pages, Netlify,
Vercel, or any static host. Currently deployed via GitHub Pages with a custom
domain (see `CNAME`).

## Structure

```
index.html             Coming-soon landing page (live homepage)
therapists.html        For Therapists (recruitment) page — not currently
                        linked from index.html, kept for future use
assets/css/style.css   Design tokens + styles for therapists.html
assets/js/main.js      Form handling (Google Sheet via Apps Script), nav/reveal
                        helpers used by therapists.html
scripts/apps-script-form-handler.gs   Backend handler — see Forms section below
```

Note: `index.html` is currently self-contained (styles inline, Google Fonts
via CDN) and does NOT use `assets/css/style.css`. That stylesheet still
powers `therapists.html`.

## Design system

**index.html (coming soon):**
- Background: `#FF66C4` (pink), accent: `#FFECAD` (soft yellow)
- Fonts: **Outfit** (headline/buttons), **Hanken Grotesk** (body/inputs),
  **Dancing Script** (wordmark), all loaded via Google Fonts CDN

**therapists.html (legacy multi-section page, assets/css/style.css):**
- `--pink: #FF66C4`, `--orange: #FEB421`, `--yellow-soft: #FFECAD`,
  `--cream: #FFF2E2`, `--off-white: #FFF9F5`, `--charcoal: #343133`
- Fonts: Garet / Telegraf / Handelson Three (not bundled — system fallbacks
  in use: Poppins / Inter / Caveat)

## Forms

Both the coming-soon waitlist form (`index.html`) and the therapist interest
form (`therapists.html`) submit to the same Apps Script Web App, which writes
to a Google Sheet.

**Status: live and connected.** The deployment URL is set as `FORM_ENDPOINT`
in `assets/js/main.js`.

Sheet tabs expected:
- `Waitlist` — Timestamp | Phone | Email | SMS Consent
- `Therapist Interest` — Timestamp | Name | Email | States Licensed |
  License Type | Modalities | Notes

If you ever redeploy the Apps Script (new version), update `FORM_ENDPOINT`
with the new URL.

## TODO before public launch

- [ ] **SMS platform**: SMS consent is captured and logged to the Sheet, but
      no SMS provider (Twilio, etc.) is wired up yet for actually sending
      texts. Separate workstream.
- [ ] **Therapists page**: `therapists.html` is built but not linked from the
      coming-soon page. Decide whether/when to surface it.
- [ ] **Favicon / meta images**: Add favicon and Open Graph / social share images.
- [ ] **Analytics**: Add analytics snippet if desired.

## Local development

No build tools needed. Open `index.html` directly in a browser, or serve
locally:

```
python3 -m http.server 8080
```
