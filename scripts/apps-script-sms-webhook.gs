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
 */

const SHEET_ID = '1d1ojy0yAYsc788-JP4tIMNSD-6-7T0VTtWvXbfOR38M';
const TAB_NAME = 'SMS Onboarding';

const PROPS = PropertiesService.getScriptProperties();
const ALERT_EMAIL          = PROPS.getProperty('ALERT_EMAIL') || '';
const AI_API_KEY           = PROPS.getProperty('AI_API_KEY') || '';
const AI_ENABLED           = !!AI_API_KEY;
const AI_MODEL              = 'claude-haiku-4-5';
const SECURE_CHAT_BASE_URL = PROPS.getProperty('SECURE_CHAT_BASE_URL') || 'https://girltherapy.co/secure-chat.html';

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
  const { row, rowIndex } = findOrCreateRow(sheet, from);

  // --- Rule-based safety gate FIRST. AI never sees this turn if it hits. ---
  if (CRISIS_KEYWORDS.some(k => bodyLower.includes(k))) {
    return handleCrisis(sheet, rowIndex, from, body);
  }

  const flowState = row.flow_state || 'NEW_USER';
  const ai = AI_ENABLED ? callHannahAI(flowState, body, row) : null;

  // AI's own crisis flag is a SECOND layer on top of the keyword gate above
  // (defense in depth) — never the only layer.
  if (ai && ai.crisis) {
    return handleCrisis(sheet, rowIndex, from, body);
  }

  if (ai && ai.human_handoff) {
    setCell(sheet, rowIndex, 'human_mode', 'TRUE');
    sendAlert(
      `Girl Therapy SMS: human follow-up suggested (${from})`,
      `Hannah's AI flagged this conversation for human follow-up.\n\nLatest message:\n${body}\n\nNot urgent — just make sure someone checks in.`
    );
  }

  // --- Intercept the transition into Block 2 (the matchmaking quiz). ---
  // The AI decides readiness; the CODE decides where that conversation
  // actually happens. It never happens over SMS.
  if (ai && ai.next_state === 'BLOCK2_NAME') {
    const reply = sendSecureChatLink(sheet, rowIndex, row);
    setCell(sheet, rowIndex, 'flow_state', 'LINK_SENT');
    appendHistory(sheet, rowIndex, body, reply);
    return twiml(reply);
  }

  // --- Normal Block 1 reply ---
  const reply = ai
    ? (ai.messages || []).join('\n\n')
    : fallbackReply(bodyLower);
  const nextState = (ai && ai.next_state) || flowState;

  setCell(sheet, rowIndex, 'flow_state', nextState);
  appendHistory(sheet, rowIndex, body, reply);

  return twiml(reply);
}

function handleCrisis(sheet, rowIndex, from, body) {
  setCell(sheet, rowIndex, 'human_mode', 'URGENT');
  appendHistoryRedacted(sheet, rowIndex, '[EMERGENCY FLAG — see alert email for message content]');
  sendAlert(
    `🚨 URGENT: possible crisis text from ${from}`,
    `A text from ${from} matched a crisis signal.\n\nMessage:\n${body}\n\nThe user was told to contact 988/911. Please follow up directly and promptly.`
  );
  return twiml("I'm really thankful you shared that with me — it sounds like this is a lot to carry alone. Please text or call 988 (Suicide & Crisis Lifeline) right now, or call 911 if you're in immediate danger. I've also alerted our team to follow up with you within 24 hours. 💛");
}

