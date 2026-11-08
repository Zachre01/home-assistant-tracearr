"""Configure Tracearr HA via Settings > Devices & services."""
from __future__ import annotations

import json
from urllib.parse import urlparse

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import selector

from .api import TracearrAuthError, TracearrClient, TracearrError
from .const import CONF_ALIASES, CONF_AVATARS, CONF_NETWORK_LOCATIONS, CONF_TOKEN, CONF_URL, DOMAIN


def clean_url(value: str) -> str:
    """Require explicit HTTP(S) endpoint; HTTPS is recommended for remote hosts."""
    value = value.strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Invalid Tracearr URL")
    return value


class TracearrConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create unique entries by base Tracearr URL."""
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                url = clean_url(user_input[CONF_URL])
                client = TracearrClient(async_get_clientsession(self.hass), url, user_input[CONF_TOKEN].strip())
                await client.servers()
            except (ValueError, TracearrError) as exc:
                errors["base"] = "invalid_auth" if isinstance(exc, TracearrAuthError) else "cannot_connect"
            else:
                await self.async_set_unique_id(url.lower())
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title=f"Tracearr ({urlparse(url).hostname})", data={CONF_URL: url, CONF_TOKEN: user_input[CONF_TOKEN].strip()})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({
            vol.Required(CONF_URL, default="http://localhost:3000"): str,
            vol.Required(CONF_TOKEN): str,
        }), errors=errors)

    @staticmethod
    def async_get_options_flow(config_entry):
        return TracearrOptionsFlow()


class TracearrOptionsFlow(config_entries.OptionsFlow):
    """Edit aliases individually; advanced JSON is available for bulk changes."""

    def __init__(self):
        self._accounts = None
        self._chosen_account = None
        self._chosen_device = None
        self._device_bulk_fields = {}
        self._alias_bulk_fields = {}
        self._device_groups = None

    async def async_step_init(self, user_input=None):
        return self.async_show_menu(step_id="init", menu_options=[
            "devices_table", "aliases_table", "network_manual", "advanced",
        ])

    async def async_step_advanced(self, user_input=None):
        """Keep existing single-record/JSON tools for complex configurations."""
        return self.async_show_menu(step_id="advanced", menu_options=[
            "user_alias", "network_device", "network_json", "raw_maps",
        ])

    @staticmethod
    def _unique_fields(labels: dict[str, str]) -> dict[str, str]:
        """Map readable dynamic form labels to stable identifiers, without collisions."""
        used: set[str] = set()
        fields: dict[str, str] = {}
        for key, title in sorted(labels.items(), key=lambda item: item[1].casefold()):
            label = title.strip() or key
            if label in used:
                label = f"{label} · {key[-8:]}"
            used.add(label)
            fields[label] = key
        return fields

    async def async_step_aliases_table(self, user_input=None):
        """Edit every detected account in one pre-filled Home Assistant form."""
        accounts = await self._load_accounts()
        aliases = dict(self.config_entry.options.get(CONF_ALIASES, {}))
        for key in aliases:
            accounts.setdefault(key, f"{key} (saved)")
        if not accounts:
            return self.async_abort(reason="no_users")
        fields = self._unique_fields(accounts)
        if user_input is not None:
            updates = dict(aliases)
            for label, key in fields.items():
                new_value = str(user_input.get(label, aliases.get(key, ""))).strip()
                if new_value:
                    updates[key] = new_value
                else:
                    updates.pop(key, None)
            return self.async_create_entry(title="", data={
                **self.config_entry.options, CONF_ALIASES: updates,
            })
        schema = vol.Schema({
            vol.Optional(label, default=aliases.get(key, "")): str
            for label, key in fields.items()
        })
        return self.async_show_form(step_id="aliases_table", data_schema=schema)

    async def _group_detected_devices(self):
        """Group client rules by their real Tracearr server and media type.

        A saved device stays visible even when inactive. For devices with no
        server ID, keep an "Autres" category rather than guessing a server.
        """
        if self._device_groups is not None:
            return self._device_groups
        devices = await self._load_devices()
        coordinator = self.hass.data.get(DOMAIN, {}).get(self.config_entry.entry_id)
        servers = coordinator.servers if coordinator else {}
        groups = {}
        for server_id, server in servers.items():
            kind = str(server.get("server_type") or "other").lower()
            kind = kind if kind in ("plex", "jellyfin", "emby") else "other"
            groups[server_id] = {
                "server_id": server_id,
                "name": str(server.get("server_name") or kind.upper()),
                "type": kind,
                "devices": {},
            }
        for key, label in devices.items():
            server_id = key.split(":", 1)[0]
            if server_id in groups and (":device:" in key or ":player:" in key):
                groups[server_id]["devices"][key] = label
                continue
            # Some devices only exist in recent history, so derive their server
            # type from the recorded label if there is no live server entry.
            detected_type = str(label).split(" · ", 1)[0].lower()
            kind = detected_type if detected_type in ("plex", "jellyfin", "emby") else "other"
            if ":device:" in key or ":player:" in key:
                if server_id not in ("device", "player"):
                    group_id = server_id
                    if group_id not in groups:
                        description = str(label).split(" · ")
                        server_name = description[1] if len(description) > 2 else server_id
                        groups[group_id] = {
                            "server_id": group_id, "name": server_name,
                            "type": kind, "devices": {},
                        }
                    groups[group_id]["devices"][key] = label
                    continue
            groups.setdefault("_other", {"server_id": None, "name": "No identified server", "type": "other", "devices": {}})["devices"][key] = label
        # Persisted server-wide rules must remain configurable even if the
        # media server is temporarily offline or no sessions are cached.
        for key in self.config_entry.options.get(CONF_NETWORK_LOCATIONS, {}):
            if key.startswith("server:"):
                server_id = key.removeprefix("server:")
                groups.setdefault(server_id, {
                    "server_id": server_id, "name": server_id,
                    "type": "other", "devices": {},
                })
        self._device_groups = groups
        return groups

    async def async_step_devices_table(self, user_input=None):
        """Choose a separate native Home Assistant form for each server type."""
        groups = await self._group_detected_devices()
        menu_options = [
            f"devices_{kind}" for kind in ("plex", "jellyfin", "emby", "other")
            if any(group["type"] == kind for group in groups.values())
        ]
        if not menu_options:
            return await self.async_step_network_manual()
        return self.async_show_menu(step_id="devices_table", menu_options=menu_options)

    async def _edit_devices_type(self, server_type, step_id, user_input=None):
        """One mutually-exclusive LAN/WAN choice per device, with bulk rules.

        The normal configuration-flow UI stacks fields vertically; it does not
        support a custom HTML grid. A radio selector makes the three choices
        visible and prevents conflicting Local + Remote selections.
        """
        all_groups = await self._group_detected_devices()
        groups = sorted(
            (group for group in all_groups.values() if group["type"] == server_type),
            key=lambda group: group["name"].casefold(),
        )
        if not groups:
            return await self.async_step_devices_table()
        locations = dict(self.config_entry.options.get(CONF_NETWORK_LOCATIONS, {}))
        # Keep these identifiers and their previously saved values stable on
        # subsequent visits, irrespective of the order of recent sessions.
        fields = {}
        for group in groups:
            server_id = group["server_id"]
            default_key = f"server:{server_id}" if server_id else None
            default_location = locations.get(default_key, "unknown") if default_key else "unknown"
            title = group["name"]
            if default_key:
                bulk_label = f"{title} · All devices (current: { {'unknown': 'Unclassified', 'local': 'Local', 'remote': 'Remote'}.get(default_location, 'Unclassified') })"
                fields[bulk_label] = ("bulk", group, None, "keep")
            for key, label in sorted(group["devices"].items(), key=lambda entry: entry[1].casefold()):
                # Avoid showing the server name twice inside that server's list.
                concise = str(label)
                prefix = f"{server_type.upper()} · {title} · "
                if concise.startswith(prefix):
                    concise = concise[len(prefix):]
                fields[f"{title} · {concise}"] = ("device", group, key, locations.get(key, default_location))
        if user_input is not None:
            updated = dict(locations)
            for label, (field_type, group, key, original) in fields.items():
                if field_type != "bulk":
                    continue
                action = user_input.get(label, "keep")
                if action == "keep":
                    continue
                server_id = group["server_id"]
                if not server_id:
                    continue
                server_key = f"server:{server_id}"
                if action in ("local", "remote"):
                    updated[server_key] = action
                elif action == "unknown":
                    updated.pop(server_key, None)
                # A bulk action explicitly resets the existing individual
                # choices for all the server's detected devices. Future clients
                # inherit the server-wide rule when it is set.
                for device_key in group["devices"]:
                    updated.pop(device_key, None)
            for label, (field_type, group, key, original) in fields.items():
                if field_type != "device":
                    continue
                server_id = group["server_id"]
                bulk_label = next((name for name, detail in fields.items()
                    if detail[0] == "bulk" and detail[1] is group), None)
                if bulk_label and user_input.get(bulk_label, "keep") != "keep":
                    continue  # Explicit bulk action wins on this save.
                value = user_input.get(label, original)
                fallback = updated.get(f"server:{server_id}", "unknown") if server_id else "unknown"
                if value not in ("local", "remote", "unknown"):
                    continue
                if value == fallback:
                    updated.pop(key, None)
                else:
                    # Store "unknown" explicitly to override an existing
                    # Local/WAN server-wide default on a particular device.
                    updated[key] = value
            return self.async_create_entry(title="", data={
                **self.config_entry.options, CONF_NETWORK_LOCATIONS: updated,
            })
        radio = selector.SelectSelector(selector.SelectSelectorConfig(
            options=[
                {"value": "unknown", "label": "Unclassified"},
                {"value": "local", "label": "Local (LAN)"},
                {"value": "remote", "label": "Remote (WAN)"},
            ], mode="list",
        ))
        bulk = selector.SelectSelector(selector.SelectSelectorConfig(
            options=[
                {"value": "keep", "label": "Leave unchanged"},
                {"value": "local", "label": "Set all to local"},
                {"value": "remote", "label": "Set all to remote"},
                {"value": "unknown", "label": "Reset all to unclassified"},
            ], mode="list",
        ))
        schema = vol.Schema({
            vol.Optional(label, default=current): bulk if field_type == "bulk" else radio
            for label, (field_type, group, key, current) in fields.items()
        })
        return self.async_show_form(step_id=step_id, data_schema=schema)

    async def async_step_devices_plex(self, user_input=None):
        return await self._edit_devices_type("plex", "devices_plex", user_input)

    async def async_step_devices_jellyfin(self, user_input=None):
        return await self._edit_devices_type("jellyfin", "devices_jellyfin", user_input)

    async def async_step_devices_emby(self, user_input=None):
        return await self._edit_devices_type("emby", "devices_emby", user_input)

    async def async_step_devices_other(self, user_input=None):
        return await self._edit_devices_type("other", "devices_other", user_input)

    async def _load_accounts(self) -> dict[str, str]:
        if self._accounts is not None:
            return self._accounts
        client = TracearrClient(async_get_clientsession(self.hass), self.config_entry.data[CONF_URL], self.config_entry.data[CONF_TOKEN])
        self._accounts = {}
        try:
            identities = await client.users()
            for identity in identities:
                for account in identity.get("accounts", []):
                    key = f"{account.get('server_id')}:{account.get('username')}"
                    if account.get("username") and account.get("server_id"):
                        self._accounts[key] = f"{account.get('server_type', 'media').upper()} · {account['username']} ({identity.get('username','')})"
        except TracearrError:
            # Active usernames remain configurable even when /users is unavailable.
            self._accounts = {}
        coordinator = self.hass.data.get(DOMAIN, {}).get(self.config_entry.entry_id)
        if coordinator:
            for stream in coordinator.streams.values():
                key = f"{stream.get('server_id')}:{stream.get('username')}"
                self._accounts.setdefault(key, f"{stream.get('server_name')} · {stream.get('username')}")
        return self._accounts

    async def async_step_user_alias(self, user_input=None):
        accounts = await self._load_accounts()
        if not accounts:
            return self.async_abort(reason="no_users")
        if user_input is not None:
            self._chosen_account = user_input["account"]
            return await self.async_step_edit_alias()
        return self.async_show_form(step_id="user_alias", data_schema=vol.Schema({
            vol.Required("account"): vol.In(accounts),
        }))

    async def async_step_edit_alias(self, user_input=None):
        key = self._chosen_account
        if key is None:
            return await self.async_step_user_alias()
        aliases = dict(self.config_entry.options.get(CONF_ALIASES, {}))
        avatars = dict(self.config_entry.options.get(CONF_AVATARS, {}))
        if user_input is not None:
            if user_input.get("alias", "").strip():
                aliases[key] = user_input["alias"].strip()
            else:
                aliases.pop(key, None)
            if user_input.get("avatar", "").strip():
                avatars[key] = user_input["avatar"].strip()
            else:
                avatars.pop(key, None)
            return self.async_create_entry(title="", data={**self.config_entry.options, CONF_ALIASES: aliases, CONF_AVATARS: avatars})
        return self.async_show_form(step_id="edit_alias", data_schema=vol.Schema({
            vol.Optional("alias", default=aliases.get(key, "")): str,
            vol.Optional("avatar", default=avatars.get(key, "")): str,
        }), description_placeholders={"account": key})

    async def _load_devices(self) -> dict[str, str]:
        """Use the observed active devices and previously saved classifications."""
        devices = {}
        coordinator = self.hass.data.get(DOMAIN, {}).get(self.config_entry.entry_id)
        if coordinator:
            for stream in coordinator.streams.values():
                server = stream.get("server_name") or stream.get("server_type") or "Server"
                server_type = str(stream.get("server_type") or "Media").upper()
                server_id = stream.get("server_id")
                device = str(stream.get("device") or "").strip()
                player = str(stream.get("player") or "").strip()
                if device:
                    key = f"{server_id}:device:{device}" if server_id else f"device:{device}"
                    devices[key] = f"{server_type} · {server} · {device} (device)"
                if player:
                    key = f"{server_id}:player:{player}" if server_id else f"player:{player}"
                    devices[key] = f"{server_type} · {server} · {player} (player)"
        # History contains devices that are not currently playing. Limit API work
        # to 500 recent plays; keep all previously classified inactive devices.
        if getattr(self.config_entry, "data", {}).get(CONF_URL):
            client = TracearrClient(async_get_clientsession(self.hass),
                self.config_entry.data[CONF_URL], self.config_entry.data[CONF_TOKEN])
            cursor = None
            try:
                for _ in range(5):
                    params = {"pageSize": 100}
                    if cursor:
                        params["cursor"] = cursor
                    result = await client.get("history", params)
                    for record in result.get("data", []):
                        server_id = record.get("server_id")
                        server = record.get("server_name") or record.get("server_type") or "Server"
                        server_type = str(record.get("server_type") or "Media").upper()
                        for kind, suffix in (("device", "device"), ("player", "player")):
                            value = str(record.get(kind) or "").strip()
                            if value:
                                key = f"{server_id}:{kind}:{value}" if server_id else f"{kind}:{value}"
                                devices.setdefault(key, f"{server_type} · {server} · {value} ({suffix})")
                    cursor = result.get("meta", {}).get("nextCursor")
                    if not cursor:
                        break
            except TracearrError:
                # Active + saved devices still work when history is unavailable.
                pass
        for key in self.config_entry.options.get(CONF_NETWORK_LOCATIONS, {}):
            devices.setdefault(key, f"{key} (saved)")
        return dict(sorted(devices.items(), key=lambda item:item[1].casefold()))

    async def async_step_network_device(self, user_input=None):
        """Select a known client using a menu similar to the alias picker."""
        devices = await self._load_devices()
        if not devices:
            return await self.async_step_network_manual()
        if user_input is not None:
            self._chosen_device = user_input["device"]
            return await self.async_step_network_location()
        return self.async_show_form(step_id="network_device", data_schema=vol.Schema({
            vol.Required("device"): vol.In(devices),
        }))

    async def async_step_network_manual(self, user_input=None):
        """Allow classification even when the media client is not playing."""
        errors = {}
        if user_input is not None:
            name = str(user_input["name"]).strip()
            if not name or len(name) > 120:
                errors["base"] = "invalid_device"
            else:
                self._chosen_device = f"{user_input['match_type']}:{name}"
                return await self.async_step_network_location()
        return self.async_show_form(step_id="network_manual", data_schema=vol.Schema({
            vol.Required("match_type", default="device"): vol.In({
                "device": "Device name", "player": "Player name",
            }),
            vol.Required("name"): str,
        }), errors=errors)

    async def async_step_network_location(self, user_input=None):
        """Set the selected player as LAN, WAN, or unknown (remove override)."""
        key = self._chosen_device
        if not key:
            return await self.async_step_network_device()
        mapping = dict(self.config_entry.options.get(CONF_NETWORK_LOCATIONS, {}))
        if user_input is not None:
            location = user_input["location"]
            if location == "unknown":
                mapping.pop(key, None)
            else:
                mapping[key] = location
            return self.async_create_entry(title="", data={
                **self.config_entry.options, CONF_NETWORK_LOCATIONS:mapping,
            })
        return self.async_show_form(step_id="network_location", data_schema=vol.Schema({
            vol.Required("location", default=mapping.get(key, "unknown")): vol.In({
                "unknown": "Unclassified / remove rule",
                "local": "Local (LAN)", "remote": "Remote (WAN)",
            }),
        }), description_placeholders={"device":key})

    async def async_step_network_json(self, user_input=None):
        """Expert bulk editor for inactive devices; refuse unexpected values."""
        errors = {}
        if user_input is not None:
            try:
                data = json.loads(user_input[CONF_NETWORK_LOCATIONS])
                if not isinstance(data,dict) or any(
                    not isinstance(key,str) or not isinstance(value,str) or
                    value not in ("local", "remote") or not key.strip()
                    for key,value in data.items()
                ):
                    raise ValueError("Invalid network mapping")
            except (ValueError, TypeError):
                errors["base"] = "invalid_json"
            else:
                return self.async_create_entry(title="", data={
                    **self.config_entry.options, CONF_NETWORK_LOCATIONS:data,
                })
        return self.async_show_form(step_id="network_json", data_schema=vol.Schema({
            vol.Required(CONF_NETWORK_LOCATIONS, default=json.dumps(
                self.config_entry.options.get(CONF_NETWORK_LOCATIONS, {}), ensure_ascii=False,
            )): str,
        }), errors=errors)

    async def async_step_raw_maps(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                aliases = json.loads(user_input[CONF_ALIASES])
                avatars = json.loads(user_input[CONF_AVATARS])
                if not isinstance(aliases, dict) or not isinstance(avatars, dict):
                    raise ValueError("Object expected")
                aliases = {str(k): str(v) for k, v in aliases.items() if v}
                avatars = {str(k): str(v) for k, v in avatars.items() if v}
            except (ValueError, TypeError):
                errors["base"] = "invalid_json"
            else:
                return self.async_create_entry(title="", data={**self.config_entry.options, CONF_ALIASES: aliases, CONF_AVATARS: avatars})
        return self.async_show_form(step_id="raw_maps", data_schema=vol.Schema({
            vol.Required(CONF_ALIASES, default=json.dumps(self.config_entry.options.get(CONF_ALIASES, {}), ensure_ascii=False)): str,
            vol.Required(CONF_AVATARS, default=json.dumps(self.config_entry.options.get(CONF_AVATARS, {}), ensure_ascii=False)): str,
        }), errors=errors)
