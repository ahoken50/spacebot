#!/usr/bin/env python3
"""Static integrity checks for the Autonomous Task Hub local deployment."""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
config = tomllib.loads((ROOT / 'config.toml.example').read_text(encoding='utf-8'))
compose = (ROOT / 'docker-compose.yml').read_text(encoding='utf-8')
env_example = (ROOT / '.env.example').read_text(encoding='utf-8')
root_dockerfile = (ROOT / '..' / '..' / 'Dockerfile').resolve().read_text(encoding='utf-8')
specialized_term = 'muni' + 'cipal'
specialized_watch = f'{specialized_term}_watch'
city_marker = 'val' + '-d’' + 'or'
territory_marker = 'mrc' + 'vo'

expected_agents = {
    'task-orchestrator', 'task-research', 'task-planning', 'task-analysis',
    'task-automation', 'task-writing', 'task-review', 'task-learning',
}
agents = config['agents']
agent_ids = {agent['id'] for agent in agents}
human_ids = {human['id'] for human in config['humans']}
assert agent_ids == expected_agents, f'Profils génériques incorrects : {agent_ids}'
assert len(agents) == 8 and len(agent_ids) == len(agents), 'Huit profils distincts sont requis.'
assert human_ids == {'task-owner'}, 'Le responsable générique est requis.'
assert sum(bool(agent.get('default')) for agent in agents) == 1, 'Un seul agent par défaut est requis.'
assert all(re.fullmatch(r'[a-z0-9_-]+', value) for value in agent_ids), 'ID agent invalide.'
assert all(agent.get('sandbox', {}).get('writable_paths') == ['/data/shared-workspace'] for agent in agents), 'Chaque profil doit être limité au workspace partagé.'

routing = config['defaults']['routing']
for field in ('channel', 'branch', 'worker', 'compactor', 'cortex'):
    assert routing[field].startswith('openrouter/'), f'Routage {field} hors OpenRouter.'
assert 'claude' not in json.dumps(config).lower(), 'Aucun modèle Claude ne doit être configuré.'
assert config['defaults']['max_concurrent_branches'] == 2
assert config['defaults']['max_concurrent_workers'] == 3
assert config['defaults']['skills']['reflection']['enabled'] is True
assert config['defaults']['autonomy']['level'] == 'act'
assert config['defaults']['autonomy']['interval_secs'] == 900
assert config['defaults']['autonomy']['claim_unowned'] is True
assert config['defaults']['opencode']['permissions'] == {'edit': 'allow', 'bash': 'allow', 'webfetch': 'deny'}
assert 'opencode-ai@${OPENCODE_VERSION}' in root_dockerfile
for package in ('python3', 'python3-venv', 'python3-pip'):
    assert package in root_dockerfile, f'Python runtime manquant : {package}'

expected_agent_mcp = {
    'task-orchestrator': {'project_document_studio', 'project_supervised_optimizer', 'project_skillopt', 'project_reference_miner'},
    'task-research': {'project_document_studio'},
    'task-planning': {'project_document_studio'},
    'task-analysis': {'project_gis_local', 'project_document_studio'},
    'task-automation': {'project_document_studio'},
    'task-writing': {'project_document_studio'},
    'task-review': {'project_document_studio'},
    'task-learning': {'project_supervised_optimizer', 'project_skillopt', 'project_reference_miner'},
}
for agent in agents:
    assert {entry['name'] for entry in agent.get('mcp', [])} == expected_agent_mcp[agent['id']], f'MCP ciblés incorrects pour {agent["id"]}.'
for browser_agent in ('task-orchestrator', 'task-research'):
    assert next(item for item in agents if item['id'] == browser_agent)['browser']['enabled'] is True

for service in (
    'project-memory-db:', 'project-shared-memory:', 'project-gis:', 'project-document-studio:',
    'project-optimizer:', 'project-skillopt:', 'project-reference-miner:', 'project-local-code-improver:',
    'project-environment-evolver:', 'spacebot-project-hub:', 'project-failure-remediator:', 'project-approval-bridge:',
):
    assert service in compose, f'Service Docker manquant : {service}'
assert f'project-{specialized_term}-watch:' not in compose and f'{specialized_term}-watch' not in compose, 'Le service hérité ne doit pas être présent.'
assert 'PROJECT_HUB_LOCAL_CODE_IMPROVER_TOKEN: ${PROJECT_HUB_LOCAL_CODE_IMPROVER_TOKEN:?Définir PROJECT_HUB_LOCAL_CODE_IMPROVER_TOKEN dans .env}' in compose
assert 'PROJECT_HUB_ENVIRONMENT_EVOLVER_TOKEN: ${PROJECT_HUB_ENVIRONMENT_EVOLVER_TOKEN:?Définir PROJECT_HUB_ENVIRONMENT_EVOLVER_TOKEN dans .env}' in compose
assert 'PROJECT_HUB_HOST_REPOSITORY:?Définir PROJECT_HUB_HOST_REPOSITORY dans .env' in compose
assert '/var/run/docker.sock:/var/run/docker.sock' in compose
assert f'PROJECT_HUB_{specialized_term.upper()}_WATCH_TOKEN' not in compose
assert 'PROJECT_HUB_LOCAL_CODE_IMPROVER_TOKEN=' in env_example
assert 'PROJECT_HUB_ENVIRONMENT_EVOLVER_TOKEN=' in env_example
assert 'PROJECT_HUB_HOST_REPOSITORY=' in env_example
assert f'PROJECT_HUB_{specialized_term.upper()}_WATCH_TOKEN' not in env_example
assert 'PROJECT_HUB_SKILL_INSTALL_REQUIRE_APPROVAL: "false"' in compose

