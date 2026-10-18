/**
 * Claude (API Anthropic) pour « Qu'est-ce qu'on mange ? » : proposition des menus et adaptation d'une recette.
 * La clé API n'est JAMAIS dans le code : Apps Script → Paramètres du projet →
 * Propriétés du script → ANTHROPIC_API_KEY = sk-ant-…
 *
 * Appels : POST {token, action:'menu_ia', donnees:{soirs, frigo, vite, favoris, recents, consignes, gouts, catalogue}}
 *          POST {token, action:'adapter_ia', donnees:{id, titre, ingredients, frigo, vite, gouts}}
 * Les prompts sont construits ici (pas côté téléphone) : le service ne peut servir qu'à ces deux usages.
 */
const MODELE_IA = 'claude-sonnet-5-5';

const CONSIGNES_IA = [
  "Tu planifies les dîners de la semaine d'une famille : deux parents qui travaillent à l'hôpital et de jeunes enfants.",
  "Ils cuisinent au Thermomix TM7 avec Cookidoo. Tu choisis UNIQUEMENT parmi le catalogue fourni, par identifiant.",
  "Les CONSIGNES DE LA FAMILLE de la semaine passent avant toutes les règles ci-dessous (mais tu restes dans le catalogue).",
  "Respecte aussi les GOÛTS DE LA FAMILLE (aliments refusés, préférences).",
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
    'CONSIGNES DE LA FAMILLE (prioritaires) : ' + (String(d.consignes || '').trim().slice(0, 1000) || 'aucune'),
    'GOÛTS DE LA FAMILLE : ' + ((d.gouts || []).join(' ; ').slice(0, 1500) || 'non renseignés'),
    '',
    'CATALOGUE (id | titre | minutes avant de passer à table | à anticiper | étiquettes | ingrédients principaux) :',
    lignes.join('\n'),
  ].join('\n');
  // réflexion légère : le choix parmi des centaines de plats en profite, sans trop allonger l'attente
  const r = appelClaude_(CONSIGNES_IA, message, { max_tokens: 8000, output_config: { effort: 'low' } });
  if (!r.ok) return r;
  return { ok: true, jours: r.json.jours || [] };
}

/**
 * Appelle Claude et renvoie {ok, json} (le premier objet JSON de la réponse) ou {ok:false, erreur}.
 * reglages : max_tokens et options du modèle (réflexion, effort). Sonnet 5.5 réfléchit par défaut et
 * cette réflexion compte dans max_tokens : prévoir large. Repli automatique d'Anthropic si refus (fallbacks).
 */
function appelClaude_(systeme, message, reglages) {
  const cle = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!cle) return { ok: false, erreur: 'clé API absente (propriété ANTHROPIC_API_KEY)' };
  const rep = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(Object.assign({
      model: MODELE_IA,
      system: systeme,
      messages: [{ role: 'user', content: message }],
      fallbacks: 'default',
    }, reglages)),
  });
  const code = rep.getResponseCode();
  let j;
  try { j = JSON.parse(rep.getContentText()); } catch (e) { return { ok: false, erreur: 'réponse illisible (HTTP ' + code + ')' }; }
  if (code !== 200) return { ok: false, erreur: (j.error && j.error.message) || 'HTTP ' + code };
  const texte = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const m = texte.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, erreur: 'pas de JSON dans la réponse (' + (j.stop_reason || '?') + ') : ' + texte.slice(0, 300) };
  try {
    return { ok: true, json: JSON.parse(m[0]) };
  } catch (e) {
    return { ok: false, erreur: 'JSON invalide' };
  }
}

/* ================= ADAPTER UNE RECETTE (substitutions) =================
   Lit seulement la LISTE D'INGRÉDIENTS (avec quantités) sur la page publique Cookidoo :
   sans connexion, sans rien stocker et sans jamais récupérer les étapes. */
