"""Native options forms: one media server type at a time and bulk overrides."""
from __future__ import annotations

import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace

SOURCE = Path(__file__).resolve().parents[1] / 'custom_components/tracearr_ha/config_flow.py'


class FakeVol:
    class Key:
        def __init__(self, label, default=''):
            self.label = label
            self.default = default

    @staticmethod
    def Optional(label, default=''):
        return FakeVol.Key(label, default)

    @staticmethod
    def In(choices):
        return choices

    @staticmethod
    def Schema(data):
        return data


class FakeSelector:
    @staticmethod
    def SelectSelectorConfig(**kwargs):
        return kwargs

    @staticmethod
    def SelectSelector(config):
        return config


def get_methods():
    tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'TracearrOptionsFlow')
    names = {
        '_unique_fields', '_group_detected_devices', '_edit_devices_type',
        'async_step_devices_table', 'async_step_devices_plex',
        'async_step_devices_jellyfin', 'async_step_devices_emby',
        'async_step_devices_other', 'async_step_aliases_table',
    }
    selected = []
    for node in cls.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list = []
            selected.append(node)
    namespace = {'vol': FakeVol, 'selector': FakeSelector, 'DOMAIN': 'tracearr_ha',
                 'CONF_ALIASES': 'aliases', 'CONF_NETWORK_LOCATIONS': 'network_locations'}
    exec(compile(ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[])), str(SOURCE), 'exec'), namespace)
    return {name: namespace[name] for name in names}


METHODS = get_methods()


class Flow:
    def __init__(self, options=None, device_records=None, user_records=None, servers=None):
        self.config_entry = SimpleNamespace(options=options or {}, entry_id='entry')
        self.device_records = device_records or {}
        self.user_records = user_records or {}
        self._device_groups = None
        self.hass = SimpleNamespace(data={'tracearr_ha': {'entry': SimpleNamespace(servers=servers or {})}})
        for name, fn in METHODS.items():
            setattr(self, name, fn if name == "_unique_fields" else fn.__get__(self, self.__class__))

    async def _load_devices(self):
        return self.device_records

    async def _load_accounts(self):
        return self.user_records

    def async_show_form(self, step_id, data_schema):
        return {'step': step_id, 'fields': {k.label: k.default for k in data_schema}}

    def async_show_menu(self, step_id, menu_options):
        return {'menu': step_id, 'options': menu_options}

    def async_create_entry(self, title, data):
        return {'saved': data}

    def async_abort(self, reason):
        return {'abort': reason}

    async def async_step_network_manual(self):
        return {'fallback': 'manual'}


def fixture_flow(options=None):
    return Flow(
        options=options,
        servers={
            'plex-id': {'server_type': 'plex', 'server_name': 'Plex Maison'},
            'jf-id': {'server_type': 'jellyfin', 'server_name': 'Jellyfin'},
            'emby-id': {'server_type': 'emby', 'server_name': 'Emby'},
        },
        device_records={
            'plex-id:device:Shield': 'PLEX · Plex Maison · Shield (device)',
            'plex-id:player:Plex Web': 'PLEX · Plex Maison · Plex Web (player)',
            'jf-id:device:TV': 'JELLYFIN · Jellyfin · TV (device)',
            'emby-id:device:Box': 'EMBY · Emby · Box (device)',
        },
    )


def test_groups_menu_by_media_server_type():
    flow = fixture_flow()
    result = asyncio.run(flow.async_step_devices_table())
    assert result == {'menu': 'devices_table', 'options': [
        'devices_plex', 'devices_jellyfin', 'devices_emby',
    ]}
    plex = asyncio.run(flow.async_step_devices_plex())
    jellyfin = asyncio.run(flow.async_step_devices_jellyfin())
    assert plex['step'] == 'devices_plex'
    assert any('Shield' in label for label in plex['fields'])
    assert not any('TV' in label for label in plex['fields'])
    assert any('TV' in label for label in jellyfin['fields'])
    assert not any('Shield' in label for label in jellyfin['fields'])


