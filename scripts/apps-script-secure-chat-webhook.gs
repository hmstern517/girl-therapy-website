/**
 * Girl Therapy — Secure Matchmaking Chat (Block 2 backend)
 *
 * Powers secure-chat.html. This is where the REAL quiz from the Master
 * Flow Document lives now — name, feelings, therapist style, personality,
 * quadrant, what she needs most, desired feeling, contact preference.
 * Reached only via a one-time token the SMS front-desk bot (Hannah) sends
 * once a user says she's ready. Runs over HTTPS to infrastructure you
 * control, NOT over SMS carrier rails — that's the whole point of the split.
 *
 * STANDALONE Apps Script project — separate deployment from the SMS bot.
 *
 * SETUP:
 * 1. In the SAME Sheet as the SMS bot, add a tab named exactly
 *    "Secure Intake" with header:
 *    token | phone | flow_state | name | feeling_raw | feeling_keyword |
 *    style_pref | approach_pref | personality | quadrant_type |
 *    need_most | desired_feeling | contact_preference | human_mode |
 *    history | created_at | completed_at
 *    RECOMMENDATION: once this is past test mode, move this tab to its
 *    own Sheet with tighter sharing (fewer editors) than the general
 *    waitlist sheet — this tab is where real health-adjacent content
 *    will actually live.
 * 2. Paste the same Sheet ID into SHEET_ID below.
 * 3. script.google.com → New project → paste this file in.
 * 4. Script Properties → add ALERT_EMAIL = hannah@girltherapy.co
 *    (same value as the SMS bot's property, separate project though).
 * 5. Deploy → New deployment → Web app → Execute as "Me" → Anyone → Deploy.
 * 6. Copy the Web App URL into CHAT_ENDPOINT in secure-chat.html.
 *
 * KNOWN GAPS:
 * - No token expiry yet — tokens are one-per-phone-number and reusable
 *   indefinitely. Fine for beta; add an expiry check (e.g. 7 days from
 *   intake_sent_at) before public launch.
 * - This quiz content is deterministic (not AI-generated) by design —
 *   it's a fixed sequence, so a state machine is cheaper/faster/more
 *   reliable than an LLM call per turn. Can swap in AI-generated
 *   reflections later (e.g. "it sounds like anxiety has been following
 *   you around lately...") if you want more warmth here too.
 * - Real identifiable answers shouldn't flow in before the Workspace BAA
 *   is active. Test with fake tokens/answers until then.
 */

const SHEET_ID = '1d1ojy0yAYsc788-JP4tIMNSD-6-7T0VTtWvXbfOR38M';
const SMS_TAB_NAME = 'SMS Onboarding';
const CHAT_TAB_NAME = 'Secure Intake';

const PROPS = PropertiesService.getScriptProperties();
const ALERT_EMAIL = PROPS.getProperty('ALERT_EMAIL') || '';

const QUADRANT_IMAGE_URL  = 'https://girltherapy.co/assets/images/quadrant-chart.png';
const NEED_MOST_IMAGE_URL = 'https://girltherapy.co/assets/images/need-most.png';

const CRISIS_KEYWORDS = [
  'suicide', 'suicidal', 'cutting', 'self harm', 'self-harm', 'kill myself',
  'want to die', 'end it', 'end my life', 'ending my life', 'hurt myself',
  'hurting myself', 'overdose', 'suicide attempt', 'attempted suicide',
  "can't go on", 'dont want to live', "don't want to live", 'better off dead',
  'no reason to live', 'abused', 'domestic violence', ' dv ', 'assault'
];

const FEELING_LEXICON = [
  'anxious', 'anxiety', 'stressed', 'overwhelmed', 'burnt out', 'burnout',
  'exhausted', 'tired', 'lonely', 'alone', 'isolated', 'hopeless', 'lost',
  'stuck', 'confused', 'angry', 'sad', 'depressed', 'numb', 'disconnected',
  'insecure', 'ashamed', 'scared', 'afraid', 'worried', 'panicked', 'empty'
];