const CONSIGNES_ADAPTER = [
  "Tu aides une famille qui cuisine au Thermomix TM7 à adapter UNE recette Cookidoo à ce qu'elle a et à ses goûts.",
  "Propose 2 à 4 substitutions courtes, uniquement à l'identique : un ingrédient remplacé par un équivalent de même rôle",
  "(même type, quantité comparable), pour utiliser le frigo, les produits à finir vite, ou respecter les goûts.",
  "Ne donne JAMAIS de réglages Thermomix (temps, température, vitesse, sens inverse…) ni d'étapes de préparation.",
  "Si un changement peut modifier la cuisson ou la texture, explique-le brièvement dans « attention » ;",
  "sinon laisse « attention » vide : la recette Cookidoo s'applique alors telle quelle.",
  "Liste aussi les ingrédients de la recette encore manquants (ni au frigo, ni couverts par une substitution),",
  "sans le sel, le poivre, l'eau et l'huile.",
  "Textes courts, en français.",
  'Réponds UNIQUEMENT par du JSON valide : {"substitutions":[{"remplacer":"…","par":"…","quantite":"…","pourquoi":"…","attention":"…"}],"manquants":["…"]}',
].join('\n');

/** Liste d'ingrédients (avec quantités) de la page publique Cookidoo, ou null si la lecture échoue. */
function ingredientsCookidoo_(id) {
  if (!/^r\d+$/.test(String(id || ''))) return null;
  try {
    const rep = UrlFetchApp.fetch('https://cookidoo.fr/recipes/recipe/fr-FR/' + id, {
      muteHttpExceptions: true, followRedirects: true, headers: { 'Accept-Language': 'fr-FR' },
    });
    if (rep.getResponseCode() !== 200) return null;
    const m = rep.getContentText().match(/"recipeIngredient"\s*:\s*(\[[^\]]*\])/);
    if (!m) return null;
    const liste = JSON.parse(m[1]).map(x => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
    return liste.length ? liste : null;
  } catch (e) {
    return null;
  }
}

function adapterIA_(donnees) {
  const d = donnees || {};
  const cookidoo = ingredientsCookidoo_(d.id);
  const ingredients = cookidoo || (d.ingredients || []);
  const message = [
    'RECETTE : ' + String(d.titre || '').slice(0, 200),
    'INGRÉDIENTS' + (cookidoo ? ' (quantités Cookidoo)' : ' principaux') + ' :',
    ingredients.map(x => '- ' + String(x).slice(0, 120)).join('\n'),
    '',
    'À FINIR VITE : ' + ((d.vite || []).join(', ') || 'rien'),
    'FRIGO / PLACARDS : ' + ((d.frigo || []).join(', ') || 'non renseigné'),
    'GOÛTS DE LA FAMILLE : ' + ((d.gouts || []).join(' ; ').slice(0, 1500) || 'non renseignés'),
  ].join('\n');
  // tâche courte : sans réflexion préalable, réponse plus rapide
  const r = appelClaude_(CONSIGNES_ADAPTER, message, { max_tokens: 4000, thinking: { type: 'between_tools' } });
  if (!r.ok) return r;
  const txt = v => String(v || '').slice(0, 300);
  return {
    ok: true,
    source: cookidoo ? 'cookidoo' : 'catalogue',
    substitutions: (r.json.substitutions || []).slice(0, 4).map(x => ({
      remplacer: txt(x.remplacer), par: txt(x.par), quantite: txt(x.quantite), pourquoi: txt(x.pourquoi), attention: txt(x.attention),
    })),
    manquants: (r.json.manquants || []).slice(0, 15).map(txt),
  };
}

/**
 * À lancer une fois depuis l'éditeur (bouton Exécuter) : déclenche l'autorisation Google
 * d'appeler des sites externes (API Anthropic, page publique Cookidoo) et vérifie la clé.
 */
function autoriserIA() {
  const cle = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  UrlFetchApp.fetch('https://cookidoo.fr/', { muteHttpExceptions: true });
  Logger.log(cle ? 'Autorisation OK, clé API trouvée.' : 'Autorisation OK, mais clé API absente.');
}