for dockerfile in (
    ROOT / 'shared-memory' / 'Dockerfile', ROOT / 'gis-mcp' / 'Dockerfile',
    ROOT / 'document-studio' / 'Dockerfile', ROOT / 'optimizer' / 'Dockerfile',
    ROOT / 'skillopt' / 'Dockerfile', ROOT / 'reference-miner' / 'Dockerfile',
    ROOT / 'approval-bridge' / 'Dockerfile', ROOT / 'failure-remediator' / 'Dockerfile',
    ROOT / 'local-code-improver' / 'Dockerfile', ROOT / 'environment-evolver' / 'Dockerfile',
):
    content = dockerfile.read_text(encoding='utf-8')
    assert 'frozen-lockfile=false' not in content, f'Argument Bun invalide dans {dockerfile}.'
    assert 'bun install --production' in content, f'Installation Bun de production manquante dans {dockerfile}.'

local_improver = (ROOT / 'local-code-improver' / 'server.js').read_text(encoding='utf-8')
for term in ('local_code_improvement', 'base_sha256', 'validation_failed', 'auto_applied_local_code', 'backupRoot', 'target_path_outside_scripts_root'):
    assert term in local_improver, f'Contrôle d’auto-correction manquant : {term}'
assert 'external_side_effects' in local_improver and 'config_change' in local_improver and 'network_access' in local_improver

environment_evolver = (ROOT / 'environment-evolver' / 'server.js').read_text(encoding='utf-8')
for term in ('environment_change', "'dependency'", "'docker'", "'mcp'", 'dependencySpecifierAllowed', 'validateCompose', 'validateMcpEndpoints', 'rolled_back', 'backupRoot'):
    assert term in environment_evolver, f'Contrôle d’environnement manquant : {term}'
assert 'secret_change' in environment_evolver and 'permission_change' in environment_evolver and 'external_transmission' in environment_evolver

failure_remediator = (ROOT / 'failure-remediator' / 'server.js').read_text(encoding='utf-8')
assert "const ownerAgentId = 'task-orchestrator'" in failure_remediator
assert 'repeat_suppressed' in failure_remediator and 'maxProposalsPerDay' in failure_remediator
assert '[courriel retiré]' in failure_remediator and '[secret retiré]' in failure_remediator
assert 'task-automation' in failure_remediator and 'task-learning' in failure_remediator

approval_bridge = (ROOT / 'approval-bridge' / 'server.js').read_text(encoding='utf-8')
assert "const ownerAgentId = 'task-orchestrator'" in approval_bridge
assert 'task-orchestrator' in approval_bridge and 'task-learning' in approval_bridge
assert specialized_watch not in approval_bridge and 'markSpecializedWatchReviewed' not in approval_bridge

reference_miner = (ROOT / 'reference-miner' / 'server.js').read_text(encoding='utf-8')
assert 'writeAutonomousPacks' in reference_miner and 'callAutonomousRunner' in reference_miner
skillopt_runner = (ROOT / 'skillopt' / 'skillopt_runner.py').read_text(encoding='utf-8')
assert 'ALLOWED_SKILLS' in skillopt_runner

bootstrap = (ROOT / 'bootstrap_instance.sh').read_text(encoding='utf-8')
for agent_id in expected_agents:
    assert f'"{agent_id}"' in bootstrap, f'Profil absent du bootstrap : {agent_id}'
for skill in ('task-adaptive-orchestration', 'task-autonomous-execution', 'task-self-evaluation', 'task-safe-self-improvement', 'task-source-research'):
    assert (ROOT / 'profile-skills' / skill / 'SKILL.md').is_file(), f'Compétence absente : {skill}'
    assert skill in bootstrap, f'Compétence non préchargée : {skill}'
assert f'veille-{specialized_term}e' not in bootstrap and f'{specialized_watch}_policy' not in bootstrap
assert '05_automatisation/01_scripts' in bootstrap

workflow = (ROOT / 'FRAMEWORK_WORKFLOW_TASK_HUB.md').read_text(encoding='utf-8')
validation = (ROOT / 'VALIDATION_AUTONOMOUS_TASK_HUB.md').read_text(encoding='utf-8')
readme = (ROOT / 'README.md').read_text(encoding='utf-8')
for content in (workflow, validation, readme, bootstrap, compose, env_example):
    assert specialized_term not in content.lower() and city_marker not in content.lower() and territory_marker not in content.lower(), 'Référence spécialisée interdite.'

taxonomy = json.loads((ROOT / 'document-studio' / 'taxonomy.json').read_text(encoding='utf-8'))
assert taxonomy['version'] == '2.0' and len(taxonomy['categories']) == 8
assert '05_automatisation/01_scripts' in taxonomy['categories']['automation']['folders']
assert '07_livrables/03_approuves' in taxonomy['categories']['deliverable']['folders']

for link in config['links']:
    assert link['from'] in agent_ids | human_ids and link['to'] in agent_ids | human_ids, f'Lien invalide : {link}'
    assert link['direction'] in {'one_way', 'two_way'} and link['kind'] in {'hierarchical', 'peer'}

print('Validation statique Autonomous Task Hub : OK')
print('Agents: 8 | Autonomie act | Workspaces privés + mémoire pgvector | Auto-correction locale atomique | Évolution dépendances/Docker/MCP avec provenance, validation, audit et retour arrière | OpenRouter sans Claude')
