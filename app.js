/**
 * app.js — Logique de "Tendances Scientifiques"
 * Charger en dernier (après config.js et data.js — d3/topojson sont déjà
 * chargés via les <script> dans le <head> de index.html).
 * Fonctions globales requises par les attributs onclick de index.html :
 * resetMapZoom, traceEvolution, resetArticles, exportArticlesCSV, selectionnerMois.
 */

let dernierArticlesTop = [];
let comptesParPaysActuel = {};
let motsParPaysActuel = {};
let zoomD3 = null;
let gCarte = null;

/* ---------------------------------------------------------------- */
/* Utilitaires                                                       */
/* ---------------------------------------------------------------- */

function echapperHtml(texte) {
  const div = document.createElement("div");
  div.textContent = texte == null ? "" : String(texte);
  return div.innerHTML;
}

function echapperAttribut(texte) {
  return String(texte).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function afficherToast(message, duree = 3000) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(afficherToast._timer);
  afficherToast._timer = setTimeout(() => toast.classList.remove("show"), duree);
}

function barreHorizontale(label, valeur, max) {
  const largeur = max > 0 ? Math.max(4, Math.round((valeur / max) * 100)) : 0;
  return `
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0;">
      <div style="width:120px;font-size:12px;opacity:.8;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${echapperHtml(label)}
      </div>
      <div style="flex:1;background:rgba(160,130,90,.12);border-radius:6px;height:10px;overflow:hidden;">
        <div style="width:${largeur}%;height:100%;background:${CONFIG.ACCENT};border-radius:6px;"></div>
      </div>
      <div style="width:44px;text-align:right;font-size:12px;opacity:.75;">${valeur}</div>
    </div>`;
}

/* ---------------------------------------------------------------- */
/* Bandeau de statistiques globales                                  */
/* ---------------------------------------------------------------- */

async function loadStatsGlobales() {
  const container = document.getElementById("statStrip");
  if (!container) return;
  try {
    const data = await fetchStatsGlobales();
    container.style.display = "flex";
    container.innerHTML = [
      { label: "Articles", valeur: data.total_articles },
      { label: "Citations cumulées", valeur: data.total_citations },
      { label: "Pays représentés", valeur: data.total_pays },
      { label: "Mois couverts", valeur: data.total_mois },
    ]
      .map(
        (s) => `
        <div style="padding:.6rem 1rem;border:1px solid rgba(160,130,90,.25);border-radius:10px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.6;">${s.label}</div>
          <div style="font-family:'Playfair Display',serif;font-size:1.4rem;font-weight:700;">${s.valeur}</div>
        </div>`
      )
      .join("");
  } catch (err) {
    console.error(err);
  }
}

/* ---------------------------------------------------------------- */
/* Nuage de mots-clés par mois                                       */
/* ---------------------------------------------------------------- */

async function loadMonthPills() {
  const container = document.getElementById("monthPills");
  if (!container) return;
  try {
    const data = await fetchMois();
    const mois = data.mois || [];

    const rendrePille = (valeur, libelle, actif) => `
      <button class="month-pill${actif ? " active" : ""}" data-mois="${valeur}"
        onclick="selectionnerMois('${valeur}')"
        style="padding:5px 12px;border-radius:999px;border:1px solid rgba(160,130,90,.3);
        background:${actif ? CONFIG.ACCENT : "transparent"};color:${actif ? "#fff" : "inherit"};
        font-size:12px;cursor:pointer;margin:3px;">${echapperHtml(libelle)}</button>`;

    container.innerHTML =
      rendrePille("", "Tous les mois", true) + mois.map((m) => rendrePille(m, m, false)).join("");
  } catch (err) {
    console.error(err);
    afficherToast("Impossible de charger la liste des mois");
  }
}

function selectionnerMois(mois) {
  document.querySelectorAll(".month-pill").forEach((bouton) => {
    const actif = bouton.dataset.mois === mois;
    bouton.style.background = actif ? CONFIG.ACCENT : "transparent";
    bouton.style.color = actif ? "#fff" : "inherit";
  });
  loadMotsCles(mois);
}

