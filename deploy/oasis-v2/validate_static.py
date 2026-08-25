#!/usr/bin/env python3
"""Static integrity checks for the local OASIS-V2 Spacebot deployment."""
from __future__ import annotations

from pathlib import Path
import json
import re
import tomllib

ROOT = Path(__file__).resolve().parent
config = tomllib.loads((ROOT / 'config.toml.example').read_text(encoding='utf-8'))
compose = (ROOT / 'docker-compose.yml').read_text(encoding='utf-8')
root_dockerfile = (ROOT / '..' / '..' / 'Dockerfile').resolve().read_text(encoding='utf-8')

agents = config['agents']
agent_ids = {agent['id'] for agent in agents}
human_ids = {human['id'] for human in config['humans']}
assert len(agents) == 6, 'Six profils OASIS sont requis.'
assert len(agent_ids) == len(agents), 'Les IDs des agents doivent être uniques.'
assert sum(bool(agent.get('default')) for agent in agents) == 1, 'Un seul agent par défaut est requis.'
assert all(re.fullmatch(r'[a-z0-9_-]+', agent_id) for agent_id in agent_ids), 'ID agent invalide.'
assert all(agent['workspace'] == '/data/shared-workspace' for agent in agents), 'Workspace commun OASIS attendu.'

routing = config['defaults']['routing']
for field in ('channel', 'branch', 'worker', 'compactor', 'cortex'):
    assert routing[field].startswith('openrouter/'), f'Routage {field} doit utiliser OpenRouter.'
assert routing['task_overrides']['coding'] == 'openrouter/openai/gpt-oss-120b'
assert routing['rate_limit_cooldown_secs'] == 90
assert 'openrouter/openai/gpt-oss-120b' in routing['fallbacks']

assert config['defaults']['max_concurrent_branches'] == 1
assert config['defaults']['max_concurrent_workers'] == 1
assert config['defaults']['max_turns'] == 3
assert config['defaults']['branch_max_turns'] == 6
assert config['defaults']['history_backfill_count'] == 12
chronicle = config['defaults']['compaction']
assert chronicle['mode'] == 'chronicle'
for field, expected in [('background_threshold', 0.72), ('aggressive_threshold', 0.82), ('emergency_threshold', 0.93)]:
    assert chronicle[field] == expected, f'Compaction {field} incorrecte.'
assert chronicle['chronicle']['interval_messages'] == 24
assert chronicle['chronicle']['context_token_budget'] == 1200
assert config['defaults']['memory_persistence']['enabled'] is False
assert config['defaults']['skills']['reflection']['enabled'] is False
assert config['defaults']['cortex']['worker_wall_clock_timeout_secs'] == 600
assert config['defaults']['autonomy']['level'] == 'suggest'
assert config['defaults']['browser']['enabled'] is False

opencode = config['defaults']['opencode']
assert opencode['enabled'] is True
assert opencode['path'] == '/root/.bun/bin/opencode'
assert opencode['max_servers'] == 1
assert opencode['permissions'] == {'edit': 'allow', 'bash': 'allow', 'webfetch': 'deny'}
assert 'opencode-ai@${OPENCODE_VERSION}' in root_dockerfile, 'Le binaire OpenCode versionné doit être inclus dans l’image.'
assert 'COPY --from=builder /root/.bun /root/.bun' in root_dockerfile, 'Bun et OpenCode doivent être copiés dans l’image runtime.'
assert 'ENV PATH="/root/.bun/bin:${PATH}"' in root_dockerfile, 'Le chemin runtime d’OpenCode doit être déclaré.'

mcp = {entry['name']: entry['url'] for entry in config['defaults']['mcp']}
assert mcp == {'oasis_shared_memory': 'http://oasis-shared-memory:3010/mcp'}, 'La mémoire commune doit être l’unique MCP partagé par défaut.'
expected_agent_mcp = {
    'oasis-coordination': {'oasis_document_studio', 'oasis_supervised_optimizer'},
    'oasis-finances': {'oasis_document_studio'},
    'oasis-calendrier': {'oasis_document_studio'},
    'oasis-pse-sig': {'oasis_gis_local', 'oasis_document_studio'},
    'oasis-reddition': {'oasis_document_studio'},
    'oasis-gouvernance': {'oasis_document_studio'},
}
for agent in agents:
    tool_names = {entry['name'] for entry in agent.get('mcp', [])}
    assert tool_names == expected_agent_mcp[agent['id']], f'MCP ciblés incorrects pour {agent["id"]}: {tool_names}'
coordination = next(agent for agent in agents if agent['id'] == 'oasis-coordination')
assert coordination['browser']['enabled'] is True
for service in ('oasis-memory-db:', 'oasis-shared-memory:', 'oasis-gis:', 'oasis-document-studio:', 'oasis-optimizer:', 'spacebot-oasis-v2:'):
    assert service in compose, f'Service Docker manquant : {service}'

for link in config['links']:
    assert link['from'] in agent_ids | human_ids and link['to'] in agent_ids | human_ids, f'Lien invalide : {link}'
    assert link['direction'] in {'one_way', 'two_way'}
    assert link['kind'] in {'hierarchical', 'peer'}

taxonomy = json.loads((ROOT / 'document-studio' / 'taxonomy.json').read_text(encoding='utf-8'))
assert len(taxonomy['categories']) == 8, 'La taxonomie doit contenir huit catégories principales.'
assert '01_sources/00_inbox' in taxonomy['categories']['source']['folders']
assert '07_livrables/03_approuves' in taxonomy['categories']['deliverable']['folders']

for required in [
    ROOT / 'gis-mcp' / 'server.js',
    ROOT / 'document-studio' / 'server.js',
    ROOT / 'document-studio' / 'taxonomy.json',
    ROOT / 'document-studio' / 'templates' / 'oasis-reference.docx',
    ROOT / 'optimizer' / 'Dockerfile',
    ROOT / 'optimizer' / 'server.js',
    ROOT / 'optimizer' / 'optimizer.py',
    ROOT / 'optimizer' / 'fixtures' / 'reference_cases.template.json',
    ROOT / 'skills' / 'oasis-foundation' / 'SKILL.md',
    ROOT / 'skills' / 'oasis-capability-discovery' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-coordination' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-financial-control' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-schedule-governance' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-pse-sig' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-reporting' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-governance' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-document-studio' / 'SKILL.md',
    ROOT / 'profile-skills' / 'oasis-supervised-optimization' / 'SKILL.md',
]:
    assert required.is_file(), f'Ressource requise absente : {required}'

print('Validation statique OASIS-V2 : OK')
print('Agents: 6 | MCP ciblés | OpenCode: activé | Routage: OpenRouter sans Claude | Autonomie: suggest | Taxonomie: 8 catégories | Sobriété: activée')
