/**
 * data.js — Accès à l'API Flask ("Tendances Scientifiques")
 * Charger après config.js et avant app.js.
 */

/** Table pays : code alpha-2 -> { nom, numeric } (code numérique ISO utilisé par world-atlas) */
const PAYS_INFO = {
  FR: { nom: "France", numeric: "250" },
  US: { nom: "États-Unis", numeric: "840" },
  CN: { nom: "Chine", numeric: "156" },
  DE: { nom: "Allemagne", numeric: "276" },
  GB: { nom: "Royaume-Uni", numeric: "826" },
  IT: { nom: "Italie", numeric: "380" },
  JP: { nom: "Japon", numeric: "392" },
  ES: { nom: "Espagne", numeric: "724" },
  CH: { nom: "Suisse", numeric: "756" },
  IN: { nom: "Inde", numeric: "356" },
  CA: { nom: "Canada", numeric: "124" },
  AU: { nom: "Australie", numeric: "036" },
  BR: { nom: "Brésil", numeric: "076" },
  KR: { nom: "Corée du Sud", numeric: "410" },
  NL: { nom: "Pays-Bas", numeric: "528" },
  SE: { nom: "Suède", numeric: "752" },
  BE: { nom: "Belgique", numeric: "056" },
  RU: { nom: "Russie", numeric: "643" },
  SG: { nom: "Singapour", numeric: "702" },
  IL: { nom: "Israël", numeric: "376" },
  AT: { nom: "Autriche", numeric: "040" },
  DK: { nom: "Danemark", numeric: "208" },
  FI: { nom: "Finlande", numeric: "246" },
  NO: { nom: "Norvège", numeric: "578" },
  PL: { nom: "Pologne", numeric: "616" },
  PT: { nom: "Portugal", numeric: "620" },
  MX: { nom: "Mexique", numeric: "484" },
  ZA: { nom: "Afrique du Sud", numeric: "710" },
  TR: { nom: "Turquie", numeric: "792" },
  IE: { nom: "Irlande", numeric: "372" },
  GR: { nom: "Grèce", numeric: "300" },
  TW: { nom: "Taïwan", numeric: "158" },
  SA: { nom: "Arabie Saoudite", numeric: "682" },
  NZ: { nom: "Nouvelle-Zélande", numeric: "554" },
  EG: { nom: "Égypte", numeric: "818" },
  AR: { nom: "Argentine", numeric: "032" },
  CZ: { nom: "Tchéquie", numeric: "203" },
};

function nomPays(code) {
  return (PAYS_INFO[code] && PAYS_INFO[code].nom) || code;
}

async function requeteJson(chemin, params) {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(`${CONFIG.API_BASE_URL}${chemin}${qs}`);
  if (!res.ok) {
    let message = `Erreur API (${res.status})`;
    try {
      const corps = await res.json();
      if (corps && corps.error) message = corps.error;
    } catch (_) {
      /* réponse non-JSON, on garde le message par défaut */
    }
    throw new Error(message);
  }
  return res.json();
}

const fetchMois = () => requeteJson("/api/mois");

const fetchMotsCles = (mois = "") => requeteJson("/api/mots-cles", mois ? { mois } : {});

const fetchPays = () => requeteJson("/api/pays");

const fetchEvolution = (mot) => requeteJson("/api/evolution", { mot });

const fetchArticlesTop = (mot, limit = 20) =>
  requeteJson("/api/articles-top", mot ? { mot, limit } : { limit });

const fetchSuggestions = () => requeteJson("/api/suggestions");

const fetchStatsGlobales = () => requeteJson("/api/stats-globales");
