#!/usr/bin/env bash
# Prépare le dossier partagé et copie IDENTITY / ROLE / SOUL / skills
# dans l’instance Spacebot si elle existe déjà.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SHARED="${MUN_TRAVAIL:-${HOME}/mun-travail}"
SPACEBOT_DIR="${SPACEBOT_DIR:-}"

if [[ -z "${SPACEBOT_DIR}" ]]; then
  if [[ -d /data/agents ]]; then
    SPACEBOT_DIR=/data
  elif [[ -d "${HOME}/.spacebot/agents" ]]; then
    SPACEBOT_DIR="${HOME}/.spacebot"
  fi
fi

echo "==> Dossier partagé : ${SHARED}"
mkdir -p \
  "${SHARED}/00_inbox" \
  "${SHARED}/01_cadre" \
  "${SHARED}/02_reglements" \
  "${SHARED}/03_projets" \
  "${SHARED}/04_subventions" \
  "${SHARED}/05_communications" \
  "${SHARED}/06_recherche" \
  "${SHARED}/07_livrables/brouillons" \
  "${SHARED}/07_livrables/a_reviser" \
  "${SHARED}/07_livrables/approuves" \
  "${SHARED}/07_livrables/transmis" \
  "${SHARED}/08_modeles" \
  "${SHARED}/09_outils"

if [[ -f "${ROOT}/shared-scaffold/00_index.md" && ! -f "${SHARED}/00_index.md" ]]; then
  cp "${ROOT}/shared-scaffold/00_index.md" "${SHARED}/00_index.md"
fi

copy_agent() {
  local id="$1"
  local dest="${SPACEBOT_DIR}/agents/${id}"
  mkdir -p "${dest}/workspace/skills"
  cp -f "${ROOT}/identity/${id}/SOUL.md" "${dest}/SOUL.md"
  cp -f "${ROOT}/identity/${id}/IDENTITY.md" "${dest}/IDENTITY.md"
  cp -f "${ROOT}/identity/${id}/ROLE.md" "${dest}/ROLE.md"
  cp -R "${ROOT}/profile-skills/mun-fondation" "${dest}/workspace/skills/"
  cp -R "${ROOT}/profile-skills/${id}" "${dest}/workspace/skills/"
  echo "    ${id} -> ${dest}"
}

if [[ -n "${SPACEBOT_DIR}" ]]; then
  echo "==> Instance Spacebot : ${SPACEBOT_DIR}"
  for id in mun-coordination mun-redaction mun-pilotage mun-juridique mun-outils; do
    copy_agent "${id}"
  done
else
  echo "==> Pas d’instance détectée. Dossier partagé créé."
  echo "    Après docker compose up, copier depuis /data/municipal-identity"
fi

echo "==> Terminé."