function doPost(e) {
  const payload = JSON.parse(e.postData.contents); // frontend sends JSON as text/plain to dodge CORS preflight
  const token = (payload.token || '').trim();
  const message = (payload.message || '').trim();
  const messageLower = ' ' + message.toLowerCase() + ' ';

  if (!token) return jsonOut({ error: 'missing_token' });

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const smsSheet = ss.getSheetByName(SMS_TAB_NAME);
  const chatSheet = ss.getSheetByName(CHAT_TAB_NAME);

  const phone = findPhoneByToken(smsSheet, token);
  if (!phone) return jsonOut({ error: 'invalid_token' });

  const { row, rowIndex, isNew } = findOrCreateChatRow(chatSheet, token, phone);

  if (message && CRISIS_KEYWORDS.some(k => messageLower.includes(k))) {
    appendHistoryRedacted(chatSheet, rowIndex, '[EMERGENCY FLAG — see alert email for message content]');
    setCell(chatSheet, rowIndex, 'human_mode', 'URGENT');
    sendAlert(
      `🚨 URGENT: possible crisis message in secure chat (${phone})`,
      `A message in the secure intake chat (token ${token}, phone ${phone}) matched a crisis signal.\n\nMessage:\n${message}\n\nThe user was told to contact 988/911. Please follow up directly and promptly.`
    );
    return jsonOut({
      messages: ["I'm really thankful you shared that with me. it sounds like this is a lot to carry alone. Please text or call 988 (Suicide & Crisis Lifeline) right now, or call 911 if you're in immediate danger. I've also alerted our team to follow up with you within 24 hours. 💛"],
      complete: false
    });
  }

  const flowState = isNew ? 'NAME' : (row.flow_state || 'NAME');
  const result = advanceBlock2(flowState, message, row);

  setCell(chatSheet, rowIndex, 'flow_state', result.nextState);
  Object.keys(result.updates || {}).forEach(key => setCell(chatSheet, rowIndex, key, result.updates[key]));
  appendHistory(chatSheet, rowIndex, message, result.messages.join(' / '));

  if (result.nextState === 'COMPLETE') {
    setCell(chatSheet, rowIndex, 'completed_at', new Date());
    sendAlert(
      `🎉 Secure intake completed (${phone})`,
      `A new matchmaking intake just finished.\nToken: ${token}\nPhone: ${phone}\n\nCheck the "Secure Intake" tab to review and make the match.`
    );
  }

  return jsonOut({
    messages: result.messages,
    media_url: result.mediaUrl || null,
    complete: result.nextState === 'COMPLETE'
  });
}

