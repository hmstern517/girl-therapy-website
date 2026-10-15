/**
 * Girl Therapy — SMS Front Desk Bot (Twilio webhook handler)  [Block 1]
 *
 * SCOPE: This bot is "Hannah," the AI-driven front-desk persona from the
 * Girl Therapy Master Flow Document (Block 1 only — warm-up, objection
 * handling, crisis/human routing). It must NEVER run the matchmaking quiz
 * (name, feelings detail, style, personality, quadrant, desired feeling,
 * contact pref) over SMS — that's Block 2, and it now lives in a separate
 * secure AI web chat (see apps-script-secure-chat-webhook.gs +
 * secure-chat.html), reached via a one-time link this bot sends once the
 * user says they're ready. Reason: SMS content transits carrier networks
 * no BAA can cover, so anything feelings/health-adjacent has to happen
 * off that wire, even though the AI itself is scoped not to ask for it.
 *
 * This is a SEPARATE, STANDALONE Apps Script project (see setup notes in
 * apps-script-form-handler.gs for why — one bound script per Sheet).
 *
 * SETUP:
 * 1. In your Sheet, add a tab named exactly "SMS Onboarding" with header:
 *    phone | flow_state | human_mode | history | intake_token |
 *    intake_sent_at | created_at | completed_at
 * 2. Paste the Sheet ID into SHEET_ID below.
 * 3. script.google.com → New project → paste this file in.
 * 4. Project Settings → Script Properties → add:
 *      ALERT_EMAIL          = hannah@girltherapy.co
 *      AI_API_KEY           = (your Anthropic API key — get AI replies)
 *      SECURE_CHAT_BASE_URL = https://girltherapy.co/secure-chat.html
 *        (optional — this is already the default below)
 *      GIRL_THERAPY_VCARD_URL = https://girltherapy.co/assets/girltherapy.vcf
 *        (optional — this is already the default below. The .vcf file lives
 *        at girl-therapy-website/assets/girltherapy.vcf — commit + push it
 *        so GitHub Pages actually serves it before relying on this.)
 * 5. Deploy → New deployment → Web app → Execute as "Me" → Anyone → Deploy.
 * 6. Twilio Console → your number → Messaging → "A message comes in" →
 *    paste the Web App URL → method POST.
 *
 * KNOWN GAPS still open before public launch:
 * - No Twilio request-signature verification (X-Twilio-Signature) yet.
 * - "Voice memo" moments from the original flow doc fall back to a text
 *   message here — no hosted audio file wired up yet for real MMS voice
 *   notes. Swap in a real audio URL + Twilio MMS send once you have one.
 * - AI scope is enforced by prompt instructions + a hard state-machine
 *   intercept (see below), not a technical guarantee. Hard-coded crisis
 *   keyword detection ALWAYS runs before AI and cannot be skipped by it.
 * - Real identifiable answers (even Block 1) shouldn't flow in before the
 *   Workspace BAA is active and Twilio's BAA scope is confirmed. Test with
 *   fake numbers until then.
 * - RESIDUAL RISK, flagging explicitly: Hannah's opening line ("what's on
 *   your mind?") invites some emotionally-loaded disclosure right at the
 *   front door, before any handoff happens — that's inherent to a warm
 *   greeting and not fully avoidable. The system prompt instructs Hannah
 *   to acknowledge in one line WITHOUT probing for detail and pivot
 *   immediately to the matching offer, which limits (but doesn't zero
 *   out) how much sensitive content lands in SMS/AI logs.
 * - vCard delivery depends on the hosting server sending the right
 *   Content-Type (text/vcard) for girltherapy.vcf. GitHub Pages infers it
 *   from the file extension and should get this right, but verify once
 *   live with `curl -I https://girltherapy.co/assets/girltherapy.vcf`. If
 *   a carrier doesn't render it as a tappable "Add Contact" card, it still
 *   arrives as a plain file attachment, which is a harmless degradation.
 */

const SHEET_ID = '1d1ojy0yAYsc788-JP4tIMNSD-6-7T0VTtWvXbfOR38M';
const TAB_NAME = 'SMS Onboarding';

const PROPS = PropertiesService.getScriptProperties();
const ALERT_EMAIL          = PROPS.getProperty('ALERT_EMAIL') || '';
const AI_API_KEY           = PROPS.getProperty('AI_API_KEY') || '';
const AI_ENABLED           = !!AI_API_KEY;
const AI_MODEL              = 'claude-haiku-4-5';
const SECURE_CHAT_BASE_URL = PROPS.getProperty('SECURE_CHAT_BASE_URL') || 'https://girltherapy.co/secure-chat.html';
const GIRL_THERAPY_VCARD_URL = PROPS.getProperty('GIRL_THERAPY_VCARD_URL') || 'https://girltherapy.co/assets/girltherapy.vcf';

