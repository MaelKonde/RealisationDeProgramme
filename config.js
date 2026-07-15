/**
 * config.js — Configuration globale du front-end "Veille Scientifique"
 * Charger en premier (avant data.js et app.js).
 */
const CONFIG = {
  // URL de l'API Flask déployée sur Render.
  // ⚠️ À adapter avec le vrai nom du service une fois déployé
  // (visible dans le dashboard Render : https://<nom-du-service>.onrender.com)
  API_BASE_URL: "https://veille-scientifique-api.onrender.com",

  // API publique utilisée en mode "🔌 API Semantic Scholar"
  SEMANTIC_SCHOLAR_BASE: "https://api.semanticscholar.org/graph/v1",

  DEFAULT_LIMIT: 20,

  // Petite palette réutilisée pour les graphiques (barres, cloud, carte)
  ACCENT: "#c9963a",
  ACCENT_SOFT: "rgba(201,150,58,.35)",
};
