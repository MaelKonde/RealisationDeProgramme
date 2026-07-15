"""
Nom........ : api_flask.py
Description : Renvoie les données de la base de données par le biais d'une API Flask
"""

import os
import sqlite3

from flask import Flask, jsonify
from flask_cors import CORS

application = Flask(__name__)

# Autorise le front-end (hébergé sur un autre sous-domaine .onrender.com,
# ou en local) à appeler cette API.
CORS(application)


def connecter_bdd():
    connexion = sqlite3.connect("bdd.db")
    connexion.row_factory = sqlite3.Row
    return connexion


@application.route("/health")
def health():
    """Utilisé par Render pour vérifier que le service est prêt (healthCheckPath)."""
    return jsonify({"status": "ok"})


@application.route("/articles/<int:limite>")
def liste_articles(limite):
    connexion = connecter_bdd()
    curseur = connexion.cursor()

    curseur.execute("""
        SELECT id, titre, date, langue, citations
        FROM articles
        ORDER BY date DESC
        LIMIT ?
    """, (limite,))

    lignes = curseur.fetchall()
    connexion.close()

    articles = [
        {
            "id": ligne["id"],
            "titre": ligne["titre"],
            "date": ligne["date"],
            "langue": ligne["langue"],
            "citations": ligne["citations"]
        }
        for ligne in lignes
    ]

    return jsonify(articles)


@application.route("/auteurs/<id_article>")
def liste_auteurs(id_article):
    connexion = connecter_bdd()
    curseur = connexion.cursor()

    curseur.execute("""
        SELECT nom, pays
        FROM auteurs
        WHERE id_article = ?
    """, (id_article,))

    lignes = curseur.fetchall()
    connexion.close()

    auteurs = [
        {
            "nom": ligne["nom"],
            "pays": ligne["pays"]
        }
        for ligne in lignes
    ]

    return jsonify(auteurs)


if __name__ == "__main__":
    # Utilisé uniquement en local (`python3 api_flask.py`).
    # En production sur Render, c'est gunicorn qui démarre l'app (voir render.yaml).
    port = int(os.environ.get("PORT", 5000))
    application.run(host="0.0.0.0", port=port, debug=True)