// First-ever text from a number gets this sequence, verbatim, no AI
// involved — broken into separate texts on purpose so it reads like a
// person texting in real time instead of one dense auto-reply block. Her
// actual message still gets a real reply on her next text, once the state
// machine picks up from AWAITING_INITIAL_CHOICE below.
//
// Compliance note: STOP/HELP opt-out language is legally required (TCPA +
// CTIA messaging guidelines) and must appear in this first automated
// message a number ever receives. It's folded into WELCOME_TEXT_4 below
// rather than its own text so the sequence still reads human.
const WELCOME_TEXT_1 = "hey girlie! it's Hannah from Girl Therapy 🫶";
const WELCOME_TEXT_2 = "I'm so grateful you texted... definitely save my contact so I don't get lost in your messages";
const WELCOME_TEXT_4 = "want to tell me what's on your mind? (Reply HELP for help, STOP to opt out.)";

// Hard-coded, non-AI-bypassable. Expanded from the Master Flow Doc's CRISIS list.
const CRISIS_KEYWORDS = [
  'suicide', 'suicidal', 'cutting', 'self harm', 'self-harm', 'kill myself',
  'want to die', 'end it', 'end my life', 'ending my life', 'hurt myself',
  'hurting myself', 'overdose', 'suicide attempt', 'attempted suicide',
  "can't go on", 'dont want to live', "don't want to live", 'better off dead',
  'no reason to live', 'abused', 'domestic violence', ' dv ', 'assault'
];

function doPost(e) {
  const params = e.parameter; // Twilio posts form-urlencoded, not JSON
  const from = params.From;
  const body = (params.Body || '').trim();
  const bodyLower = ' ' + body.toLowerCase() + ' ';

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB_NAME);
  const { row, rowIndex, isNew, headers } = findOrCreateRow(sheet, from);

  // --- Rule-based safety gate FIRST. AI never sees this turn if it hits,
  // and neither does the welcome card below — safety always wins. ---
  if (CRISIS_KEYWORDS.some(k => bodyLower.includes(k))) {
    return handleCrisis(sheet, rowIndex, headers, from, body);
  }

  // --- First part of the welcome logic: brand-new number gets the contact
  // card + a general greeting, deterministically, before AI touches it. ---
  if (isNew) {
    return sendWelcomeCard(sheet, rowIndex, headers, body);
  }

  const flowState = row.flow_state || 'NEW_USER';
  const ai = AI_ENABLED ? callHannahAI(flowState, body, row) : null;

  // AI's own crisis flag is a SECOND layer on top of the keyword gate above
  // (defense in depth) — never the only layer.
  if (ai && ai.crisis) {
    return handleCrisis(sheet, rowIndex, headers, from, body);
  }

  if (ai && ai.human_handoff) {
    setCell(sheet, rowIndex, headers, 'human_mode', 'TRUE');
    sendAlert(
      `Girl Therapy SMS: human follow-up suggested (${from})`,
      `Hannah's AI flagged this conversation for human follow-up.\n\nLatest message:\n${body}\n\nNot urgent — just make sure someone checks in.`
    );
  }

  // --- Intercept the transition into Block 2 (the matchmaking quiz). ---
  // The AI decides readiness; the CODE decides where that conversation
  // actually happens. It never happens over SMS.
  if (ai && ai.next_state === 'BLOCK2_NAME') {
    const reply = sendSecureChatLink(sheet, rowIndex, headers, row);
    setCell(sheet, rowIndex, headers, 'flow_state', 'LINK_SENT');
    appendHistory(sheet, rowIndex, headers, body, reply);
    return twiml(reply);
  }

  // --- Normal Block 1 reply ---
  // ai.messages is an array of separate bubbles (the prompt sometimes asks
  // for two, e.g. acknowledgment + the complimentary-session mention) — send
  // each as its own TwiML <Message> so they land as separate texts, same as
  // the welcome sequence, instead of one bubble with a blank line in it.
  const messages = (ai && ai.messages && ai.messages.length) ? ai.messages : [fallbackReply(bodyLower)];
  const reply = messages.map(m => ({ body: m }));
  const replyLog = messages.join('\n\n'); // flattened just for the Sheet history column
  const nextState = (ai && ai.next_state) || flowState;

  setCell(sheet, rowIndex, headers, 'flow_state', nextState);
  appendHistory(sheet, rowIndex, headers, body, replyLog);

  return twiml(reply);
}

