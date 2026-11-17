/**
 * ============================================================================
 * ZIGBEE2MQTT - HOME ASSISTANT (módulo ÚNICO com TODA a integração)
 * ============================================================================
 *
 * Localização: /resources/js/node-red-contrib-zigbee2mqtt-homeassistant.js
 *
 * Concentra TUDO o que é Home Assistant (MQTT Discovery) no projeto:
 *
 *   • Constantes e tabelas ........ HA_STATE_TIMEOUT_MS, device_class (sensor / binary_sensor),
 *                                    flattenExposes, haBinaryText, normalizeList
 *   • HomeAssistantManager ........ lado SERVIDOR (nodes/server.js -> node.ha):
 *                                    registo dos nós "in", discovery retained, switch "enabled",
 *                                    subscrição, fallback ON, mensagens enabled/set e deteção de
 *                                    entidades Zigbee novas / removidas / renomeadas
 *   • HomeAssistantNodeState ...... lado NÓ "in" (nodes/in.js -> node.haState):
 *                                    estado enabled/disabled, fila "homeAssistantPendingMessages"
 *                                    (limite + TTL), replay/descarte, registo no servidor
 *   • createEntityTracker / createPendingGuard: helpers puros, testáveis sem Node-RED
 *
 * Os ficheiros server.js e in.js mantêm os MESMOS nomes de método públicos
 * (wrappers finos), por isso os callbacks MQTT existentes não foram reescritos.
 * O código movido do server.js / in.js mantém os comentários e os logs originais.
 *
 * Uso em Node/CJS:  const HAHelper = require('../resources/js/node-red-contrib-zigbee2mqtt-homeassistant.js');
 */