// ---- AI call — Block 1 only. Full persona + state machine from the ----
// ---- Master Flow Document, condensed for prompt efficiency.          ----
function callHannahAI(flowState, message, row) {
  const history = (row.history || '').slice(-1500); // bounded context

  const systemPrompt = `
You are Hannah, founder of Girl Therapy. Not a therapist, not a corporation —
a real woman who discovered therapy changed her life and built a matchmaking
service so other women could find the right therapist without the overwhelm.

VOICE: warm, direct, casual, genuinely excited to help. Like texting a close
friend who knows the best therapists. No corporate or clinical language.
Contractions always. Lowercase generally. Short messages, one idea per bubble.
No em dashes. Never mention Claude, AI, or automation. Never break character.

SCOPE — THIS IS CRITICAL: You only run "Block 1" (warm-up + general
questions). You NEVER ask for her name, never dig into feelings beyond one
warm acknowledgment, never discuss therapist style/personality/quadrant
matching, never collect contact preferences. All of that ("Block 2") happens
later on a separate secure form — your only job is to get her comfortable
and, when she's ready, hand off.

If she shares a feeling or personal situation unprompted: acknowledge in ONE
short warm sentence, do NOT ask follow-up questions or probe for detail, then
pivot to asking if she wants to get matched with a therapist (mention Girl
Therapy's vetted network + an exclusive first-session discount).

Topics you can discuss freely: what Girl Therapy is, pricing/cost (it's free
to get matched, discount on first session), privacy (answers go straight to
Hannah, never sold, never shared with the therapist roster, delete on STOP),
legitimacy (real person, one-woman-run, personally vets every therapist),
re-matching if a pairing doesn't feel right (free, no questions asked),
general reassurance about therapy hesitancy, and logistics-type questions.

STATES you can be in (track via "Current state" given to you each turn):
- NEW_USER: first message ever. Greet warmly, ask what's on her mind.
- AWAITING_INITIAL_CHOICE: she just got the greeting. If she shared
  feelings/situation: acknowledge briefly, offer matching with the
  network+discount, ask if she wants to try it -> next_state
  AWAITING_MATCHMAKING_CONFIRM. If hesitant/asking questions: offer to share
  more about yourself (voice memo or more info) -> next_state HOLDING_BACK.
- AWAITING_MATCHMAKING_CONFIRM: if affirmative -> next_state "BLOCK2_NAME"
  (do NOT write a handoff message yourself, the system sends its own secure
  link message — just set this next_state and messages can be empty-ish).
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
backup check — a stricter keyword filter already runs before you).
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
  return "hey! it's Hannah from Girl Therapy 💛 ask me anything about pricing, privacy, or how matching works — or reply READY when you want your match. (Reply HELP for help, STOP to opt out.)";
}

// ---- Secure chat handoff ----
function sendSecureChatLink(sheet, rowIndex, row) {
  let token = row.intake_token;
  if (!token) {
    token = Utilities.getUuid();
    setCell(sheet, rowIndex, 'intake_token', token);
    setCell(sheet, rowIndex, 'intake_sent_at', new Date());
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
      return { row: rowToObject(headers, data[i]), rowIndex: i + 1 };
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
  return { row: rowToObject(headers, newRow), rowIndex: newRowIndex };
}

function rowToObject(headers, rowArr) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = rowArr[i]; });
  return obj;
}

function setCell(sheet, rowIndex, columnName, value) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(columnName) + 1;
  if (col > 0) sheet.getRange(rowIndex, col).setValue(value);
}

function appendHistory(sheet, rowIndex, incoming, outgoing) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf('history') + 1;
  const cell = sheet.getRange(rowIndex, col);
  const existing = cell.getValue() || '';
  const stamp = new Date().toISOString();
  cell.setValue(`${existing}\n[${stamp}] IN: ${incoming}\n[${stamp}] OUT: ${outgoing}`.trim());
}

function appendHistoryRedacted(sheet, rowIndex, marker) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf('history') + 1;
  const cell = sheet.getRange(rowIndex, col);
  const existing = cell.getValue() || '';
  const stamp = new Date().toISOString();
  cell.setValue(`${existing}\n[${stamp}] ${marker}`.trim());
}

// ---- TwiML response ----
function twiml(message) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return ContentService.createTextOutput(xml).setMimeType(ContentService.MimeType.XML);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