async function loadMotsCles(mois) {
  const cloud = document.getElementById("cloudMain");
  if (!cloud) return;
  cloud.innerHTML = `<p style="opacity:.6;font-size:13px;">Chargement…</p>`;
  try {
    const data = await fetchMotsCles(mois);
    const mots = data.mots || [];
    if (mots.length === 0) {
      cloud.innerHTML = `<p style="opacity:.6;font-size:13px;">Aucun mot-clé pour cette période.</p>`;
      return;
    }
    const maxPoids = Math.max(...mots.map((m) => m.poids));
    cloud.innerHTML = mots
      .map((m) => {
        const taille = 13 + Math.round((m.poids / maxPoids) * 22);
        const opacite = (0.55 + 0.45 * (m.poids / maxPoids)).toFixed(2);
        return `<span onclick="traceEvolution('${echapperAttribut(m.mot)}')"
          style="display:inline-block;margin:5px 8px;font-size:${taille}px;opacity:${opacite};
          color:${CONFIG.ACCENT};font-weight:600;cursor:pointer;">${echapperHtml(m.mot)}</span>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    cloud.innerHTML = `<p style="opacity:.6;font-size:13px;">Erreur de chargement.</p>`;
  }
}

/* ---------------------------------------------------------------- */
/* Carte mondiale (bulles proportionnelles au volume par pays)       */
/* ---------------------------------------------------------------- */

async function loadPaysEtCarte() {
  try {
    const data = await fetchPays();
    comptesParPaysActuel = {};
    motsParPaysActuel = {};
    (data.pays || []).forEach((p) => {
      comptesParPaysActuel[p.code] = p.total;
      motsParPaysActuel[p.code] = p.mots;
    });
    await dessinerCarteBulles();
  } catch (err) {
    console.error(err);
    afficherToast("Impossible de charger la carte des pays");
  }
}

async function dessinerCarteBulles() {
  const svgEl = document.getElementById("worldMapSvg");
  if (!svgEl || typeof d3 === "undefined" || typeof topojson === "undefined") return;

  const largeur = 960;
  const hauteur = 500;

  let monde;
  try {
    monde = await fetch("https://unpkg.com/world-atlas@2/countries-110m.json").then((r) => r.json());
  } catch (err) {
    console.error("Fond de carte indisponible :", err);
    return;
  }

  const pays = topojson.feature(monde, monde.objects.countries).features;
  const projection = d3.geoNaturalEarth1().fitSize([largeur, hauteur], { type: "Sphere" });
  const chemin = d3.geoPath(projection);

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  gCarte = svg.append("g");

  gCarte
    .append("path")
    .attr("d", chemin({ type: "Sphere" }))
    .attr("fill", "rgba(160,130,90,.05)")
    .attr("stroke", "rgba(160,130,90,.2)");

  gCarte
    .selectAll("path.pays-fond")
    .data(pays)
    .join("path")
    .attr("d", chemin)
    .attr("fill", "rgba(160,130,90,.08)")
    .attr("stroke", "rgba(20,15,10,.35)")
    .attr("stroke-width", 0.4);

  const numeriqueVersAlpha2 = {};
  Object.entries(PAYS_INFO).forEach(([alpha2, info]) => {
    numeriqueVersAlpha2[String(Number(info.numeric))] = alpha2;
  });

  const bulles = pays
    .map((f) => {
      const alpha2 = numeriqueVersAlpha2[String(Number(f.id))];
      const total = alpha2 ? comptesParPaysActuel[alpha2] : 0;
      if (!alpha2 || !total) return null;
      const centre = chemin.centroid(f);
      if (!centre || Number.isNaN(centre[0])) return null;
      return { alpha2, total, x: centre[0], y: centre[1], nom: f.properties.name };
    })
    .filter(Boolean);

  const maxTotal = Math.max(1, ...bulles.map((b) => b.total));
  const rayon = d3.scaleSqrt().domain([0, maxTotal]).range([3, 26]);

  const tooltip = document.getElementById("mapTooltip");
  const conteneurCarte = document.getElementById("mapContainer");

  gCarte
    .selectAll("circle.bulle")
    .data(bulles)
    .join("circle")
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", (d) => rayon(d.total))
    .attr("fill", CONFIG.ACCENT_SOFT)
    .attr("stroke", CONFIG.ACCENT)
    .attr("stroke-width", 1)
    .style("cursor", "pointer")
    .on("mouseenter", (event, d) => {
      if (!tooltip) return;
      tooltip.style.opacity = "1";
      tooltip.textContent = `${d.nom} — ${d.total} article(s)`;
    })
    .on("mousemove", (event) => {
      if (!tooltip || !conteneurCarte) return;
      const rect = conteneurCarte.getBoundingClientRect();
      tooltip.style.left = `${event.clientX - rect.left + 12}px`;
      tooltip.style.top = `${event.clientY - rect.top + 12}px`;
    })
    .on("mouseleave", () => {
      if (tooltip) tooltip.style.opacity = "0";
    })
    .on("click", (event, d) => afficherPaysDansSidebar(d.alpha2, d.nom, d.total));

  zoomD3 = d3
    .zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => gCarte.attr("transform", event.transform));

  svg.call(zoomD3);
}

function resetMapZoom() {
  if (!zoomD3) return;
  const svg = d3.select("#worldMapSvg");
  svg.transition().duration(400).call(zoomD3.transform, d3.zoomIdentity);
}

function afficherPaysDansSidebar(alpha2, nom, total) {
  const titre = document.getElementById("sidebarTitle");
  const barres = document.getElementById("sidebarBars");
  if (titre) titre.textContent = `${nom} · ${total} article(s)`;
  if (!barres) return;

  const mots = motsParPaysActuel[alpha2] || [];
  if (mots.length === 0) {
    barres.innerHTML = `<p style="font-size:12px;color:var(--text-3);">Pas assez de données pour ce pays.</p>`;
    return;
  }
  const max = Math.max(...mots.map((m) => m.poids));
  barres.innerHTML = mots.map((m) => barreHorizontale(m.mot, m.poids, max)).join("");
}

/* ---------------------------------------------------------------- */
/* Évolution temporelle d'un mot-clé                                 */
/* ---------------------------------------------------------------- */

async function traceEvolution(mot) {
  if (!mot) return;
  const input = document.getElementById("evoInput");
  if (input) input.value = mot;

  const label = document.getElementById("evoLabel");
  const chart = document.getElementById("evoChart");
  const note = document.getElementById("evoNote");

  if (label) label.textContent = `Évolution de « ${mot} »`;
  if (chart) chart.innerHTML = `<p style="opacity:.6;font-size:13px;">Chargement…</p>`;

  try {
    const data = await fetchEvolution(mot);
    const serie = data.serie || [];

    if (chart) {
      if (serie.length === 0) {
        chart.innerHTML = `<p style="opacity:.6;font-size:13px;">Pas de données.</p>`;
      } else {
        const max = Math.max(1, ...serie.map((s) => s.poids));
        chart.innerHTML =
          `<div style="display:flex;align-items:flex-end;gap:4px;height:100%;">` +
          serie
            .map((s) => {
              const h = Math.max(2, Math.round((s.poids / max) * 100));
              return `<div title="${echapperHtml(s.mois)} : ${s.poids}"
                style="flex:1;height:${h}%;background:${CONFIG.ACCENT};border-radius:3px 3px 0 0;min-width:4px;"></div>`;
            })
            .join("") +
          `</div>`;
      }
    }
    if (note) note.textContent = "Basé sur un échantillon des articles les plus cités par mois.";

    const sub = document.getElementById("articlesSub");
    if (sub) sub.textContent = `Articles contenant le mot-clé « ${mot} »`;
    const resetBtn = document.getElementById("resetArticlesBtn");
    if (resetBtn) resetBtn.style.display = "inline-block";

    await loadArticlesTop(mot);
  } catch (err) {
    console.error(err);
    afficherToast("Erreur lors du calcul de l'évolution");
  }
}

function resetArticles() {
  const input = document.getElementById("evoInput");
  if (input) input.value = "";

  const label = document.getElementById("evoLabel");
  if (label) label.textContent = "Saisissez un mot-clé ci-dessus ou cliquez sur le nuage.";

  const chart = document.getElementById("evoChart");
  if (chart) chart.innerHTML = "";

  const note = document.getElementById("evoNote");
  if (note) note.textContent = "";

  const resetBtn = document.getElementById("resetArticlesBtn");
  if (resetBtn) resetBtn.style.display = "none";

  const sub = document.getElementById("articlesSub");
  if (sub) sub.textContent = "Sélection des articles à fort impact · cliquez sur un mot du nuage pour filtrer";

  loadArticlesTop(null);
}

/* ---------------------------------------------------------------- */
/* Articles les plus cités                                           */
/* ---------------------------------------------------------------- */

async function loadArticlesTop(mot) {
  const container = document.getElementById("topArticlesList");
  if (!container) return;
  container.innerHTML = `<p style="opacity:.6;font-size:13px;">Chargement…</p>`;

  try {
    const data = await fetchArticlesTop(mot, 20);
    dernierArticlesTop = data.articles || [];

    if (dernierArticlesTop.length === 0) {
      container.innerHTML = `<p style="opacity:.6;font-size:13px;">Aucun article trouvé.</p>`;
      return;
    }
    container.innerHTML = dernierArticlesTop.map(rendreArticleCard).join("");
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p style="opacity:.6;font-size:13px;">Erreur de chargement.</p>`;
  }
}

function urlArticle(id) {
  if (!id) return null;
  const valeur = String(id).trim();
  if (/^https?:\/\//i.test(valeur)) return valeur; // déjà une URL complète
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(valeur)) return `https://arxiv.org/abs/${valeur}`; // arXiv moderne (YYMM.NNNNN)
  if (/^[a-z-]+\/\d{7}$/i.test(valeur)) return `https://arxiv.org/abs/${valeur}`; // arXiv ancien format
  if (/^W\d+$/i.test(valeur)) return `https://openalex.org/${valeur}`; // ID OpenAlex (Wxxxxxxxxx)
  return `https://openalex.org/${valeur}`; // repli par défaut
}

function pilluleStyle(fond, bordure, couleurTexte) {
  return `display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;
    font-size:11.5px;font-weight:500;background:${fond};border:1px solid ${bordure};color:${couleurTexte};
    white-space:nowrap;`;
}

function urlArxivRecherche(titre) {
  return `https://arxiv.org/search/?searchtype=title&query=${encodeURIComponent(titre || "")}`;
}

function rendreArticleCard(a) {
  const lien = urlArticle(a.id);
  const titreHtml = lien
    ? `<a href="${echapperHtml(lien)}" target="_blank" rel="noopener noreferrer"
        style="color:inherit;text-decoration:none;">${echapperHtml(a.titre)} <span style="font-size:.7em;opacity:.5;">↗</span></a>`
    : echapperHtml(a.titre);

  const auteursNoms = (a.auteurs || []).slice(0, 6).map((au) => au.nom).filter(Boolean);
  const plusAuteurs = (a.auteurs || []).length > 6 ? ` +${(a.auteurs || []).length - 6}` : "";
  const ligneAuteurs = auteursNoms.length
    ? `<div style="font-size:13px;opacity:.75;margin:.2rem 0 .55rem;">${echapperHtml(auteursNoms.join(", "))}${plusAuteurs}</div>`
    : "";

  const paysUniques = [...new Set((a.auteurs || []).map((au) => au.pays).filter(Boolean))];

  const pillulesMeta = [
    `<span style="${pilluleStyle("rgba(90,140,200,.12)", "rgba(90,140,200,.3)", "inherit")}">📅 ${echapperHtml(a.date || "date inconnue")}</span>`,
    `<span style="${pilluleStyle("rgba(201,150,58,.12)", "rgba(201,150,58,.35)", CONFIG.ACCENT)}">⭐ ${a.citations || 0} citation(s)</span>`,
    ...paysUniques.map(
      (code) => `<span style="${pilluleStyle("rgba(160,130,90,.1)", "rgba(160,130,90,.3)", "inherit")}">${echapperHtml(code)}</span>`
    ),
  ].join(" ");

  const pillulesLiens = [
    lien
      ? `<a href="${echapperHtml(lien)}" target="_blank" rel="noopener noreferrer"
          style="${pilluleStyle("rgba(160,130,90,.08)", "rgba(160,130,90,.3)", "inherit")}text-decoration:none;">🔗 OpenAlex</a>`
      : "",
    `<a href="${echapperHtml(urlArxivRecherche(a.titre))}" target="_blank" rel="noopener noreferrer"
        style="${pilluleStyle("rgba(160,130,90,.08)", "rgba(160,130,90,.3)", "inherit")}text-decoration:none;">📄 arXiv</a>`,
  ].join(" ");

  const pillulesMots = (a.mots_cles || [])
    .map(
      (mot) => `<span onclick="traceEvolution('${echapperAttribut(mot)}')"
        style="${pilluleStyle("rgba(201,150,58,.08)", "rgba(201,150,58,.3)", CONFIG.ACCENT)}cursor:pointer;">${echapperHtml(mot)}</span>`
    )
    .join(" ");

  return `
    <article style="padding:1.1rem 1.2rem;margin-bottom:.9rem;border:1px solid rgba(160,130,90,.18);border-radius:14px;">
      <h3 style="font-family:'Playfair Display',serif;font-size:1.08rem;margin:0 0 .2rem;line-height:1.35;">
        ${titreHtml}
      </h3>
      ${ligneAuteurs}
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:.55rem;">${pillulesMeta}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:.55rem;">${pillulesLiens}</div>
      ${pillulesMots ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${pillulesMots}</div>` : ""}
    </article>`;
}

function exportArticlesCSV() {
  if (dernierArticlesTop.length === 0) {
    afficherToast("Rien à exporter pour le moment");
    return;
  }
  const entetes = ["id", "titre", "date", "langue", "citations", "auteurs"];
  const lignes = dernierArticlesTop.map((a) => {
    const auteurs = (a.auteurs || []).map((au) => au.nom).join(" | ");
    return [a.id, a.titre, a.date, a.langue, a.citations, auteurs]
      .map((val) => `"${String(val ?? "").replace(/"/g, '""')}"`)
      .join(",");
  });
  const csv = [entetes.join(","), ...lignes].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tendances_scientifiques_export.csv";
  a.click();
  URL.revokeObjectURL(url);
  afficherToast("Export CSV téléchargé");
}

