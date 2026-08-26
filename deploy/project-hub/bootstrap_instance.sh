#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_DIR="${ROOT_DIR}/instance"
SHARED_WORKSPACE="${INSTANCE_DIR}/shared-workspace"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Erreur : copiez .env.example vers .env puis renseignez OPENROUTER_API_KEY et PROJECT_HUB_MEMORY_DB_PASSWORD." >&2
  exit 1
fi

mkdir -p \
  "${INSTANCE_DIR}/agents" \
  "${INSTANCE_DIR}/approved-skill-overlays" \
  "${INSTANCE_DIR}/skill-install-authorizations" \
  "${SHARED_WORKSPACE}/00_systeme/propositions_capacites" \
  "${SHARED_WORKSPACE}/00_systeme/scripts" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/propositions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/propositions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/runs" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/reference-miner" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/approval-bridge/promotions" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/failure-remediator/proposals" \
  "${SHARED_WORKSPACE}/00_systeme/optimisation/failure-remediator/audits" \
  "${SHARED_WORKSPACE}/01_sources/00_inbox" \
  "${SHARED_WORKSPACE}/01_sources/01_references" \
  "${SHARED_WORKSPACE}/01_sources/02_donnees" \
  "${SHARED_WORKSPACE}/01_sources/03_documents" \
  "${SHARED_WORKSPACE}/02_recherche/01_questions" \
  "${SHARED_WORKSPACE}/02_recherche/02_preuves" \
  "${SHARED_WORKSPACE}/02_recherche/03_options" \
  "${SHARED_WORKSPACE}/03_planification/01_objectifs" \
  "${SHARED_WORKSPACE}/03_planification/02_plan_travail" \
  "${SHARED_WORKSPACE}/03_planification/03_jalons_risques" \
  "${SHARED_WORKSPACE}/04_analyse/01_methodes" \
  "${SHARED_WORKSPACE}/04_analyse/02_donnees" \
  "${SHARED_WORKSPACE}/04_analyse/03_calculs_reproductibles" \
  "${SHARED_WORKSPACE}/05_automatisation/01_scripts" \
  "${SHARED_WORKSPACE}/05_automatisation/02_tests" \
  "${SHARED_WORKSPACE}/05_automatisation/03_resultats" \
  "${SHARED_WORKSPACE}/06_communications/01_notes" \
  "${SHARED_WORKSPACE}/06_communications/02_brouillons" \
  "${SHARED_WORKSPACE}/06_communications/03_revisions" \
  "${SHARED_WORKSPACE}/07_livrables/00_reference" \
  "${SHARED_WORKSPACE}/07_livrables/01_brouillons" \
  "${SHARED_WORKSPACE}/07_livrables/02_revue_qualite" \
  "${SHARED_WORKSPACE}/07_livrables/03_approuves" \
  "${SHARED_WORKSPACE}/07_livrables/04_transmis" \
  "${SHARED_WORKSPACE}/08_archives/01_versions_remplacees" \
  "${SHARED_WORKSPACE}/08_archives/02_non_admissibles" \
  "${SHARED_WORKSPACE}/08_archives/03_exports_journaux" \
  "${SHARED_WORKSPACE}/temp"

cp "${ROOT_DIR}/config.toml.example" "${INSTANCE_DIR}/config.toml"
chmod 600 "${INSTANCE_DIR}/config.toml"

rm -rf "${INSTANCE_DIR}/skills"
cp -R "${ROOT_DIR}/skills" "${INSTANCE_DIR}/skills"
cp --update=none "${ROOT_DIR}/document-studio/taxonomy.json" "${SHARED_WORKSPACE}/00_systeme/taxonomie_documentaire.json"
cp --update=none "${ROOT_DIR}/optimizer/fixtures/reference_cases.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/reference_cases.template.json"
cp --update=none "${ROOT_DIR}/skillopt/fixtures/skillopt_reference_pack.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/skillopt/skillopt_reference_pack.template.json"
cp --update=none "${ROOT_DIR}/reference-miner/fixtures/reference_mining_policy.template.json" "${SHARED_WORKSPACE}/00_systeme/optimisation/reference-miner/reference_mining_policy.template.json"