// Strips em/en dashes (and spaced hyphens used as dash substitutes) from any
// outgoing text, regardless of whether the AI complied with the no-dash
// voice rule. A deterministic safety net on top of an unreliable LLM.
function sanitizeVoice(text) {
  if (!text) return text;
  return String(text)
    .replace(/\s*[—–]\s*/g, ', ')   // em dash / en dash -> comma
    .replace(/\s+-\s+/g, ', ')      // spaced hyphen used as a dash -> comma
    .replace(/,\s*,/g, ',')         // collapse double commas
    .replace(/\s+,/g, ',');         // tidy stray space before comma
}

function handleCrisis(sheet, rowIndex, headers, from, body) {
  setCell(sheet, rowIndex, headers, 'human_mode', 'URGENT');
  appendHistoryRedacted(sheet, rowIndex, headers, '[EMERGENCY FLAG — see alert email for message content]');
  sendAlert(
    `🚨 URGENT: possible crisis text from ${from}`,
    `A text from ${from} matched a crisis signal.\n\nMessage:\n${body}\n\nThe user was told to contact 988/911. Please follow up directly and promptly.`
  );
  return twiml("I'm really thankful you shared that with me. it sounds like this is a lot to carry alone. Please text or call 988 (Suicide & Crisis Lifeline) right now, or call 911 if you're in immediate danger. I've also alerted our team to follow up with you within 24 hours. 💛");
}

