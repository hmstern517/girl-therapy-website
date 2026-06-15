/**
 * Girl Therapy — Form → Google Sheet handler
 *
 * SETUP:
 * 1. Open your Google Sheet ("Girl Therapy — Waitlist & Therapist Leads")
 * 2. Extensions → Apps Script
 * 3. Delete any starter code, paste this in
 * 4. Click "Deploy" → "New deployment"
 *    - Type: "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone"
 * 5. Click "Deploy", authorize when prompted
 * 6. Copy the Web App URL — send it back to Claude to wire up the site forms
 *
 * Expects two tabs in this Sheet, with header rows already in place:
 *   "Waitlist"           -> Timestamp | Phone | Email | SMS Consent
 *   "Therapist Interest" -> Timestamp | Name | Email | States Licensed | License Type | Modalities | Notes
 */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const formType = data.formType;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timestamp = new Date();

    if (formType === 'waitlist') {
      const sheet = ss.getSheetByName('Waitlist');
      sheet.appendRow([
        timestamp,
        data.phone || '',
        data.email || '',
        data.smsConsent === 'on' ? 'Yes' : 'No'
      ]);
    } else if (formType === 'therapist') {
      const sheet = ss.getSheetByName('Therapist Interest');
      sheet.appendRow([
        timestamp,
        data.name || '',
        data.email || '',
        data.states || '',
        data.license || '',
        data.modalities || '',
        data.notes || ''
      ]);
    } else {
      return jsonResponse({ success: false, error: 'Unknown form type' });
    }

    return jsonResponse({ success: true });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
