/**
 * Reçoit les événements TimeTree envoyés chaque nuit par GitHub Actions
 * et les écrit dans l'onglet « Agenda » du Google Sheet.
 * Le jeton est dans Config.gs (const SHEET_TOKEN), jamais commité sur GitHub.
 */
const ONGLET_AGENDA = 'Agenda';
const ENTETES = ['date', 'date_fin', 'debut', 'fin', 'journee', 'titre', 'lieu'];

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (typeof SHEET_TOKEN === 'undefined' || !SHEET_TOKEN || body.token !== SHEET_TOKEN) {
    return json_({ ok: false, erreur: 'jeton invalide' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ONGLET_AGENDA) || ss.insertSheet(ONGLET_AGENDA);
  const lignes = body.evenements.map(ev => ENTETES.map(k => ev[k] ?? ''));

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sh.clearContents();
    sh.getRange(1, 1, 1, ENTETES.length).setValues([ENTETES]);
    if (lignes.length) {
      // texte brut : évite que Sheets transforme dates et heures
      sh.getRange(2, 1, lignes.length, ENTETES.length).setNumberFormat('@').setValues(lignes);
    }
    sh.getRange(1, ENTETES.length + 2).setValue('derniere_synchro');
    sh.getRange(2, ENTETES.length + 2).setNumberFormat('@').setValue(body.synchro);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, nb: lignes.length });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