// ---- Block 2 state machine — matches the Master Flow Document ----
function advanceBlock2(flowState, message, row) {
  switch (flowState) {
    case 'NAME':
      if (!message) {
        // first load — no message yet, just the opening question
        return { nextState: 'NAME', messages: ["let's find you your dream therapist so you can feel calm, happy and spiral-free... first, what should I call you?"] };
      }
      return {
        nextState: 'FEELING',
        updates: { name: message },
        messages: [`okay ${message}... what's been going on lately? what are you feeling?`]
      };

    case 'FEELING': {
      const keyword = FEELING_LEXICON.find(w => message.toLowerCase().includes(w)) || '';
      return {
        nextState: 'STYLE_RELATION',
        updates: { feeling_raw: message, feeling_keyword: keyword },
        messages: [
          "thank you for sharing that with me 🫶",
          "do you want someone who feels like a friend, or a relationship with a bit more structure... like a coach or mentor?"
        ]
      };
    }

    case 'STYLE_RELATION': {
      const styleRaw = message.toLowerCase();
      const style = styleRaw.includes('coach') || styleRaw.includes('structure') || styleRaw.includes('mentor') ? 'COACH' : 'FRIEND';
      const prompt = style === 'FRIEND'
        ? "when you're venting to a friend, do you like it when she's gentle and supportive, or gives you tough love?"
        : "do you like it when someone's gentle and supportive, or gives you a little tough love?";
      return {
        nextState: 'STYLE_APPROACH',
        updates: { style_pref: style },
        messages: [prompt]
      };
    }

    case 'STYLE_APPROACH': {
      const approach = /tough/i.test(message) ? 'TOUGH_LOVE' : 'GENTLE';
      return {
        nextState: 'PERSONALITY',
        updates: { approach_pref: approach },
        messages: ["would you say you're more type A (disciplined and driven) or type B (easygoing and flexible)?"]
      };
    }

    case 'PERSONALITY': {
      const personality = /\btype a\b|\ba\b/i.test(message) && !/\btype b\b/i.test(message) ? 'TYPE_A' : (/\btype b\b|\bb\b/i.test(message) ? 'TYPE_B' : 'TYPE_A');
      return {
        nextState: 'QUADRANT',
        updates: { personality },
        messages: ["which girl are you?? reply a, b, c, or d"],
        mediaUrl: QUADRANT_IMAGE_URL
      };
    }

    case 'QUADRANT': {
      const map = { a: 'WELLNESS_GIRL', b: 'THAT_GIRL', c: 'MESSY_GIRL', d: 'ARTSY_GIRL' };
      const choice = (message.trim()[0] || '').toLowerCase();
      const quadrant = map[choice] || 'NOT_SURE';
      const flavor = {
        WELLNESS_GIRL: "she's wellness girlie 🧘 you set the pace for everyone around you, and it's exhausting to always be the one holding it together.",
        THAT_GIRL: "she's that girl 💫 the cool girl of the friend group, but your go-go-go energy can turn to burnout in a blink.",
        MESSY_GIRL: "she's a little extra ⚡ you cope with humor and chaos and honestly it works until it doesn't.",
        ARTSY_GIRL: "she's clean and sophisticated 🤍 you look polished on the outside while quietly spiraling on the inside.",
        NOT_SURE: "totally okay not to be sure yet, we'll figure it out together."
      }[quadrant];
      return {
        nextState: 'NEED_MOST',
        updates: { quadrant_type: quadrant },
        messages: [flavor, "which do you need most rn? left or right?"],
        mediaUrl: NEED_MOST_IMAGE_URL
      };
    }

    case 'NEED_MOST': {
      const need = /right/i.test(message) ? 'right' : 'left';
      return {
        nextState: 'DESIRED_FEELING',
        updates: { need_most: need },
        messages: ["how do you want to feel after your first appointment with your Girl Therapist?"]
      };
    }

    case 'DESIRED_FEELING':
      return {
        nextState: 'CONTACT',
        updates: { desired_feeling: message },
        messages: ["last one! is the number you texted from the best way to reach you when I have a therapist I think you'd love?"]
      };

    case 'CONTACT': {
      const yes = /^y|yes|yeah|yep|sure/i.test(message.trim());
      return {
        nextState: 'COMPLETE',
        updates: { contact_preference: yes ? 'Text (same number)' : message },
        messages: ["thank you soooo much for having a heart to heart with me!!! I'll use all of this to match you with a Girl Therapist who gets you and loop back in 2 days or less. you might feel stuck now, but momentum is on its way, I'm here for you girlie ♥️"]
      };
    }

    case 'COMPLETE':
    default:
      return {
        nextState: 'COMPLETE',
        messages: ["you're all set 💛 our team has everything and will reach out within 2 days with your match. if anything changes before then, just text Hannah back on your phone!"]
      };
  }
}

// ---- Token lookup against the SMS bot's sheet ----
function findPhoneByToken(smsSheet, token) {
  const data = smsSheet.getDataRange().getValues();
  const headers = data[0];
  const tokenCol = headers.indexOf('intake_token');
  const phoneCol = headers.indexOf('phone');
  for (let i = 1; i < data.length; i++) {
    if (data[i][tokenCol] === token) return data[i][phoneCol];
  }
  return null;
}

// ---- Chat sheet helpers ----
function findOrCreateChatRow(sheet, token, phone) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tokenCol = headers.indexOf('token');

  for (let i = 1; i < data.length; i++) {
    if (data[i][tokenCol] === token) {
      return { row: rowToObject(headers, data[i]), rowIndex: i + 1, isNew: false };
    }
  }

  const newRow = headers.map(h => {
    if (h === 'token') return token;
    if (h === 'phone') return phone;
    if (h === 'created_at') return new Date();
    if (h === 'flow_state') return 'NAME';
    return '';
  });
  sheet.appendRow(newRow);
  return { row: rowToObject(headers, newRow), rowIndex: sheet.getLastRow(), isNew: true };
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

function sendAlert(subject, body) {
  if (!ALERT_EMAIL) return;
  try {
    MailApp.sendEmail(ALERT_EMAIL, subject, body);
  } catch (err) {
    // don't let an email failure break the chat response
  }
}

// ---- JSON response, with permissive CORS for the browser frontend ----
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
