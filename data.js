/**
 * data.js — Accès aux données (API Flask locale + API Semantic Scholar)
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

/** Interroge l'API Flask locale (bdd.db) */
async function fetchLocalArticles({ q = "", pays = "", langue = "", sort = "citations", limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (pays) params.set("pays", pays);
  if (langue) params.set("langue", langue);
  if (sort) params.set("sort", sort);
  if (limit) params.set("limit", limit);

  const res = await fetch(`${CONFIG.API_BASE_URL}/api/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Erreur API locale (${res.status})`);
  return res.json();
}

/** Interroge l'API publique Semantic Scholar */
async function fetchSemanticScholar({ q = "", year = "", field = "", limit = 20 } = {}) {
  const params = new URLSearchParams();
  params.set("query", q || "science");
  params.set("limit", String(limit || 20));
  params.set("fields", "title,year,publicationDate,citationCount,authors,fieldsOfStudy,externalIds");
  if (year) params.set("year", `${year}-`);
  if (field) params.set("fieldsOfStudy", field);

  const res = await fetch(`${CONFIG.SEMANTIC_SCHOLAR_BASE}/paper/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Erreur API Semantic Scholar (${res.status})`);
  const data = await res.json();

  // Normalise vers le même format que fetchLocalArticles pour que app.js
  // n'ait pas besoin de distinguer les deux sources.
  const articles = (data.data || []).map((p) => ({
    id: (p.externalIds && p.externalIds.DOI) || p.paperId,
    titre: p.title || "(sans titre)",
    date: p.publicationDate || (p.year ? `${p.year}-01-01` : ""),
    langue: "en",
    citations: p.citationCount || 0,
    auteurs: (p.authors || []).map((a) => ({ nom: a.name, pays: null })),
  }));

  return {
    articles,
    total: data.total || articles.length,
    stats: calculerStatsLocales(articles),
  };
}

/** Recalcule des stats basiques côté client (utilisé pour le mode Semantic Scholar,
 *  qui ne renvoie pas d'agrégats prêts à l'emploi comme l'API locale). */
function calculerStatsLocales(articles) {
  const parMois = {};
  const langues = {};
  const pays = {};
  const auteurs = new Set();

  articles.forEach((a) => {
    if (a.date) {
      const mois = a.date.slice(0, 7);
      parMois[mois] = (parMois[mois] || 0) + 1;
    }
    if (a.langue) langues[a.langue] = (langues[a.langue] || 0) + 1;
    (a.auteurs || []).forEach((au) => {
      auteurs.add(au.nom);
      if (au.pays) pays[au.pays] = (pays[au.pays] || 0) + 1;
    });
  });

  const topCitations = [...articles]
    .sort((a, b) => (b.citations || 0) - (a.citations || 0))
    .slice(0, 10)
    .map((a) => ({ titre: a.titre, citations: a.citations }));

  return {
    par_mois: Object.fromEntries(Object.entries(parMois).sort()),
    top_citations: topCitations,
    langues,
    mots_cles: [],
    pays,
    total_auteurs: auteurs.size,
  };
}