/* ---------------------------------------------------------------- */
/* Suggestions de mots-clés                                          */
/* ---------------------------------------------------------------- */

async function loadSuggestions() {
  const container = document.getElementById("evoSuggestions");
  if (!container) return;
  try {
    const data = await fetchSuggestions();
    const mots = data.suggestions || [];
    container.innerHTML = mots
      .map(
        (m) => `<span onclick="traceEvolution('${echapperAttribut(m)}')"
          style="padding:4px 10px;border:1px solid rgba(160,130,90,.3);border-radius:999px;
          font-size:12px;cursor:pointer;">${echapperHtml(m)}</span>`
      )
      .join("");
  } catch (err) {
    console.error(err);
  }
}

/* ---------------------------------------------------------------- */
/* Animation étoiles du hero (canvas)                                */
/* ---------------------------------------------------------------- */

function initEtoiles() {
  const canvas = document.getElementById("starCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let etoiles = [];

  function redimensionner() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const nb = Math.floor((canvas.width * canvas.height) / 9000);
    etoiles = Array.from({ length: nb }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.4 + 0.2,
      phase: Math.random() * Math.PI * 2,
      vitesse: 0.005 + Math.random() * 0.01,
    }));
  }

  function animer(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    etoiles.forEach((e) => {
      const scintillement = 0.5 + 0.5 * Math.sin(t * e.vitesse + e.phase);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245,239,230,${0.15 + 0.6 * scintillement})`;
      ctx.fill();
    });
    requestAnimationFrame(animer);
  }

  window.addEventListener("resize", redimensionner);
  redimensionner();
  requestAnimationFrame(animer);
}

/* ---------------------------------------------------------------- */
/* Initialisation                                                    */
/* ---------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  initEtoiles();
  loadStatsGlobales();
  loadMonthPills();
  loadMotsCles("");
  loadPaysEtCarte();
  loadArticlesTop(null);
  loadSuggestions();
});