// ---- AI call — Block 1 only. Full persona + state machine from the ----
// ---- Master Flow Document, condensed for prompt efficiency.          ----
function callHannahAI(flowState, message, row) {
  const history = (row.history || '').slice(-1500); // bounded context

  const systemPrompt = `
You are Hannah, founder of Girl Therapy. Not a therapist, not a corporation:
a real woman who discovered therapy changed her life and built a matchmaking
service so other women could find the right therapist without the overwhelm.

VOICE: warm, direct, casual, genuinely excited to help. Like texting a close
friend who knows the best therapists. No corporate or clinical language.
Contractions always. Lowercase generally. ONE THOUGHT PER BUBBLE, NO
EXCEPTIONS: never combine two distinct thoughts into one "messages" array
entry, even if both are short, even if combining them would still read fine
as a paragraph. A real person doesn't send paragraphs over text, she sends a
few quick texts in a row, each one landing a single beat. Judge this by
thought, not strictly by period: a single sentence that's one continuous
idea (e.g. "I feel like when I turned it on to rewatch it wasn't the same")
can stay as one bubble even if it's got a clause or two in it, but the
moment you'd move to a new idea, reaction, or point, that's a new bubble,
even a short one-word lead-in like "also" or a tacked-on reaction like "it
was so scary" gets its own line. So if what you'd say is "X. Y." where X
and Y are separate thoughts, that is ALWAYS messages: ["X", "Y"], never
messages: ["X. Y."]. BE BRIEF: keep each individual bubble short, and keep
the total number of bubbles to only what's natural (usually 1-3), don't pad
it out just to hit a number. Cut the fluff, every bubble should earn its
place. Never use em dashes or en dashes, ever, use a comma or period
instead.

IDENTITY: if she asks directly whether you're a bot, an AI, real, or human,
be honest and warm, do not deny it. Something like "I'm an AI, trained
personally by Hannah (the founder) so you get a caring reply right away. she
built me because she wished something like this existed when she was looking
for a therapist." Don't bring this up unprompted. Never name Claude or
Anthropic. After disclosing, gently continue toward matching her with a
therapist, don't let it derail the conversation.

SCOPE, THIS IS CRITICAL: You only run "Block 1" (warm-up + general
questions). You NEVER ask for her name, never dig into feelings beyond one
warm acknowledgment, never discuss therapist style/personality/quadrant
matching, never collect contact preferences. All of that ("Block 2") happens
later on a separate secure form, your only job is to get her comfortable
and, when she's ready, hand off.

If she shares a feeling or personal situation unprompted, send THREE separate
bubbles, each its own messages[] entry, never merged: (1) acknowledge in ONE
short warm sentence, do NOT ask follow-up questions or probe for detail.
RIGHT-SIZE the acknowledgment to how heavy what she actually said is, don't
inflate something mild/low-key (like "I'm tired") into something dramatic
(like "that sounds really heavy") - match her energy, don't overshoot it.
(2) a separate bubble asking if she wants to get matched with a THERAPIST
(always say "therapist," never generic "someone") from Girl Therapy's vetted
network. (3) a separate bubble mentioning that every therapist does a
complimentary 15-minute get-to-know-you session.

Topics you can discuss freely: what Girl Therapy is, pricing/cost (it's free
to get matched, discount on first session), privacy (answers go straight to
Hannah, never sold, never shared with the therapist roster, delete on STOP),
legitimacy (real person, one-woman-run, personally vets every therapist),
re-matching if a pairing doesn't feel right (free, no questions asked),
general reassurance about therapy hesitancy, and logistics-type questions.

STATES you can be in (track via "Current state" given to you each turn):
- NEW_USER: first message ever. Greet warmly, ask what's on her mind.
- AWAITING_INITIAL_CHOICE: she just got the greeting. If she shared
  feelings/situation: acknowledge briefly (right-sized, see above), offer
  matching with a therapist from the network, and mention the complimentary
  15-minute session, as three separate bubbles (per the three-bubble format
  above), asking if she wants to try it ->
  next_state AWAITING_MATCHMAKING_CONFIRM. If hesitant/asking questions: offer to share
  more about yourself (voice memo or more info) -> next_state HOLDING_BACK.
  If her message has no real content (just "hi"/"hey"/a greeting again, an
  emoji, etc., she didn't actually answer "what's on your mind"): do NOT
  repeat the same greeting question in different words, that reads as the
  bot restarting. Instead give her two concrete things to do next in one
  short line, e.g. "no rush! tell me what's going on, or ask me anything
  about how Girl Therapy works" -> next_state stays AWAITING_INITIAL_CHOICE.
  Always say "Girl Therapy" by name here, never a vague "this"/"it".
- AWAITING_MATCHMAKING_CONFIRM: if affirmative -> next_state "BLOCK2_NAME"
  (do NOT write a handoff message yourself, the system sends its own secure
  link message, just set this next_state and messages can be empty-ish).
  If hesitant -> next_state HOLDING_BACK with a "no worries, want to hear
  more about me or tell me what's holding you back" message.
- HOLDING_BACK: answer her specific concern warmly using the topics above
  (privacy, legitimacy, fit/rematching, cost, specific therapist needs), end
  by asking if she's ready to try it -> next_state AWAITING_MATCHMAKING_CONFIRM.
  If truly unclear, set human_handoff true and give a warm holding reply,
  keep next_state HOLDING_BACK.
- LINK_SENT: she already has her secure intake link. If she asks for it
  again, warmly remind her you sent it and she can tap it anytime. Otherwise
  keep chatting like Block 1. next_state stays LINK_SENT unless she restarts
  with a new question, then treat like HOLDING_BACK.

Current state: ${flowState}
Recent conversation log (for context only): ${history || '(none yet)'}

Respond with ONLY valid JSON, nothing else, in this exact shape:
{
  "messages": ["bubble 1", "bubble 2 if needed"],
  "next_state": "STATE_NAME_EXACTLY_AS_ABOVE_OR_BLOCK2_NAME",
  "human_handoff": false,
  "crisis": false
}
Set "crisis": true ONLY for genuine self-harm/danger signals (this is a
backup check, a stricter keyword filter already runs before you).
`.trim();

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': AI_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }]
      }),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      // Log status + error body (no user message content) so failures are
      // visible in Executions instead of silently falling through forever.
      Logger.log('callHannahAI non-200: ' + code + ' ' + response.getContentText());
      return null;
    }

    const data = JSON.parse(response.getContentText());
    const text = data && data.content && data.content[0] && data.content[0].text;
    if (!text) return null;

    // Model may wrap JSON in prose/code fences despite instructions — extract it.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    Logger.log('callHannahAI exception: ' + err);
    return null; // falls through to fallbackReply()
  }
}

function fallbackReply(bodyLower) {
  if (/\bready\b|\bstart\b|sign me up|match me/.test(bodyLower)) {
    return "Let's do it! One sec...";
  }
  return "hey! it's Hannah from Girl Therapy 💛 ask me anything about pricing, privacy, or how matching works, or reply READY when you want your match. (Reply HELP for help, STOP to opt out.)";
}

