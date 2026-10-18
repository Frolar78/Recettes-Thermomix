/**
 * Proposition de menus par Claude (API Anthropic) pour « Qu'est-ce qu'on mange ? ».
 * La clé API n'est JAMAIS dans le code : Apps Script → Paramètres du projet →
 * Propriétés du script → ANTHROPIC_API_KEY = sk-ant-…
 *
 * Appel : POST {token, action:'menu_ia', donnees:{soirs, frigo, vite, favoris, recents, catalogue}}
 * Le prompt est construit ici (pas côté téléphone) : le service ne peut servir qu'à proposer des menus.
 */
const MODELE_IA = 'claude-sonnet-5-5';

const CONSIGNES_IA = [
  "Tu planifies les dîners de la semaine d'une famille : deux parents qui travaillent à l'hôpital et de jeunes enfants.",
  "Ils cuisinent au Thermomix TM7 avec Cookidoo. Tu choisis UNIQUEMENT parmi le catalogue fourni, par identifiant.",
  "Règles, par ordre d'importance :",
  "1. Soir « presse » : plat de 25 min maximum, sans attente. Soir « garde » : plat qui se prépare la veille ou se congèle.",
  "2. Utiliser en priorité les produits « à finir vite », puis le reste du frigo.",
  "3. Varier : pas deux soirs de suite la même famille (poisson, viande, œufs, pâtes/riz, soupe, légumes), pas plus de deux soupes.",
  "4. Pas de plat déjà servi récemment. Favoris bienvenus, plats adaptés aux enfants appréciés.",
  "5. En semaine, préférer les plats de moins d'1 h ; les plats longs ou à anticiper plutôt le week-end.",
  "Pour chaque soir, une raison courte (6 à 10 mots) en français, sans majuscule initiale superflue.",
  'Réponds UNIQUEMENT par du JSON valide : {"jours":[{"date":"AAAA-MM-JJ","id":"r…","raison":"…"}]}',
].join('\n');

function menuIA_(donnees) {
  const cle = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!cle) return { ok: false, erreur: 'clé API absente (propriété ANTHROPIC_API_KEY)' };
  const d = donnees || {};
  const lignes = (d.catalogue || []).map(c => c.join(' | '));
  const message = [
    'SOIRS À PLANIFIER (date | jour | type | événements) :',
    (d.soirs || []).map(s => [s.date, s.jour, s.type, s.evenements || '—'].join(' | ')).join('\n'),
    '',
    'À FINIR VITE : ' + ((d.vite || []).join(', ') || 'rien'),
    'FRIGO / PLACARDS : ' + ((d.frigo || []).join(', ') || 'non renseigné'),
    'FAVORIS : ' + ((d.favoris || []).join(', ') || 'aucun'),
    'SERVIS RÉCEMMENT (à éviter) : ' + ((d.recents || []).join(', ') || 'aucun'),
    '',
    'CATALOGUE (id | titre | minutes avant de passer à table | à anticiper | étiquettes | ingrédients principaux) :',
    lignes.join('\n'),
  ].join('\n');

  const rep = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: MODELE_IA,
      max_tokens: 1500,
      system: CONSIGNES_IA,
      messages: [{ role: 'user', content: message }],
    }),
  });
  const code = rep.getResponseCode();
  let j;
  try { j = JSON.parse(rep.getContentText()); } catch (e) { return { ok: false, erreur: 'réponse illisible (HTTP ' + code + ')' }; }
  if (code !== 200) return { ok: false, erreur: (j.error && j.error.message) || 'HTTP ' + code };
  const texte = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const m = texte.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, erreur: 'pas de JSON dans la réponse' };
  try {
    return { ok: true, jours: JSON.parse(m[0]).jours || [] };
  } catch (e) {
    return { ok: false, erreur: 'JSON invalide' };
  }
}