def test_device_radio_choices_and_prepopulated_values():
    flow = fixture_flow({'network_locations': {
        'plex-id:device:Shield': 'local',
        'jf-id:device:TV': 'remote',
    }})
    form = asyncio.run(flow.async_step_devices_plex())
    assert form['fields']['Plex Maison · Shield (device)'] == 'local'
    assert form['fields']['Plex Maison · Plex Web (player)'] == 'unknown'
    assert any('All devices' in label for label in form['fields'])
    saved = asyncio.run(flow.async_step_devices_plex({
        'Plex Maison · Shield (device)': 'remote',
        'Plex Maison · Plex Web (player)': 'local',
    }))['saved']
    assert saved['network_locations'] == {
        'plex-id:device:Shield': 'remote',
        'plex-id:player:Plex Web': 'local',
        'jf-id:device:TV': 'remote',
    }
    flow.config_entry.options = saved
    assert asyncio.run(flow.async_step_devices_plex())['fields']['Plex Maison · Shield (device)'] == 'remote'


def test_server_bulk_choice_adds_future_device_default_and_clears_old_overrides():
    flow = fixture_flow({'network_locations': {
        'plex-id:device:Shield': 'remote',
        'jf-id:device:TV': 'local',
    }, 'aliases': {'plex-id:alice': 'Alice'}})
    initial = asyncio.run(flow.async_step_devices_plex())
    bulk = next(label for label in initial['fields'] if 'All devices' in label)
    saved = asyncio.run(flow.async_step_devices_plex({bulk: 'local'}))['saved']
    assert saved['network_locations'] == {'server:plex-id': 'local', 'jf-id:device:TV': 'local'}
    assert saved['aliases'] == {'plex-id:alice': 'Alice'}
    flow.config_entry.options = saved
    result = asyncio.run(flow.async_step_devices_plex())
    assert result['fields']['Plex Maison · Shield (device)'] == 'local'
    assert result['fields']['Plex Maison · Plex Web (player)'] == 'local'
    assert any('current: Local' in label for label in result['fields'])


def test_individual_unknown_can_override_remote_default_and_restore_default():
    flow = fixture_flow({'network_locations': {'server:plex-id': 'remote'}})
    saved = asyncio.run(flow.async_step_devices_plex({
        'Plex Maison · Shield (device)': 'unknown',
    }))['saved']
    assert saved['network_locations'] == {'server:plex-id':'remote', 'plex-id:device:Shield':'unknown'}
    flow.config_entry.options = saved
    assert asyncio.run(flow.async_step_devices_plex())['fields']['Plex Maison · Shield (device)'] == 'unknown'
    reverted = asyncio.run(flow.async_step_devices_plex({
        'Plex Maison · Shield (device)': 'remote',
    }))['saved']
    assert reverted['network_locations'] == {'server:plex-id':'remote'}


def test_bulk_unclassified_clears_server_default_without_touching_other_server():
    flow = fixture_flow({'network_locations': {'server:plex-id':'remote', 'plex-id:device:Shield':'local', 'server:jf-id':'local'}})
    form = asyncio.run(flow.async_step_devices_plex())
    bulk = next(label for label in form['fields'] if 'All devices' in label)
    saved = asyncio.run(flow.async_step_devices_plex({bulk:'unknown'}))['saved']
    assert saved['network_locations'] == {'server:jf-id':'local'}


def test_aliases_table_edits_multiple_and_preserves_avatars():
    flow=Flow({'aliases': {'id1:alice':'Alice maison'},'avatars': {'id1:alice':'https://example.org/a.png'}},
              user_records={'id1:alice':'PLEX · alice','id2:bob':'JELLYFIN · bob'})
    form=asyncio.run(flow.async_step_aliases_table())
    assert form['fields'] == {'JELLYFIN · bob':'','PLEX · alice':'Alice maison'}
    saved=asyncio.run(flow.async_step_aliases_table({'PLEX · alice':'Alice','JELLYFIN · bob':'Bob maison'}))['saved']
    assert saved['aliases'] == {'id1:alice':'Alice','id2:bob':'Bob maison'}
    assert saved['avatars'] == {'id1:alice':'https://example.org/a.png'}


def test_other_category_keeps_legacy_global_devices():
    flow=Flow({'network_locations': {'device:Old TV': 'local'}},device_records={'device:Old TV':'device:Old TV (saved)'})
    result=asyncio.run(flow.async_step_devices_table())
    assert result['options']==['devices_other']
    form=asyncio.run(flow.async_step_devices_other())
    assert form['fields']['No identified server · device:Old TV (saved)']=='local'