write_profile() {
  local agent_id="$1"
  local display_name="$2"
  local role="$3"
  local soul="$4"
  local profile_skills="$5"
  local role_dir="${INSTANCE_DIR}/agents/${agent_id}"

  mkdir -p "${role_dir}/workspace/skills"
  rm -rf "${role_dir}/workspace/skills"/*
  for skill in ${profile_skills}; do
    cp -R "${ROOT_DIR}/profile-skills/${skill}" "${role_dir}/workspace/skills/"
  done

  local overlay_dir="${INSTANCE_DIR}/approved-skill-overlays/${agent_id}"
  if [[ -d "${overlay_dir}" ]]; then
    for overlay_skill in "${overlay_dir}"/*; do
      [[ -d "${overlay_skill}" ]] || continue
      rm -rf "${role_dir}/workspace/skills/$(basename "${overlay_skill}")"
      cp -R "${overlay_skill}" "${role_dir}/workspace/skills/"
    done
  fi

  printf '%s\n' "${profile_skills}" > "${role_dir}/workspace/PROFILE_SKILLS.txt"
  cat > "${role_dir}/IDENTITY.md" <<EOF
# Identité

**Nom :** ${display_name}

**Nature :** Agent spécialisé de l’instance Spacebot d’assistance adaptative aux tâches.
EOF
  cat > "${role_dir}/SOUL.md" <<EOF
# Principes de travail

${soul}

Utiliser la mémoire locale pour les conversations propres au profil. Utiliser le registre partagé PostgreSQL + pgvector comme source commune des faits, décisions, risques, jalons, sources et livrables vérifiables. Avant une conclusion importante, rechercher ce registre; après un résultat vérifiable, l’y enregistrer avec les références de source.
EOF
  cat > "${role_dir}/ROLE.md" <<EOF
# Mandat

${role}

## Exigences permanentes

Répondre dans la langue de la demande lorsque possible. Ne jamais inventer une donnée, une approbation, un coût, un calcul ou un statut. Citer le document, la date, l’onglet ou l’enregistrement source lorsque l’information influence une décision. Signaler les écarts, lacunes, conflits et hypothèses.

Le profil peut analyser, planifier, rechercher, rédiger, programmer, tester et faire évoluer automatiquement le code local, les compétences, les dépendances déclarées, les fichiers Docker et les déclarations MCP lorsque la modification suit le protocole d’auto-évolution : provenance identifiée, sauvegarde, validation automatisée, journal d’audit et retour arrière. Toute transmission externe, publication, engagement, dépense, suppression irréversible, utilisation ou divulgation de secret, changement de permission ou accès à une ressource externe non fournie exige une approbation humaine explicite.

## Échanges interagents

Utiliser les liens de la topologie pour confier les analyses utiles. Transmettre une demande structurée, le résultat attendu, les sources disponibles, l’échéance et les critères de vérification. À la clôture, consigner une synthèse vérifiable dans le registre partagé et conclure avec les décisions, risques et prochaines étapes.
EOF
}

write_profile \
  "task-orchestrator" \
  "Orchestrateur adaptatif" \
  "Comprendre les demandes, choisir un mode de travail proportionné, créer le plan, déléguer aux expertises utiles, consolider, évaluer la qualité et lancer les prochaines tâches nécessaires." \
  "Viser un résultat final clair et vérifiable. Adapter la délégation au besoin réel plutôt qu’à un rôle rigide, en préservant la mémoire, les preuves et le coût d’exécution." \
  "project-coordination project-planning-governance project-analysis project-reporting project-document-studio project-supervised-optimization project-skillopt-learning project-reference-case-mining project-failure-learning project-python-workbench task-adaptive-orchestration task-autonomous-execution task-self-evaluation task-safe-self-improvement"

write_profile \
  "task-research" \
  "Chercheur et analyste de sources" \
  "Rechercher des sources fiables, extraire les faits, qualifier les incertitudes, comparer les options et produire des dossiers de preuves réutilisables." \
  "Distinguer les faits, interprétations, sources primaires, hypothèses et données manquantes. Préférer les sources d’autorité et conserver les chemins de preuve." \
  "project-analysis project-reporting project-document-studio project-failure-learning project-python-workbench task-source-research task-self-evaluation"

write_profile \
  "task-planning" \
  "Planificateur et gestionnaire d’exécution" \
  "Découper les objectifs, organiser les dépendances, suivre les jalons, risques, blocages et prochaines actions, puis replanifier lorsqu’une preuve nouvelle le justifie." \
  "Faire émerger le plus petit prochain pas utile. Chaque relance doit différer explicitement de la tentative précédente lorsqu’un échec est connu." \
  "project-planning-governance project-reporting project-document-studio project-failure-learning project-python-workbench task-adaptive-orchestration task-autonomous-execution task-self-evaluation"

write_profile \
  "task-analysis" \
  "Analyste de données et de raisonnement" \
  "Traiter les données, construire des méthodes reproductibles, effectuer des calculs, détecter les incohérences et expliciter les limites de conclusion." \
  "Conserver les unités, méthodes, sources, hypothèses, versions et tests. Préférer un résultat reproductible à une affirmation non vérifiable." \
  "project-analysis project-document-studio project-failure-learning project-python-workbench task-self-evaluation"

write_profile \
  "task-automation" \
  "Ingénieur d’automatisation" \
  "Concevoir, écrire, tester, documenter et classer des scripts ou outils locaux réversibles nécessaires à la tâche." \
  "Réutiliser d’abord les capacités existantes. Créer des scripts testables et documentés; ne modifier aucun système, accès ou dépendance sans approbation." \
  "project-python-workbench project-analysis project-document-studio project-failure-learning task-autonomous-execution task-self-evaluation"

write_profile \
  "task-writing" \
  "Rédacteur de livrables" \
  "Préparer des documents, synthèses, procédures, notes, présentations de travail et brouillons de communication à partir des preuves disponibles." \
  "Rédiger avec structure, précision et traçabilité. Ne jamais transformer une hypothèse ou un brouillon en information confirmée." \
  "project-reporting project-document-studio project-analysis project-failure-learning project-python-workbench task-self-evaluation"

write_profile \
  "task-review" \
  "Réviseur critique" \
  "Vérifier les critères de réussite, sources, calculs, omissions, contradictions, limites, preuves de test et clarté avant la clôture d’une tâche." \
  "Adopter une posture contradictoire constructive : chercher les erreurs probables, les conditions non satisfaites et le plus petit test qui pourrait invalider une conclusion." \
  "project-reporting project-analysis project-document-studio project-failure-learning project-python-workbench task-self-evaluation"

write_profile \
  "task-learning" \
  "Analyste d’apprentissage et de qualité" \
  "Transformer les tâches terminées et échecs dépersonnalisés en cas de référence, comparer les résultats, exécuter les évaluations DSPy ou SkillOpt autorisées et préparer des améliorations ciblées." \
  "Mesurer une amélioration avant de la proposer. Respecter les partitions, les plafonds de coût, la dépersonnalisation et la distinction entre candidate, validation et promotion." \
  "project-supervised-optimization project-skillopt-learning project-reference-case-mining project-failure-learning project-analysis project-reporting project-python-workbench task-safe-self-improvement task-self-evaluation"

cat > "${SHARED_WORKSPACE}/README.md" <<'EOF'
# Espace documentaire commun — Assistance adaptative aux tâches

La structure numérotée est la référence de classement. Déposer les nouvelles pièces dans `01_sources/00_inbox/`, puis utiliser la taxonomie `00_systeme/taxonomie_documentaire.json` et l’outil `classify_workspace_document` pour les déplacer vers un dossier autorisé. Les versions de travail, révisions, livrables approuvés et éléments transmis vont respectivement dans `07_livrables/01_brouillons/`, `07_livrables/02_revue_qualite/`, `07_livrables/03_approuves/` et `07_livrables/04_transmis/`.

Les agents peuvent préparer des recherches, plans, analyses, scripts testables, documents et propositions de suivi de façon autonome. La mémoire partagée doit consigner les références, hypothèses, résultats, tests, limites et prochaines étapes, afin que chaque nouveau cycle s’appuie sur les résultats précédents plutôt que de recommencer.

Ne jamais placer de clés API, mots de passe ou documents non autorisés dans cet espace. Toute transmission externe, publication, engagement, changement de configuration ou promotion d’apprentissage reste conditionnée à l’approbation humaine dans l’interface.

Le mineur de références ne lit que les enregistrements partagés `approved`, `completed=true` et `learning_eligible=true`. La remédiation lit seulement les résumés de tentatives durables; elle dépersonnalise, déduplique et crée une leçon candidate. Les compétences approuvées sont conservées sous `instance/approved-skill-overlays/`; les autorisations de téléchargement externes restent sous `instance/skill-install-authorizations/`.
EOF

cat > "${INSTANCE_DIR}/README-local.md" <<'EOF'
# Données locales de l’instance d’assistance adaptative

Ce répertoire persistant, exclu de Git, contient la configuration Spacebot, profils, compétences approuvées, données de travail et journaux. Sauvegarder ce répertoire avec les volumes PostgreSQL selon les règles applicables à l’organisation responsable.
EOF

echo "Instance d’assistance adaptative initialisée dans ${INSTANCE_DIR}."
echo "Ajoutez les documents sources dans ${SHARED_WORKSPACE}/01_sources/00_inbox, puis lancez : docker compose up -d --build"