(function (root, factory) {
    'use strict';
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Zigbee2MqttHomeAssistantHelpers = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ========================================================================
    // CONSTANTES PARTILHADAS
    // ========================================================================

    const DEFAULTS = Object.freeze({
        PENDING_MAX: 20,          // proteção de memória: máx. de mensagens em fila no nó "in"
        PENDING_TTL_MS: 60000     // idade máxima de uma mensagem em fila antes de ser descartada
    });

    function toArray(value) {
        return Array.isArray(value) ? value : [];
    }

    /** exposeToHomeAssistant: checkbox (boolean, mas tolera 'true' vindo de flows antigos/importados) */
    function normalizeExposeFlag(value) {
        return value === true || value === 'true';
    }

    /** string legada / array / null -> array limpo de strings (vazio = sem filtro) */
    function normalizeList(value) {
        if (typeof value === 'string') {
            value = (value && value !== '0') ? [value] : [];
        }
        if (!Array.isArray(value)) return [];
        return value
            .filter(function (v) { return typeof v === 'string' && v.trim() !== ''; })
            .map(function (v) { return v.trim(); });
    }

    // ========================================================================
    // CÓDIGO MOVIDO DE nodes/server.js (constantes e funções de suporte)
    // ========================================================================

    // ═══════════════════════════════════════════════════════════════════════════
    // v3.1.0 - HOME ASSISTANT (MQTT Discovery) - constantes e funções de suporte
    // ═══════════════════════════════════════════════════════════════════════════

    /** Tempo (ms) à espera do estado "enabled" (retained) do HA antes de assumir ON */
    const HA_STATE_TIMEOUT_MS = 3000;

    /** property do Zigbee2MQTT -> device_class do Home Assistant (sensor) */
    const HA_SENSOR_DEVICE_CLASS = {
        temperature: 'temperature', humidity: 'humidity', pressure: 'pressure', battery: 'battery',
        illuminance: 'illuminance', illuminance_lux: 'illuminance', co2: 'carbon_dioxide',
        voltage: 'voltage', current: 'current', power: 'power', energy: 'energy'
    };

    /** property do Zigbee2MQTT -> device_class do Home Assistant (binary_sensor) */
    const HA_BINARY_DEVICE_CLASS = {
        occupancy: 'occupancy', presence: 'presence', water_leak: 'moisture', smoke: 'smoke',
        tamper: 'tamper', battery_low: 'battery'
    };

    /** Achata a árvore de exposes (features/composites) devolvendo só as folhas */
    function flattenExposes(list) {
        const out = [];
        (function walk(items) {
            if (!Array.isArray(items)) return;
            items.forEach(function (expose) {
                if (!expose || typeof expose !== 'object') return;
                if (Array.isArray(expose.features)) walk(expose.features);
                else out.push(expose);
            });
        })(list);
        return out;
    }

    /** Valor binário do Z2M -> texto que o template Jinja do HA devolve (true -> "True") */
    function haBinaryText(value, fallbackBool) {
        if (value === undefined || value === null) return fallbackBool ? 'True' : 'False';
        if (typeof value === 'boolean') return value ? 'True' : 'False';
        return String(value);
    }

    // ========================================================================
    // ENTITY TRACKER (novas / removidas / renomeadas)
    // ========================================================================

    /** Como identificar cada tipo de entidade Zigbee dentro da lista publicada pelo Z2M */
    const ENTITY_KEYS = Object.freeze({
        devices: function (item) { return item.ieee_address; },
        groups:  function (item) { return item.id; }
    });

    /**
     * update(kind, list) devolve:
     *   { kind, first, total, added:[chave], removed:[chave], renamed:[{key,from,to}], changed }
     * Na PRIMEIRA chamada (first=true) apenas semeia o estado: added/removed/renamed vêm vazios.
     * Um rename conta porque muda o state_topic da entidade no HA.
     */
    function createEntityTracker() {
        const known = { devices: null, groups: null }; // null = ainda não semeado

        return {
            update: function (kind, list) {
                const keyOf = ENTITY_KEYS[kind];
                const result = { kind: kind, first: false, total: 0, added: [], removed: [], renamed: [], changed: false };
                if (!keyOf) return result;

                const current = new Map();
                toArray(list).forEach(function (item) {
                    if (!item || typeof item !== 'object') return;
                    const key = keyOf(item);
                    if (key === undefined || key === null || key === '') return;
                    current.set(String(key), item.friendly_name ? String(item.friendly_name) : '');
                });
                result.total = current.size;

                const previous = known[kind];
                known[kind] = current;

                if (previous === null) {
                    result.first = true;
                    result.changed = true;
                    return result;
                }

                current.forEach(function (name, key) {
                    if (!previous.has(key)) {
                        result.added.push(key);
                    } else if (previous.get(key) !== name) {
                        result.renamed.push({ key: key, from: previous.get(key), to: name });
                    }
                });
                previous.forEach(function (name, key) {
                    if (!current.has(key)) result.removed.push(key);
                });

                result.changed = result.added.length > 0 || result.removed.length > 0 || result.renamed.length > 0;
                return result;
            },
            size: function (kind) { return known[kind] ? known[kind].size : 0; },
            reset: function () { known.devices = null; known.groups = null; }
        };
    }

    // ========================================================================
    // PENDING GUARD (TTL das mensagens em fila)
    // ========================================================================

    function createPendingGuard(options) {
        const opts = options || {};
        const ttlMs = (typeof opts.ttlMs === 'number' && opts.ttlMs >= 0) ? opts.ttlMs : DEFAULTS.PENDING_TTL_MS;
        // WeakMap: não impede o GC e não altera a mensagem (partilhada por todos os nós "in" do servidor)
        const stamps = new WeakMap();
        const isObject = function (value) { return value !== null && typeof value === 'object'; };

        return {
            ttlMs: ttlMs,
            stamp: function (message) { if (isObject(message)) stamps.set(message, Date.now()); },
            age: function (message) {
                const t = isObject(message) ? stamps.get(message) : undefined;
                return t === undefined ? 0 : Date.now() - t;
            },
            isStale: function (message) {
                if (!ttlMs) return false;
                const t = isObject(message) ? stamps.get(message) : undefined;
                return t !== undefined && (Date.now() - t) > ttlMs;
            },
            oldestAge: function (list) {
                const self = this;
                return toArray(list).reduce(function (max, message) { return Math.max(max, self.age(message)); }, 0);
            }
        };
    }

    // ========================================================================
    // LADO SERVIDOR: HomeAssistantManager  (nodes/server.js -> node.ha)
    // ========================================================================

    class HomeAssistantManager {
        /**
         * @param {Object} server  nó zigbee2mqtt-eb-server (usa mqtt, connection, logger, getTopic,
         *                         getBaseTopic, getStatusTopic, getDeviceOrGroupByKey, devices)
         */
        constructor(server) {
            this.server = server;
            // adota os Maps criados pelo servidor (server.haNodes / server.haConfigCache) para que os
            // callbacks MQTT existentes do server.js continuem a usá-los sem alterações
            if (!server.haNodes) server.haNodes = new Map();
            if (!server.haConfigCache) server.haConfigCache = new Map();
            this.tracker = createEntityTracker();
        }

        // ═══════════════════════════════════════════════════════════════════
        // v3.1.0 - HOME ASSISTANT: MQTT Discovery + estado enabled/disabled
        // ═══════════════════════════════════════════════════════════════════
        //
        // Por cada nó "in" com exposeToHomeAssistant publica (retained):
        //   homeassistant/<sensor|binary_sensor>/<node_id>/config   -> a entidade com o valor
        //   homeassistant/switch/<node_id>_enabled/config            -> switch "enabled" do nó
        // O estado do switch vive em  node-red/<base>/ha/<node_id>/enabled  (retained, ON/OFF)
        // e o HA comanda-o em         node-red/<base>/ha/<node_id>/enabled/set

        /** id seguro para usar em tópicos/unique_id a partir do id do nó Node-RED */
        haObjectId(clientNode) {
            return String(clientNode.id).replace(/[^a-zA-Z0-9_-]/g, '');
        }

        haIdFromString(value) {
            return String(value).replace(/[^a-zA-Z0-9_-]/g, '');
        }

        getHaDiscoveryPrefix() {
            return 'homeassistant';
        }

        /** node-red/<base>/ha/  (sempre com barra final) */
        getHaTopicPrefix() {
            return 'node-red/' + this.server.getBaseTopic() + '/ha/';
        }

        /** disponibilidade = o mesmo tópico retained/LWT do servidor ({"state":"online"|"offline"}) */
        haAvailability() {
            return {
                availability_topic: this.server.getStatusTopic(),
                availability_template: '{{ value_json.state }}',
                payload_available: 'online',
                payload_not_available: 'offline'
            };
        }

        registerHomeAssistantNode(clientNode) {
            const node = this.server;
            const self = this;
            if (!node.haNodes) return;
            const objId = self.haObjectId(clientNode);
            clientNode._haObjectId = objId;
            node.haNodes.set(objId, clientNode);
            node.logger.debug('Home Assistant: node "' + (clientNode.name || clientNode.id) + '" registered as ' + objId);

            // Se o MQTT já está ligado anuncia já; senão onMQTTConnect() trata de tudo.
            if (node.mqtt && node.connection) {
                self.subscribeHomeAssistant();
                self.publishHomeAssistantDiscovery(clientNode, true);
                self.scheduleHomeAssistantStateFallback(clientNode);
            }
        }

        unregisterHomeAssistantNode(clientNode, removed) {
            const node = this.server;
            const self = this;
            if (!node.haNodes) return;
            const objId = clientNode._haObjectId || self.haObjectId(clientNode);
            clearTimeout(clientNode._haFallbackTimer);
            if (node.haNodes.get(objId) === clientNode) node.haNodes.delete(objId);
            node.logger.debug('Home Assistant: node ' + objId + ' unregistered (' + (removed ? 'removed' : 'restart/deploy') + ')');
            // só apaga a entidade do HA se o nó foi mesmo removido (um deploy normal volta a anunciá-la)
            if (removed) self.clearHomeAssistantDiscovery(objId);
        }

        /** Apaga (payload vazio retained) todos os tópicos de discovery e o estado de um nó */
        clearHomeAssistantDiscovery(objId) {
            const node = this.server;
            const self = this;
            if (!node.mqtt || !node.connection || !node.haConfigCache) return;
            node.haConfigCache.forEach(function (entry, topic) {
                if (entry.objId === objId) {
                    node.mqtt.publish(topic, '', {qos: 1, retain: true});
                    node.haConfigCache.delete(topic);
                }
            });
            node.mqtt.publish(self.getHaTopicPrefix() + objId + '/enabled', '', {qos: 1, retain: true});
            node.logger.notice('Home Assistant: entities of node ' + objId + ' removed');
        }

        subscribeHomeAssistant() {
            const node = this.server;
            const self = this;
            if (!node.mqtt || !node.haNodes || !node.haNodes.size) return;
            const topic = self.getHaTopicPrefix() + '#';
            node.mqtt.subscribe(topic, {qos: 1}, function (err) {
                if (err) node.logger.warn('Home Assistant: could not subscribe to "' + topic + '": ' + err.message);
                else node.logger.debug('Home Assistant: subscribed to "' + topic + '"');
            });
        }

        publishHomeAssistantEnabledState(clientNode, enabled) {
            const node = this.server;
            const self = this;
            if (!node.mqtt || !node.connection) return;
            const objId = clientNode._haObjectId || self.haObjectId(clientNode);
            node.mqtt.publish(self.getHaTopicPrefix() + objId + '/enabled', enabled ? 'ON' : 'OFF', {qos: 1, retain: true});
        }

        /**
         * Se o HA não responder com o estado retained do switch dentro de HA_STATE_TIMEOUT_MS,
         * assume ON (primeira vez) para o nó não ficar para sempre a guardar mensagens.
         */
        scheduleHomeAssistantStateFallback(clientNode) {
            const node = this.server;
            const self = this;
            if (clientNode.homeAssistantStateInitialized) return;
            clearTimeout(clientNode._haFallbackTimer);
            clientNode._haFallbackTimer = setTimeout(function () {
                if (clientNode.homeAssistantStateInitialized) return;
                node.logger.debug('Home Assistant: no enabled state received for ' + (clientNode._haObjectId || clientNode.id) + ' within ' + (HA_STATE_TIMEOUT_MS / 1000) + 's - assuming ON');
                self.publishHomeAssistantEnabledState(clientNode, true);
                clientNode.setHomeAssistantState(true);
            }, HA_STATE_TIMEOUT_MS);
        }

        /**
         * Constrói as entidades de discovery de um nó "in".
         * @returns {{entities: Array, complete: boolean}} complete=false se a lista de devices ainda
         *          não está carregada (não se deve apagar entidades antigas nesse caso)
         */
        buildHomeAssistantEntities(clientNode) {
            const node = this.server;
            const self = this;
            const cfg = clientNode.config || {};
            const objId = clientNode._haObjectId || self.haObjectId(clientNode);
            const label = clientNode.name || cfg.friendly_name || ('Z2M ' + objId);
            const prefix = self.getHaTopicPrefix();
            const availability = self.haAvailability();
            const device = {
                identifiers: ['nodered_z2m_' + objId],
                name: label,
                manufacturer: 'Node-RED',
                model: 'zigbee2mqtt-eb in'
            };
            const entities = [];
            let complete = true;

            // 1) switch "enabled" (liga/desliga o nó a partir do HA)
            entities.push({
                component: 'switch',
                id: objId + '_enabled',
                payload: Object.assign({
                    unique_id: 'nodered_z2m_' + objId + '_enabled',
                    name: label + ' enabled',
                    command_topic: prefix + objId + '/enabled/set',
                    state_topic: prefix + objId + '/enabled',
                    payload_on: 'ON', payload_off: 'OFF',
                    state_on: 'ON', state_off: 'OFF',
                    entity_category: 'config',
                    device: device
                }, availability)
            });

            // 2) sensor / binary_sensor por device
            const keys = cfg.enableMultiple
                ? (Array.isArray(cfg.device_id) ? cfg.device_id : [])
                : (cfg.device_id ? [cfg.device_id] : []);
            const stateList = normalizeList(cfg.state).filter(function (p) {
                return p.indexOf('homekit_') !== 0 && p.indexOf("'") < 0;
            });
            if (!node.devices) complete = false;

            keys.forEach(function (key) {
                const item = node.getDeviceOrGroupByKey(key);
                if (!item) {
                    complete = false;
                    node.logger.throttle('debug', 'ha-nodev:' + key, 60000, 'Home Assistant: device/group "' + key + '" not found yet - entity not announced');
                    return;
                }
                const exposes = flattenExposes(item.definition && item.definition.exposes);
                const findExpose = function (p) {
                    for (let i = 0; i < exposes.length; i++) if (exposes[i].property === p) return exposes[i];
                    return null;
                };

                // propriedade principal = estado do HA: 1ª escolhida > "state" > 1º expose legível > linkquality
                let primary = stateList[0] || null;
                if (!primary && findExpose('state')) primary = 'state';
                if (!primary) {
                    const readable = exposes.find(function (e) { return e.property && ((Number(e.access) || 0) & 1); });
                    primary = readable ? readable.property : 'linkquality';
                }
                const expose = findExpose(primary);
                const friendly = item.friendly_name || item.ieee_address || String(key);
                const stateTopic = node.getTopic('/' + friendly);
                const entityId = cfg.enableMultiple ? (objId + '_' + self.haIdFromString(item.ieee_address || item.id || key)) : objId;
                const isBinary = !!expose && expose.type === 'binary';
                const isNumeric = !!expose && expose.type === 'numeric';

                const payload = Object.assign({
                    unique_id: 'nodered_z2m_' + entityId,
                    name: cfg.enableMultiple ? (label + ' ' + friendly) : label,
                    state_topic: stateTopic,
                    value_template: "{{ value_json['" + primary + "'] }}",
                    device: device
                }, availability);

                if (isBinary) {
                    payload.payload_on = haBinaryText(expose.value_on, true);
                    payload.payload_off = haBinaryText(expose.value_off, false);
                    if (HA_BINARY_DEVICE_CLASS[primary]) payload.device_class = HA_BINARY_DEVICE_CLASS[primary];
                } else if (isNumeric) {
                    if (expose.unit) payload.unit_of_measurement = expose.unit;
                    if (HA_SENSOR_DEVICE_CLASS[primary]) payload.device_class = HA_SENSOR_DEVICE_CLASS[primary];
                    payload.state_class = primary === 'energy' ? 'total_increasing' : 'measurement';
                }

                // várias propriedades (ou nenhuma = payload completo): o resto vai para os atributos da entidade
                if (stateList.length !== 1) {
                    payload.json_attributes_topic = stateTopic;
                    if (stateList.length > 1) {
                        payload.json_attributes_template = '{{ {' + stateList.map(function (p) {
                            return "'" + p + "': value_json.get('" + p + "')";
                        }).join(', ') + '} | tojson }}';
                    }
                }

                entities.push({component: isBinary ? 'binary_sensor' : 'sensor', id: entityId, payload: payload});
            });

            return {entities: entities, complete: complete};
        }

        /**
         * Publica (retained) o discovery de um nó. Só republica se o payload mudou (ou force=true).
         * Entidades antigas do mesmo nó que já não existem (ex.: sensor -> binary_sensor) são apagadas.
         */
        publishHomeAssistantDiscovery(clientNode, force) {
            const node = this.server;
            const self = this;
            if (!node.mqtt || !node.connection || !node.haConfigCache) return;

            const objId = clientNode._haObjectId || self.haObjectId(clientNode);
            const built = self.buildHomeAssistantEntities(clientNode);
            const discoveryPrefix = self.getHaDiscoveryPrefix();
            const seen = new Set();
            let published = 0;

            built.entities.forEach(function (entity) {
                const topic = discoveryPrefix + '/' + entity.component + '/' + entity.id + '/config';
                const body = JSON.stringify(entity.payload);
                seen.add(topic);

                const cached = node.haConfigCache.get(topic);
                if (!force && cached && cached.body === body) return;

                node.mqtt.publish(topic, body, {qos: 1, retain: true}, function (err) {
                    if (err) node.logger.warn('Home Assistant: discovery publish failed for ' + topic + ': ' + err.message);
                });
                node.haConfigCache.set(topic, {objId: objId, body: body});
                published++;
                node.logger.debug('Home Assistant: discovery published to ' + topic);
            });

            if (built.complete) {
                node.haConfigCache.forEach(function (entry, topic) {
                    if (entry.objId === objId && !seen.has(topic)) {
                        node.mqtt.publish(topic, '', {qos: 1, retain: true});
                        node.haConfigCache.delete(topic);
                        node.logger.debug('Home Assistant: stale entity removed (' + topic + ')');
                    }
                });
            }
            if (published) {
                node.logger.notice('Home Assistant: ' + published + ' entity(ies) announced for node "' + (clientNode.name || objId) + '"');
            }
        }

        /** Anuncia todos os nós expostos (ligação MQTT, bridge online, lista de devices atualizada) */
        announceHomeAssistantNodes(force) {
            const node = this.server;
            const self = this;
            if (!node.haNodes || !node.haNodes.size) return;
            node.haNodes.forEach(function (clientNode) {
                self.publishHomeAssistantDiscovery(clientNode, !!force);
            });
        }

        /** Mensagens em node-red/<base>/ha/<node_id>/enabled[/set] */
        onHomeAssistantMessage(topic, messageString) {
            const node = this.server;
            const self = this;
            const parts = topic.slice(self.getHaTopicPrefix().length).split('/');
            const clientNode = node.haNodes.get(parts[0]);
            if (!clientNode) {
                node.logger.debug('Home Assistant: message for an unregistered node ignored (' + topic + ')');
                return;
            }
            const value = String(messageString).trim().toUpperCase();

            if (parts.length === 2 && parts[1] === 'enabled') {
                if (value === '') return; // retained apagado
                clearTimeout(clientNode._haFallbackTimer);
                clientNode.setHomeAssistantState(value !== 'OFF');
            } else if (parts.length === 3 && parts[1] === 'enabled' && parts[2] === 'set') {
                let enabled;
                if (value === 'ON') enabled = true;
                else if (value === 'OFF') enabled = false;
                else if (value === 'TOGGLE') enabled = !clientNode.homeAssistantEnabled;
                else {
                    node.logger.debug('Home Assistant: invalid command "' + messageString + '" for ' + parts[0]);
                    return;
                }
                // fonte única de verdade: publicar o estado retained (volta por subscrição e aplica-se ao nó)
                self.publishHomeAssistantEnabledState(clientNode, enabled);
            }
        }

        /**
         * v3.1.x - MIDDLEWARE de deteção de entidades Zigbee.
         * Chamado depois de cada lista /bridge/devices e /bridge/groups. NÃO substitui nenhum callback
         * MQTT: só compara a lista com a anterior e age quando algo mudou.
         *
         *  - devices: o handler existente já chama announceHomeAssistantNodes(false); aqui só se regista
         *             no log o que mudou (novo / removido / renomeado).
         *  - groups:  o handler existente NÃO anunciava nada, por isso um nó "in" apontado a um grupo
         *             ficava sem entidade no HA até chegar outra lista de devices. Aqui re-anuncia-se
         *             apenas quando a lista de grupos muda de facto (a cache evita republicar o igual).
         */
        onZigbeeEntitiesUpdated(kind, list) {
            const node = this.server;
            const diff = this.tracker.update(kind, list);

            if (diff.first) {
                node.logger.debug('Home Assistant: ' + kind + ' list seeded (' + diff.total + ' entries)');
            } else if (diff.changed) {
                node.logger.notice('Zigbee2MQTT ' + kind + ' changed: +' + diff.added.length + ' new, -'
                    + diff.removed.length + ' removed, ' + diff.renamed.length + ' renamed');
                if (diff.added.length) node.logger.debug('Home Assistant: new ' + kind + ': ' + diff.added.join(', '));
                if (diff.removed.length) node.logger.debug('Home Assistant: removed ' + kind + ': ' + diff.removed.join(', '));
                diff.renamed.forEach(function (r) {
                    node.logger.debug('Home Assistant: ' + kind + ' renamed ' + r.from + ' -> ' + r.to + ' (state_topic changes, discovery will be republished)');
                });
            } else {
                return diff; // nada mudou: não há nada a anunciar
            }

            if (!node.haNodes || !node.haNodes.size) return diff;

            if (kind === 'groups') {
                this.announceHomeAssistantNodes(false);
            }
            return diff;
        }
    }

    // ========================================================================
    // LADO NÓ "in": HomeAssistantNodeState  (nodes/in.js -> node.haState)
    // ========================================================================

    class HomeAssistantNodeState {
        /**
         * Cria no nó os campos usados também pelo servidor (homeAssistantEnabled,
         * homeAssistantStateInitialized, homeAssistantPendingMessages) para manter o contrato existente.
         * @param {Object} node     nó zigbee2mqtt-eb-in
         * @param {Object} [options] { max, ttlMs }
         */
        constructor(node, options) {
            const opts = options || {};
            this.node = node;
            this.max = (typeof opts.max === 'number' && opts.max > 0) ? opts.max : DEFAULTS.PENDING_MAX;
            this.guard = createPendingGuard({ ttlMs: opts.ttlMs });

            node.homeAssistantEnabled = true;
            node.homeAssistantStateInitialized = !node.config.exposeToHomeAssistant;
            node.homeAssistantPendingMessages = [];
        }

        /** v3.1.0: registar no servidor para o anúncio (MQTT Discovery) e para o estado enabled/disabled */
        register() {
            const node = this.node;
            if (node.config.exposeToHomeAssistant && node.server && typeof node.server.registerHomeAssistantNode === 'function') {
                node.logger.debug('[Z2M] Registering node in the server for Home Assistant exposure');
                node.server.registerHomeAssistantNode(node);
            }
        }

        /** v3.1.0: libertar o registo Home Assistant (se removed=true limpa também o discovery retained) */
        unregister(removed) {
            const node = this.node;
            if (node.config.exposeToHomeAssistant && node.server && typeof node.server.unregisterHomeAssistantNode === 'function') {
                node.server.unregisterHomeAssistantNode(node, !!removed);
            }
        }

        clearPending() {
            this.node.homeAssistantPendingMessages = [];
        }

        /**
         * Chamado no início de onMQTTMessage do nó.
         * @returns {boolean} true se a mensagem foi consumida (enfileirada ou descartada)
         */
        intercept(data) {
            const node = this.node;
            if (!node.config.exposeToHomeAssistant) return false;

            // 1) Estado enabled/disabled ainda desconhecido: guardar para reproduzir depois
            if (!node.homeAssistantStateInitialized) {
                node.homeAssistantPendingMessages.push(data);
                this.guard.stamp(data);
                this.prune();
                while (node.homeAssistantPendingMessages.length > this.max) {
                    node.homeAssistantPendingMessages.shift(); // proteção de memória: descarta a mais antiga
                }
                node.logger.debug('[Z2M] Message queued: waiting for the Home Assistant enabled state (' + node.homeAssistantPendingMessages.length + ' pending)');
                if (node.homeAssistantPendingMessages.length === 1) {
                    // feedback visual enquanto a fila espera pelo estado enabled do HA
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: "@evilbunny/node-red-contrib-zigbee2mqtt/in:status.waiting_ha"
                    });
                }
                return true;
            }
            // 2) Nó desativado através do Home Assistant: descartar
            if (!node.homeAssistantEnabled) {
                node.logger.debug('[Z2M] Message dropped: node is disabled via Home Assistant');
                return true;
            }
            return false;
        }

        /** descarta da fila as mensagens mais velhas que o TTL; devolve quantas */
        prune() {
            const node = this.node;
            const before = node.homeAssistantPendingMessages.length;
            if (!before) return 0;

            const guard = this.guard;
            node.homeAssistantPendingMessages = node.homeAssistantPendingMessages.filter(function (msg) {
                return !guard.isStale(msg);
            });

            const dropped = before - node.homeAssistantPendingMessages.length;
            if (dropped) {
                node.logger.debug('[Z2M] Home Assistant queue: ' + dropped + ' stale message(s) discarded (older than '
                    + (guard.ttlMs / 1000) + 's)');
            }
            return dropped;
        }

        stats() {
            const node = this.node;
            return {
                pending: node.homeAssistantPendingMessages.length,
                oldestAgeMs: this.guard.oldestAge(node.homeAssistantPendingMessages),
                initialized: node.homeAssistantStateInitialized,
                enabled: node.homeAssistantEnabled
            };
        }

        setState(enabled) {
            let node = this.node;
            this.prune(); // nunca reproduzir leituras que expiraram enquanto se esperava pelo HA
            const wasInitialized = node.homeAssistantStateInitialized;
            const wasEnabled = node.homeAssistantEnabled;

            node.homeAssistantEnabled = !!enabled;
            node.homeAssistantStateInitialized = true;

            if (!wasInitialized || wasEnabled !== node.homeAssistantEnabled) {
                node.logger.notice('Home Assistant state: node is ' + (node.homeAssistantEnabled ? 'ENABLED' : 'DISABLED'));
            }

            const pending = node.homeAssistantPendingMessages;
            node.homeAssistantPendingMessages = [];

            if (node.homeAssistantEnabled) {
                // repor o último estado conhecido (o "disabled" tinha-o substituído)
                node.status(node.last_successful_status);
                if (pending.length) {
                    node.logger.debug('[Z2M] Replaying ' + pending.length + ' message(s) queued while waiting for the Home Assistant state');
                    pending.forEach(function (msg) { node.onMQTTMessage(msg); });
                }
            } else {
                if (pending.length) {
                    node.logger.debug('[Z2M] Message dropped: node is disabled via Home Assistant (' + pending.length + ' queued message(s) discarded)');
                }
                node.status({
                    fill: "grey",
                    shape: "ring",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/in:status.disabled_ha"
                });
            }
        }
    }

    return {
        DEFAULTS: DEFAULTS,
        normalizeExposeFlag: normalizeExposeFlag,
        normalizeList: normalizeList,
        flattenExposes: flattenExposes,
        haBinaryText: haBinaryText,
        HA_STATE_TIMEOUT_MS: HA_STATE_TIMEOUT_MS,
        HA_SENSOR_DEVICE_CLASS: HA_SENSOR_DEVICE_CLASS,
        HA_BINARY_DEVICE_CLASS: HA_BINARY_DEVICE_CLASS,
        createEntityTracker: createEntityTracker,
        createPendingGuard: createPendingGuard,
        createHomeAssistantManager: function (server) { return new HomeAssistantManager(server); },
        createHomeAssistantNodeState: function (node, options) { return new HomeAssistantNodeState(node, options); }
    };
}));
