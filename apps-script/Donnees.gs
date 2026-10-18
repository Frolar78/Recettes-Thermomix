/**
 * Données partagées de l'app « Qu'est-ce qu'on mange ? » entre nos téléphones.
 * Onglets : Agenda (lecture seule, rempli par la synchro TimeTree), Menu, Courses, Frigo.
 * Même jeton que la synchro (SHEET_TOKEN dans Config.gs, jamais commité).
 *
 * Lecture  : GET  ?token=…                       ou POST {token, action:'lire'}
 * Écriture : POST {token, action:'lot', ops:[{onglet, cle, ligne}|{onglet, cle, suppr:true}]}
 *            chaque op met à jour (ou crée, ou supprime) UNE ligne repérée par sa clé
 *            (1re colonne) : deux téléphones peuvent écrire en même temps sans s'écraser.
 */
const ONGLETS_APP = {
  Menu: ['date', 'id_recette', 'titre', 'statut'],
  Courses: ['article', 'rayon', 'origine', 'coche'],
  Frigo: ['ingredient', 'a_finir_vite'],
};

function jetonOk_(jeton) {
  return typeof SHEET_TOKEN !== 'undefined' && !!SHEET_TOKEN && jeton === SHEET_TOKEN;
}

function doGet(e) {
  if (!jetonOk_(e.parameter.token)) return json_({ ok: false, erreur: 'jeton invalide' });
  return json_(lireTout_());
}

function actionApp_(body) {
  if (body.action === 'lire') return json_(lireTout_());
  if (body.action === 'menu_ia') return json_(menuIA_(body.donnees)); // IA.gs
  if (body.action === 'lot') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      (body.ops || []).forEach(appliquer_);
    } finally {
      lock.releaseLock();
    }
    return json_(lireTout_());
  }
  return json_({ ok: false, erreur: 'action inconnue' });
}

function onglet_(nom) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, ONGLETS_APP[nom].length).setValues([ONGLETS_APP[nom]]);
    sh.getRange('A:Z').setNumberFormat('@');
  }
  return sh;
}

function appliquer_(op) {
  const entetes = ONGLETS_APP[op.onglet];
  if (!entetes || op.cle === undefined || op.cle === '') return;
  const sh = onglet_(op.onglet);
  const cle = String(op.cle);
  const n = sh.getLastRow();
  const cles = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0])) : [];
  const i = cles.indexOf(cle);
  if (op.suppr) {
    if (i >= 0) sh.deleteRow(i + 2);
    return;
  }
  const ligne = entetes.map((k, j) => (j === 0 ? cle : String(op.ligne[k] ?? '')));
  const ligneNo = i >= 0 ? i + 2 : n + 1;
  sh.getRange(ligneNo, 1, 1, entetes.length).setNumberFormat('@').setValues([ligne]);
}

function lignes_(sh, entetes) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, entetes.length).getDisplayValues()
    .filter(r => r[0] !== '')
    .map(r => Object.fromEntries(entetes.map((k, j) => [k, r[j]])));
}

function lireTout_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ag = ss.getSheetByName(ONGLET_AGENDA);
  const out = {
    ok: true,
    agenda: lignes_(ag, ENTETES),
    derniere_synchro: ag ? ag.getRange(2, ENTETES.length + 2).getDisplayValue() : '',
  };
  Object.keys(ONGLETS_APP).forEach(nom => {
    out[nom.toLowerCase()] = lignes_(ss.getSheetByName(nom), ONGLETS_APP[nom]);
  });
  return out;
}
