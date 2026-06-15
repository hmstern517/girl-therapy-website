# Girl Therapy — girltherapy.org

Waitlist site for Girl Therapy, a telehealth therapy platform built exclusively
for women, by women. Operated by Finally Therapy, LLC.

## Stack

Static HTML / CSS / JS. No build step. Deploy as-is to GitHub Pages, Netlify,
Vercel, or any static host.

## Structure

```
index.html             Home page
therapists.html        For Therapists (recruitment) page
assets/css/style.css   Design tokens + all styles
assets/js/main.js      Nav toggle, scroll reveal, form handling
```

## Design system

Colors, type, and spacing are defined as CSS variables at the top of
`assets/css/style.css`:

- `--pink: #FF66C4`, `--orange: #FEB421`, `--yellow-soft: #FFECAD`,
  `--cream: #FFF2E2`, `--off-white: #FFF9F5`, `--charcoal: #343133`
- Fonts: **Garet** (headings), **Telegraf** (body), **Handelson Three** (accent/script)

## TODO before launch

- [ ] **Fonts**: Garet, Telegraf, and Handelson Three are licensed fonts not
      bundled in this repo. Add font files to `assets/fonts/` and update the
      `@font-face` declarations in `style.css` (currently using system font
      fallbacks: Poppins / Inter / Caveat).
- [ ] **Photos**: Hero, brand-moment, and other sections use CSS gradient
      placeholders (`.photo-placeholder` classes). Swap these for real
      photography from the brand book — see inline `aria-label`s for what
      each photo should depict.
- [ ] **Forms**: Apps Script handler is ready at `scripts/apps-script-form-handler.gs`.
      To activate:
      1. Create a Google Sheet with tabs `Waitlist` (Timestamp | Phone | Email |
         SMS Consent) and `Therapist Interest` (Timestamp | Name | Email |
         States Licensed | License Type | Modalities | Notes)
      2. Paste the script into Extensions → Apps Script, deploy as a Web App
         (Execute as: Me, Access: Anyone)
      3. Paste the deployment URL into `FORM_ENDPOINT` in `assets/js/main.js`
      Until `FORM_ENDPOINT` is set, forms show a success message but don't
      submit anywhere — fine for early sharing, just don't rely on it for
      real signups yet.
- [ ] **SMS platform**: An SMS consent checkbox is on the waitlist form, but
      no SMS provider (Twilio, etc.) is wired up yet — this only logs consent
      to the Sheet. Connecting actual text-sending is a separate workstream.
- [ ] **Social links**: Footer social icons are placeholders (`href="#"`).
      Update with real Instagram / TikTok / Pinterest URLs.
- [ ] **Favicon / meta images**: Add favicon and Open Graph / social share images.
- [ ] **Analytics**: Add analytics snippet if desired.

## Local development

No build tools needed. Open `index.html` directly in a browser, or serve
locally:

```
python3 -m http.server 8080
```
