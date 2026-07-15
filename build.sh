#!/usr/bin/env bash
set -e

echo "==> Installation des dépendances Python..."
pip install -r requirements.txt

echo "==> Récupération de la base de données (bdd.db, ~1 Go) depuis GitHub Releases..."
python download_db.py

echo "==> Build terminé."