// ---- Welcome flow: contact card + general greeting for brand-new numbers ----
function sendWelcomeCard(sheet, rowIndex, headers, incomingBody) {
  const reply = [
    { body: WELCOME_TEXT_1 },
    { body: WELCOME_TEXT_2 },
    { media: GIRL_THERAPY_VCARD_URL },
    { body: WELCOME_TEXT_4 }
  ];
  setCell(sheet, rowIndex, headers, 'flow_state', 'AWAITING_INITIAL_CHOICE');
  appendHistory(sheet, rowIndex, headers, incomingBody, `[welcome sequence sent] ${WELCOME_TEXT_1} || ${WELCOME_TEXT_2} || [vcard] || ${WELCOME_TEXT_4}`);
  return twiml(reply);
}

// ---- Secure chat handoff ----
function sendSecureChatLink(sheet, rowIndex, headers, row) {
  let token = row.intake_token;
  if (!token) {
    token = Utilities.getUuid();
    setCell(sheet, rowIndex, headers, 'intake_token', token);
    setCell(sheet, rowIndex, headers, 'intake_sent_at', new Date());
  }
  const link = `${SECURE_CHAT_BASE_URL}?token=${encodeURIComponent(token)}`;
  return `yay!! here's your private match-making chat, just for you: ${link}\nit's just me (well, me + a little AI help) asking a few fun questions, takes like 5 min 💛`;
}

// ---- Alerting ----
function sendAlert(subject, body) {
  if (!ALERT_EMAIL) return;
  try {
    MailApp.sendEmail(ALERT_EMAIL, subject, body);
  } catch (err) {
    // don't let an email failure break the SMS reply
  }
}

// ---- Sheet helpers ----
function findOrCreateRow(sheet, phone) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const phoneCol = headers.indexOf('phone');

  // Compare as strings — Sheets can silently store a "+1555..." value as a
  // bare number (stripping the +) if the cell isn't explicitly text-
  // formatted, which would otherwise break this match every time.
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][phoneCol]) === String(phone)) {
      return { row: rowToObject(headers, data[i]), rowIndex: i + 1, isNew: false, headers };
    }
  }

  const newRowIndex = sheet.getLastRow() + 1;
  // Force the phone column to plain-text format BEFORE writing, so Sheets
  // doesn't auto-convert "+15551234567" into a number and strip the "+".
  // (Must happen before setValues — reformatting after the fact doesn't
  // undo the conversion, since the "+" is already gone by then.)
  sheet.getRange(newRowIndex, phoneCol + 1).setNumberFormat('@');

  const newRow = headers.map(h => {
    if (h === 'phone') return phone;
    if (h === 'created_at') return new Date();
    if (h === 'flow_state') return 'NEW_USER';
    return '';
  });
  sheet.getRange(newRowIndex, 1, 1, newRow.length).setValues([newRow]);
  return { row: rowToObject(headers, newRow), rowIndex: newRowIndex, isNew: true, headers };
}

function rowToObject(headers, rowArr) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = rowArr[i]; });
  return obj;
}

// headers is passed in from the single read already done in findOrCreateRow
// for this request, instead of each of these re-fetching row 1 on its own
// (that redundant round trip to the Sheets backend was adding real latency
// to every single text, several times over, on top of the AI call itself).
function setCell(sheet, rowIndex, headers, columnName, value) {
  const col = headers.indexOf(columnName) + 1;
  if (col > 0) sheet.getRange(rowIndex, col).setValue(value);
}

function appendHistory(sheet, rowIndex, headers, incoming, outgoing) {
  const col = headers.indexOf('history') + 1;
  const cell = sheet.getRange(rowIndex, col);
  const existing = cell.getValue() || '';
  const stamp = new Date().toISOString();
  cell.setValue(`${existing}\n[${stamp}] IN: ${incoming}\n[${stamp}] OUT: ${outgoing}`.trim());
}

function appendHistoryRedacted(sheet, rowIndex, headers, marker) {
  const col = headers.indexOf('history') + 1;
  const cell = sheet.getRange(rowIndex, col);
  const existing = cell.getValue() || '';
  const stamp = new Date().toISOString();
  cell.setValue(`${existing}\n[${stamp}] ${marker}`.trim());
}

// ---- TwiML response ----
// Accepts either a single reply string (existing call sites) or an array of
// { body, media } parts to send as separate SMS/MMS bubbles in one reply.
function twiml(input) {
  const parts = Array.isArray(input) ? input : [{ body: input }];
  const messages = parts.map(messageXml).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${messages}</Response>`;
  return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.XML);
}

function messageXml(part) {
  const body = part.body ? `<Body>${escapeXml(sanitizeVoice(part.body))}</Body>` : '';
  const media = part.media ? `<Media>${escapeXml(part.media)}</Media>` : '';
  return `<Message>${body}${media}</Message>`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
