const Zigbee2mqttHelper = require('../resources/Zigbee2mqttHelper.js');
// Node-RED system logger (4 levels); the level is the one chosen in the server config node
// (mesmo padrão do bridge.js: segue o nível do nó servidor em tempo real, sem redeploy)
const Z2MLogger = require('../resources/js/node-red-contrib-zigbee2mqtt-logger.js').Logger;

// ═══════════════════════════════════════════════════════════════════════════
// 📤 SAÍDA OPCIONAL "updated state" - constantes e funções de suporte
// ═══════════════════════════════════════════════════════════════════════════

/** Tempo máximo (ms) à espera que o Zigbee2MQTT publique o novo estado após um comando */
const OUTPUT_STATE_TIMEOUT = 30_000;

/** Alias mantido: o resto do ficheiro (node.pendingTimeoutMs) continua a usar este nome */
const PENDING_OUTPUT_TIMEOUT_MS = OUTPUT_STATE_TIMEOUT;

/** Proteção de memória: máximo de comandos em espera por tópico de estado */
const MAX_PENDING_PER_TOPIC = 20;

const SET_SUFFIX_REGEX = /\/set$/i;

/**
 * Comandos cujo "eco" no estado NÃO tem o mesmo nome da propriedade enviada.
 * Ex.: brightness_step -> o Z2M publica o novo "brightness".
 */
const ECHO_ALIASES = {
    brightness_move:       ['brightness'],
    brightness_step:       ['brightness'],
    brightness_move_onoff: ['brightness'],
    brightness_step_onoff: ['brightness'],
    color_temp_move:       ['color_temp'],
    color_temp_step:       ['color_temp']
};

/** Comandos sem eco previsível (scene_recall, scene_store, ...) -> aceitam qualquer atualização */
const NO_ECHO_REGEX = /^scene_/;

/** O item é um grupo? (os devices têm sempre ieee_address; os grupos têm apenas id) */
function isGroupItem(item) {
    return !!item && !item.ieee_address && item.id !== undefined && item.id !== null;
}

/**
 * Nomes de endpoint conhecidos de um device (definition.exposes[].endpoint + chaves de item.endpoints).
 * Usado para validar que "left" em "sw/left/set" é mesmo um endpoint e não parte do friendly_name.
 */
function collectEndpoints(item) {
    const found = new Set();
    (function walk(list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (expose) {
            if (!expose || typeof expose !== 'object') return;
            if (expose.endpoint) found.add(String(expose.endpoint));
            if (Array.isArray(expose.features)) walk(expose.features);
        });
    })(item && item.definition && item.definition.exposes);
    if (item && item.endpoints && typeof item.endpoints === 'object') {
        Object.keys(item.endpoints).forEach(function (k) { found.add(String(k)); });
    }
    return found;
}

/** Se o device declara endpoints, o candidato tem de pertencer-lhes; se não declara nenhum, aceita-se. */
function isValidEndpoint(item, candidate) {
    if (!candidate) return false;
    const known = collectEndpoints(item);
    return known.size === 0 || known.has(String(candidate));
}

/**
 * Resolve a "chave" de destino de um comando para um device/grupo concreto.
 *
 * Aceita (key):
 *   - ieee_address                      "0x00158d0001234567"
 *   - friendly_name (com ou sem pastas) "sala/candeeiro"
 *   - tópico completo                   "zigbee2mqtt/sala/candeeiro"
 *   - tópico de comando                 "zigbee2mqtt/sala/candeeiro/set"
 *   - endpoint específico               "zigbee2mqtt/interruptor/left/set" ou "interruptor/left"
 *   - id de grupo                       5 | "5"
 *
 * @param {Object} server  nó zigbee2mqtt-eb-server
 * @param {*}      key
 * @returns {{
 *   found: boolean, item: Object|null, isGroup: boolean,
 *   friendly_name: string|null, ieee_address: string|null, groupId: *,
 *   endpoint: string|null, hasSetSuffix: boolean,
 *   stateTopic: string|null, setTopic: string|null
 * }}
 */
function resolveDeviceTarget(server, key) {
    const target = {
        found: false, item: null, isGroup: false,
        friendly_name: null, ieee_address: null, groupId: null,
        endpoint: null, hasSetSuffix: false,
        stateTopic: null, setTopic: null
    };

    if (!server || typeof server.getDeviceOrGroupByKey !== 'function') return target;
    if (key === undefined || key === null) return target;

    const raw = String(key).trim();
    if (!raw) return target;

    // 1) Procura direta (ieee_address, friendly_name, tópico completo, id de grupo)
    let item = server.getDeviceOrGroupByKey(raw);
    let endpoint = null;
    let hasSetSuffix = false;

    // 2) Tópico de comando: remover "/set" e o prefixo do base topic
    if (!item) {
        let path = raw;

        if (SET_SUFFIX_REGEX.test(path)) {
            hasSetSuffix = true;
            path = path.replace(SET_SUFFIX_REGEX, '');
        }

        const base = (typeof server.getBaseTopic === 'function') ? server.getBaseTopic() : '';
        if (base && path.indexOf(base + '/') === 0) {
            path = path.slice(base.length + 1);
        }
        path = path.replace(/^\/+|\/+$/g, '');

        if (path) {
            item = server.getDeviceOrGroupByKey(path);

            // 3) Endpoint específico: "<friendly_name>/<endpoint>" (o friendly_name pode ter pastas,
            //    por isso só se corta o ÚLTIMO segmento e só se o resto for um device válido)
            if (!item) {
                const idx = path.lastIndexOf('/');
                if (idx > 0) {
                    const parentPath = path.slice(0, idx);
                    const candidate = path.slice(idx + 1);
                    const parent = server.getDeviceOrGroupByKey(parentPath);
                    if (parent && !isGroupItem(parent) && isValidEndpoint(parent, candidate)) {
                        item = parent;
                        endpoint = candidate;
                    }
                }
            }
        }
    }

    if (!item) return target;

    const isGroup = isGroupItem(item);
    target.found = true;
    target.item = item;
    target.isGroup = isGroup;
    target.friendly_name = item.friendly_name || item.ieee_address || null;
    target.ieee_address = isGroup ? null : (item.ieee_address || null);
    target.groupId = isGroup ? item.id : null;
    target.endpoint = isGroup ? null : endpoint;
    target.hasSetSuffix = hasSetSuffix;

    // O Z2M publica SEMPRE o estado em <base>/<friendly_name> (os endpoints vêm como state_left, ...),
    // mas recebe os comandos em <base>/<friendly_name>[/<endpoint>]/set
    target.stateTopic = server.getTopic('/' + target.friendly_name);
    target.setTopic = target.stateTopic + (target.endpoint ? '/' + target.endpoint : '') + '/set';

    return target;
}

/**
 * Propriedades que se espera ver no estado publicado depois do comando.
 * Lista vazia = qualquer atualização de estado serve de resposta.
 */
function deriveExpectedProps(toSend) {
    if (!toSend || typeof toSend !== 'object' || Array.isArray(toSend)) return [];
    const props = new Set();
    Object.keys(toSend).forEach(function (k) {
        if (NO_ECHO_REGEX.test(k)) return;
        if (ECHO_ALIASES[k]) {
            ECHO_ALIASES[k].forEach(function (p) { props.add(p); });
        } else {
            props.add(k);
        }
    });
    return Array.from(props);
}

/**
 * v3.1.0 - Normalização do comando "color".
 * O Z2M espera {"color": {...}}. Se o payload for um objeto sem a chave "color" (ex.: {x, y}),
 * é embrulhado: { color: payload }. Aceita também um JSON em string (ex.: as opções da droplist
 * do comando "color" são strings como '{"x":0.701,"y":0.299}').
 * Idempotente: se já tiver a chave "color", devolve o objeto tal como está.
 * Para qualquer outro comando (ou valor não-objeto) devolve o payload original (mesma referência).
 */
function normalizeColorPayload(command, payload) {
    if (command !== 'color') return payload;

    let value = payload;
    if (typeof value === 'string' && Zigbee2mqttHelper.isJson(value)) {
        try { value = JSON.parse(value); } catch (e) { return payload; }
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return payload;

    return ('color' in value) ? value : { color: value };
}

module.exports = function(RED) {
    class Zigbee2mqttNodeOut {
        constructor(config) {
            RED.nodes.createNode(this, config);

            let node = this;
            node.config = config;
            node.cleanTimer = null;
            node.server = RED.nodes.getNode(node.config.server);
            // Logger Node-RED: segue o nível do nó servidor selecionado (live, sem redeploy)
            node.logger = Z2MLogger.create(node, {
                prefix: 'Out',
                getLevel: function () { return node.server ? node.server.debug_level : undefined; }
            });

            // ── Saída opcional "updated state" ───────────────────────────────
            node.outputEnabled = (config.outputEnabled === true || config.outputEnabled === 'true');
            // Tolerância: flows exportados/editados onde só o nº de portas ("outputs") ficou gravado
            if (!node.outputEnabled && parseInt(config.outputs, 10) > 0) {
                node.outputEnabled = true;
                node.logger.debug('Output port enabled from config.outputs=' + config.outputs + ' (outputEnabled flag was missing)');
            }
            node.logger.debug('Output port "updated state": ' + (node.outputEnabled ? 'ENABLED (1 output)' : 'disabled (0 outputs)'));
            node.pendingOutputs = new Map();                   // stateTopic -> [entry, entry, ...] (FIFO)
            node.pendingTimeoutMs = PENDING_OUTPUT_TIMEOUT_MS; // 30 s

            if (node.server) {
                // ✅ SUBSCREVER EVENTOS DO SERVIDOR
                node.listener_onMQTTConnect = function() { node.onMQTTConnect(); }
                node.server.on('onMQTTConnect', node.listener_onMQTTConnect);

                node.listener_onConnectError = function() { node.onConnectError(); }
                node.server.on('onConnectError', node.listener_onConnectError);

                node.listener_onMQTTBridgeState = function(data) { node.onMQTTBridgeState(data); }
                node.server.on('onMQTTBridgeState', node.listener_onMQTTBridgeState);

                // ✅ Só subscreve atualizações de estado se a saída estiver ativa
                //    (nós sem saída não pagam qualquer custo em runtime)
                if (node.outputEnabled) {
                    node.listener_onMQTTMessage = function(data) { node.onMQTTMessage(data); }
                    node.server.on('onMQTTMessage', node.listener_onMQTTMessage);
                }

                node.on('close', () => node.onClose());

                // ✅ MOSTRAR STATUS INICIAL
                if (typeof(node.server.mqtt) === 'object' && node.server.connection) {
                    node.status({
                        fill: "green",
                        shape: "ring",
                        text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.ready"
                    });
                } else {
                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.mqtt_disconnected"
                    });
                }

                node.on('input', function(message, send, done) {
                    // for Node-RED < 1.0 compatibility
                    send = send || function() { node.send.apply(node, arguments); };
                    done = done || function(err) { if (err) { node.error(err, message); } };

                    // NOTA: a (única) saída do nó está reservada ao "updated state" e é emitida
                    // por onMQTTMessage(). O antigo resultado booleano (success) deixou de sair
                    // aqui - o resultado do envio é reportado através de done(err).
                    function sendResult(success, err) {
                        // [ORIGINAL - desativado: a saída passou a ser reservada ao "updated state"]
                        // let result = RED.util.cloneMessage(message);
                        // result.payload = success;
                        // send(result);
                        done(err);
                    }

                    clearTimeout(node.cleanTimer);

                    // ✅ VALIDAR CONEXÃO
                    if (!node.server || !node.server.mqtt || !node.server.connection) {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.mqtt_not_connected"
                        });
                        node.error("MQTT not connected - cannot publish message");
                        sendResult(false);
                        return;
                    }

                    let key = node.config.device_id;
                    if ((!key || key === 'msg.topic') && message.topic) {
                        key = message.topic;
                    }
                    
                    // ✅ Resolve device OU grupo, e deteta "/set" e endpoints (ex.: left/set)
                    // [ORIGINAL] let device = node.server.getDeviceOrGroupByKey(key);
                    const target = resolveDeviceTarget(node.server, key);
                    let device = target.item;
                    
                    if (device) {
                        let payload;
                        let options = {};
                        
                        // 1. PROCESSAR PAYLOAD
                        switch (node.config.payloadType) {
                            case '':
                            case null:
                            case 'nothing':
                                payload = null;
                                break;

                            case 'flow':
                            case 'global': {
                                RED.util.evaluateNodeProperty(node.config.payload, node.config.payloadType, node, message, function (error, result) {
                                    if (error) {
                                        node.error(error, message);
                                    } else {
                                        payload = result;
                                    }
                                });
                                break;
                            }
                            
                            case 'z2m_payload':
                                // Lógica para valor manual vinda do slider ou input numérico
                                if (node.config.payload === '__manual__' && node.config.manualPayloadValue) {
                                    payload = node.config.manualPayloadValue;
                                } else {
                                    payload = node.config.payload;
                                }
                                break;

                            case 'num': {
                                // v3.1.0: números sempre via parseFloat() (já era assim na v3.3.8)
                                payload = parseFloat(node.config.payload);
                                // (robustez) NaN seria serializado como null por JSON.stringify e enviado ao device
                                if (isNaN(payload)) {
                                    node.logger.throttle('warn', 'num-nan', 30000,
                                        'Payload of type "num" is not a valid number: ' + JSON.stringify(node.config.payload));
                                    node.status({
                                        fill: "red",
                                        shape: "dot",
                                        text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.no_payload"
                                    });
                                    sendResult(false);
                                    return;
                                }
                                break;
                            }

                            case 'str': {
                                payload = node.config.payload;
                                break;
                            }

                            case 'json': {
                                try {
                                        const rawPayload = node.config.payload;
                                        if (typeof rawPayload === 'object' && rawPayload !== null) {
                                            payload = rawPayload;
                                        } else if (typeof rawPayload === 'string' && rawPayload.trim() !== '') {
                                            payload = JSON.parse(rawPayload);
                                        } else {
                                             // Handle numbers/booleans gracefully if passed as config
                                            payload = rawPayload;
                                        }
                                } catch (e) {
                                    node.warn('Incorrect payload. Waiting for valid JSON: ' + e.message);
                                    node.status({
                                        fill: "red",
                                        shape: "dot",
                                        text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.no_payload"
                                    });
                                    node.cleanTimer = setTimeout(function(){
                                        node.status({}); 
                                    }, 3000);
                                    sendResult(false);
                                    return;
                                }
                                break;
                            }

                            case 'msg':
                            default: {
                                payload = message[node.config.payload];

                                // v3.1.0: comando "color" + payload objeto sem a chave "color" -> { color: payload }
                                // O comando só é resolvido no passo 2, por isso é calculado aqui antecipadamente
                                // (commandType 'msg' lê o nome do comando da própria mensagem).
                                const earlyCommand = (node.config.commandType === 'msg')
                                    ? message[node.config.command]
                                    : node.config.command;
                                const colorNormalized = normalizeColorPayload(earlyCommand, payload);
                                if (colorNormalized !== payload) {
                                    node.logger.debug('Payload for command "color" wrapped as {"color": ...} (msg.' + node.config.payload + ')');
                                    payload = colorNormalized;
                                }
                                break;
                            }
                        }

                        // 2. PROCESSAR COMANDO
                        let command;
                        switch (node.config.commandType) {
                            case '':
                            case null:
                            case 'nothing':
                                payload = null;
                                break;

                            case 'msg': {
                                command = message[node.config.command];
                                break;
                            }
                            
                            case 'z2m_cmd':
                                command = node.config.command;
                                
                                // Detetar comandos state_lX
                                if (command && command.match(/^state_l\d+$/)) {
                                    if (payload === 'TOGGLE' || payload === 'toggle') {
                                        if (device.current_values && command in device.current_values) {
                                            const currentState = device.current_values[command];
                                            payload = (currentState === 'ON' || currentState === 'on') ? 'OFF' : 'ON';
                                        } else {
                                            payload = 'OFF';
                                        }
                                    }
                                } 
                                else {
                                    switch (command) {
                                        case 'color_rgb':
                                            if (typeof payload === 'string' && payload.includes(',')) {
                                                const p = payload.split(',');
                                                payload = { color: { r: parseInt(p[0]), g: parseInt(p[1]), b: parseInt(p[2]) } };
                                                command = null; // Envia payload direto
                                            } else {
                                                payload = {"color": {"rgb": payload}};
                                                command = null;
                                            }
                                            break;
                                            
                                        case 'color_xy':
                                            if (typeof payload === 'string' && payload.includes(',')) {
                                                const p = payload.split(',');
                                                payload = { color: { x: parseFloat(p[0]), y: parseFloat(p[1]) } };
                                                command = null;
                                            } else {
                                                payload = {"color": {"x": payload}};
                                                command = null;
                                            }
                                            break;

                                        case 'color_hsb':
                                            if (typeof payload === 'string' && payload.includes(',')) {
                                                const p = payload.split(',');
                                                payload = { color: { h: parseInt(p[0]), s: parseInt(p[1]), b: parseInt(p[2]) } };
                                                command = null;
                                            } else {
                                                payload = {"color": {"hsb": payload}};
                                                command = null;
                                            }
                                            break;
                                            
                                        case 'color_hex':
                                            payload = {"color": {"hex": payload}};
                                            command = null;
                                            break;
                                            
                                        case 'color_hue':
                                            payload = {"color": {"hue": parseInt(payload)}};
                                            command = null;
                                            break;
                                            
                                        case 'color_saturation':
                                            payload = {"color": {"saturation": parseInt(payload)}};
                                            command = null;
                                            break;
                                        case 'state':
                                            if (payload === 'toggle' || payload === 'TOGGLE') {
                                                if (device.current_values && 'position' in device.current_values) {
                                                    payload = device.current_values.position > 0 ? 'close' : 'open';
                                                } else if (device.current_values && 'state' in device.current_values) {
                                                    const currentState = device.current_values.state;
                                                    payload = (currentState === 'ON' || currentState === 'on') ? 'OFF' : 'ON';
                                                } else {
                                                    payload = 'ON';
                                                }
                                            }
                                            break;
                                            
                                        case 'brightness':
                                            payload = parseInt(payload);
                                            if (isNaN(payload)) {
                                                node.warn("Invalid brightness value received: " + message.payload);
                                                sendResult(false);
                                                return;
                                            }
                                            options["state"] = payload > 0 ? "on" : "Off";
                                            break;

                                        case 'position':
                                            payload = parseInt(payload);
                                            if (isNaN(payload)) { sendResult(false); return; }
                                            break;

                                        // v3.1.0: tilt (inclinação de estores/venezianas, 0-100) -> sempre inteiro
                                        case 'tilt': {
                                            const rawTilt = payload;
                                            payload = parseInt(payload);
                                            if (isNaN(payload)) {
                                                node.logger.throttle('warn', 'tilt-nan', 30000,
                                                    'Invalid "tilt" value: ' + JSON.stringify(rawTilt));
                                                sendResult(false);
                                                return;
                                            }
                                            node.logger.debug('Command "tilt": ' + JSON.stringify(rawTilt) + ' -> ' + payload);
                                            break;
                                        }
                                        
                                        // v3.1.0: "scene" é um alias interno -> o Z2M só conhece "scene_recall" (payload inteiro)
                                        case 'scene': {
                                            const rawScene = payload;
                                            command = 'scene_recall';
                                            payload = parseInt(payload);
                                            if (isNaN(payload)) {
                                                node.logger.throttle('warn', 'scene-nan', 30000,
                                                    'Invalid scene id: ' + JSON.stringify(rawScene));
                                                sendResult(false);
                                                return;
                                            }
                                            node.logger.debug('Command "scene" renamed to "scene_recall" (id ' + payload + ')');
                                            break;
                                        }

                                        case 'lock':
                                            command = 'state';
                                            if (payload === 'toggle' || payload === 'TOGGLE') {
                                                if (device.current_values && 'lock_state' in device.current_values && device.current_values.lock_state === 'locked') {
                                                    payload = 'unlock';
                                                } else {
                                                    payload = 'lock';
                                                }
                                            } else if (payload === 'lock' || payload == 1 || payload === true || payload === 'on') {
                                                payload = 'lock';
                                            } else if (payload === 'unlock' || payload == 0 || payload === false || payload === 'off') {
                                                payload = 'unlock';
                                            }
                                            break;

                                        // v3.1.0: payload objeto (ou JSON em string) sem a chave "color" -> { color: payload }
                                        //         (cobre também os payloads json / str / z2m_payload, não só msg)
                                        case 'color': {
                                            const colorFixed = normalizeColorPayload(command, payload);
                                            if (colorFixed !== payload) {
                                                node.logger.debug('Command "color": payload normalised to ' + JSON.stringify(colorFixed));
                                                payload = colorFixed;
                                            }
                                            break;
                                        }
//                                            [ORIGINAL - desativado]
//                                            payload = {"color": payload};
//                                            break;
                                            
                                        case 'color_rgb':
//                                            payload = {"color": {"rgb": payload}};
//                                            break;
                                            
                                        case 'color_hex':
//                                            command = "color";
//                                            payload = {"color": {"hex": payload}};
//                                            break;
                                            
                                        case 'color_hsb':
//                                            command = "color";
//                                            payload = {"color": {"hsb": payload}};
//                                            break;
                                            
                                        case 'color_hsv':
//                                            command = "color";
//                                            payload = {"color": {"hsv": payload}};
//                                            break;
                                            
                                        case 'color_hue':
//                                            command = "color";
//                                            payload = {"color": {"hue": payload}};
//                                            break;
                                            
                                        case 'color_saturation':
//                                            command = "color";
//                                            payload = {"color": {"saturation": payload}};
//                                            break;

                                        case 'color_temp':
                                        case 'brightness_move':
                                        case 'brightness_step':
                                        case 'alert':
                                        default:
                                            break;
                                    }
                                }
                                break;

                            case 'homekit':
                                payload = node.fromHomeKitFormat(message, device);
                                break;

                            case 'json': {
                                // JSON command: the object typed in the command field is sent as-is,
                                // with an object payload (if any) merged over it. An empty {} (the
                                // original meaning) just sends the payload object unchanged.
                                let commandObject = {};
                                const rawCommand = node.config.command;
                                if (rawCommand && typeof rawCommand === 'object') {
                                    commandObject = rawCommand;
                                } else if (typeof rawCommand === 'string' && rawCommand.trim() !== '') {
                                    try {
                                        commandObject = JSON.parse(rawCommand);
                                    } catch (e) {
                                        node.warn('Command is not valid JSON: ' + e.message);
                                        node.status({fill: "red", shape: "dot", text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.invalid_json_command"});
                                        sendResult(false);
                                        return;
                                    }
                                }
                                if (!commandObject || typeof commandObject !== 'object' || Array.isArray(commandObject)) {
                                    node.warn('JSON command must be an object, e.g. {"state":"ON"}');
                                    node.status({fill: "red", shape: "dot", text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.invalid_json_command"});
                                    sendResult(false);
                                    return;
                                }
                                if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
                                    payload = Object.assign({}, commandObject, payload);
                                } else if (Object.keys(commandObject).length) {
                                    payload = commandObject;
                                }
                                command = null;
                                break;
                            }

                            case 'str':
                            default: {
                                command = node.config.command;
                                break;
                            }
                        }

                        // v3.1.0: diagnóstico do que foi resolvido (JSON.stringify só com o nível debug ativo)
                        if (node.logger.isEnabled('debug')) {
                            node.logger.debug('Resolved -> target="' + (target.friendly_name || key) + '"'
                                + (target.endpoint ? ' endpoint=' + target.endpoint : '')
                                + ' commandType=' + node.config.commandType + ' command=' + JSON.stringify(command)
                                + ' payloadType=' + node.config.payloadType + ' payload=' + JSON.stringify(payload));
                        }

                        // 3. PROCESSAR OPÇÕES
                        let optionsToSend = {};
                        switch (node.config.optionsType) {
                            case '':
                            case null:
                            case 'nothing':
                                break;

                            case 'msg':
                                if (node.config.optionsValue in message && typeof(message[node.config.optionsValue]) == 'object') {
                                    optionsToSend = message[node.config.optionsValue];
                                } else {
                                    node.warn('Options value has invalid format');
                                }
                                break;

                            case 'json':
                                if (Zigbee2mqttHelper.isJson(node.config.optionsValue)) {
                                    optionsToSend = JSON.parse(node.config.optionsValue);
                                } else {
                                    node.warn('Options value is not valid JSON, ignore: ' + node.config.optionsValue);
                                }
                                break;

                            default:
                                optionsToSend[node.config.optionsType] = node.config.optionsValue;
                                break;
                        }

                        if (Object.keys(optionsToSend).length) {
                            node.server.setDeviceOptions(device.friendly_name, optionsToSend);
                        }

                         // 4. ENVIAR COMANDO
                        if (payload !== undefined && payload !== null) {
                            let toSend = {};
                            let statusText = '';
                            // /set normal, ou <fn>/<endpoint>/set quando o destino é um endpoint específico
                            // [ORIGINAL] let topic = node.server.getTopic('/' + device.friendly_name + '/set');
                            let topic = target.setTopic;
                            let pendingEntry = null;

                            try {
                                // Lógica de construção do objeto (Cores vs Simples)
                                if (command === null) {
                                    toSend = payload;
                                    statusText = JSON.stringify(payload);
                                }
                                else if (typeof(payload) === 'object') {
                                    toSend = payload;
                                    statusText = JSON.stringify(payload);
                                } 
                                else {
                                    toSend[command] = payload;
                                    statusText = String(payload);
                                }

                                const payloadStr = JSON.stringify(toSend);

                                // v3.1.0: comando final + tópico MQTT onde vai ser publicado
                                node.logger.debug('Publishing -> topic="' + topic + '" final command='
                                    + ((command === null || command === undefined) ? '(none: payload sent as object)' : JSON.stringify(command))
                                    + ' payload=' + payloadStr);

                                if (RED.settings.verbose) {
                                    node.log('Published to mqtt topic: ' + topic + ' : ' + payloadStr);
                                }

                                // ✅ Registar o pedido ANTES de publicar: o Z2M pode responder
                                //    (publicar o novo estado) antes de o callback do publish correr.
                                if (node.outputEnabled) {
                                    pendingEntry = node.registerPendingOutput(message, target, toSend);
                                }

                                node.server.mqtt.publish(
                                    topic,
                                    payloadStr,
                                    {'qos': parseInt(node.server.config.mqtt_qos || 0)},
                                    function(err) {
                                        if (err) {
                                            // falhou o envio -> nunca haverá resposta, não ficar à espera
                                            node.removePendingOutput(pendingEntry);
                                            node.status({fill: "red", shape: "dot", text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.publish_failed"});
                                            node.error("MQTT publish error: " + err.message, message);
                                        }
                                        sendResult(!err, err);
                                    }
                                );

                                // Atualizar Status Visual
                                // [ORIGINAL] let fill = node.server.getDeviceAvailabilityColor(node.server.getTopic('/' + device.friendly_name));
                                let fill = node.server.getDeviceAvailabilityColor(target.stateTopic);
                                node.status({ fill: fill, shape: "dot", text: statusText });
                                
                                node.cleanTimer = setTimeout(function(){
                                    node.status({ fill: fill, shape: "ring", text: statusText });
                                }, 3000);

                            } catch (e) {
                                node.removePendingOutput(pendingEntry);
                                node.error("Serialization error: " + e.message, message);
                                node.status({fill: "red", shape: "dot", text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.error"});
                                sendResult(false, e);
                            }
                        } else {
                            // Else do payload válido
                            node.status({
                                fill: "red",
                                shape: "dot",
                                text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.no_payload"
                            });
                            sendResult(false);
                        }
                    
                    } else { 
                        // ✅ FECHEI O IF (DEVICE) AQUI
                        // Else do device encontrado
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.no_device"
                        });
                        node.error(`Device not found for key: ${key}`, message);
                        sendResult(false);
                    }
                });
 
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.no_server"
                });
            }
        }
 
           
        updateStatus() {
            let node = this;
            if (!node.server || !node.server.mqtt || !node.server.connection) {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.mqtt_disconnected"
                });
            } else {
                node.status({
                    fill: "green",
                    shape: "ring",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.ready"
                });
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // 📤 SAÍDA OPCIONAL "updated state"
        // ═══════════════════════════════════════════════════════════════════

        /**
         * Regista um comando à espera do novo estado do device/grupo.
         * Cada entrada expira ao fim de node.pendingTimeoutMs (30 s) se o device não responder.
         * @returns {Object} entry (para poder ser removida se o publish falhar)
         */
        registerPendingOutput(message, target, toSend) {
            let node = this;

            // Guarda: sem porta de saída ativa não há para onde emitir a resposta
            // (removePendingOutput(null) é seguro, por isso os chamadores não precisam de mudar)
            if (!node.outputEnabled) return null;

            const entry = {
                topic: target.stateTopic,
                target: target,
                endpoint: target.endpoint,
                props: deriveExpectedProps(toSend),
                msg: RED.util.cloneMessage(message), // snapshot: a msg original continua o seu caminho
                sentAt: Date.now(),
                timer: null
            };

            let queue = node.pendingOutputs.get(entry.topic) || [];
            while (queue.length >= MAX_PENDING_PER_TOPIC) {
                const dropped = queue.shift();
                clearTimeout(dropped.timer);
                node.debug('Pending output queue full for ' + entry.topic + ' - dropping the oldest request');
            }
            queue.push(entry);
            node.pendingOutputs.set(entry.topic, queue);

            entry.timer = setTimeout(function () {
                if (node.removePendingOutput(entry)) {
                    node.debug('No state update from ' + entry.topic + ' within ' + (node.pendingTimeoutMs / 1000) + 's - discarding the pending output');
                }
            }, node.pendingTimeoutMs);

            return entry;
        }

        /** Remove (e cancela o timeout de) uma entrada pendente. @returns {boolean} true se existia */
        removePendingOutput(entry) {
            let node = this;
            if (!entry) return false;

            clearTimeout(entry.timer);

            const queue = node.pendingOutputs.get(entry.topic);
            if (!queue) return false;

            const idx = queue.indexOf(entry);
            if (idx < 0) return false;

            queue.splice(idx, 1);
            if (!queue.length) node.pendingOutputs.delete(entry.topic);
            return true;
        }

        /** Cancela todos os timeouts e limpa os pedidos pendentes */
        flushPendingOutputs() {
            let node = this;
            node.pendingOutputs.forEach(function (queue) {
                queue.forEach(function (entry) { clearTimeout(entry.timer); });
            });
            node.pendingOutputs.clear();
        }

        /**
         * A atualização de estado serve de resposta ao comando?
         * Se o comando enviou propriedades conhecidas (state, brightness, ...), o estado
         * publicado tem de conter pelo menos uma delas (ou a variante _<endpoint>, ex.: state_left).
         * Isto evita fechar o pedido com um relatório não relacionado (linkquality, temperatura, ...).
         */
        isResponseFor(entry, payload) {
            if (!payload || typeof payload !== 'object') return false;
            if (!entry.props.length) return true;
            return entry.props.some(function (prop) {
                return (prop in payload) || (entry.endpoint && ((prop + '_' + entry.endpoint) in payload));
            });
        }

        /**
         * Listener de 'onMQTTMessage' do servidor: estado publicado pelo Zigbee2MQTT
         * ({topic, payload, item, retained}). Só trata mensagens "ao vivo" de tópicos com pedidos pendentes.
         */
        onMQTTMessage(data) {
            let node = this;

            if (!node.pendingOutputs.size) return;          // caminho rápido: nada à espera
            if (!data || data.retained) return;             // retained = replay do broker, não é resposta

            const queue = node.pendingOutputs.get(data.topic);
            if (!queue || !queue.length) return;

            // FIFO: resolve o pedido mais antigo que corresponda a esta atualização
            const idx = queue.findIndex(function (entry) { return node.isResponseFor(entry, data.payload); });
            if (idx < 0) {
                node.logger.debug('State update from ' + data.topic + ' ignored: it does not contain any of [' + queue[0].props.join(', ') + ']');
                return;
            }

            const entry = queue[idx];
            node.removePendingOutput(entry);                // limpa o timeout e remove do Map
            node.logger.debug('State confirmed for ' + data.topic + ' after ' + (Date.now() - entry.sentAt) + 'ms (expected: ' + (entry.props.length ? entry.props.join(', ') : 'any') + ')');

            const item = data.item || node.server.getDeviceOrGroupByKey(entry.target.friendly_name);
            // current_values = estado acumulado (o servidor já fez o merge antes de emitir)
            const state = (item && item.current_values) ? item.current_values : data.payload;

            const out = entry.msg;
            if ('payload' in out) {
                out.payload_in = out.payload;
            }
            out.topic = data.topic;
            out.payload = state;
            out.payload_raw = state;
            out.homekit = item ? item.homekit : null;
            out.format = item ? item.format : null;
            out.selector = Zigbee2mqttHelper.generateSelector(data.topic);
            out.item = item;

            node.send(out);
        }

        onMQTTConnect() {
            let node = this;
            node.status({
                fill: "green",
                shape: "ring",
                text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.mqtt_connected"
            });
            clearTimeout(node.cleanTimer);
            node.cleanTimer = setTimeout(function() {
                node.status({
                    fill: "green",
                    shape: "ring",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.ready"
                });
            }, 3000);
        }

        onConnectError() {
            let node = this;
            // sem ligação não há resposta possível: não deixar pedidos "pendurados"
            node.flushPendingOutputs();
            node.status({
                fill: "red",
                shape: "dot",
                text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.mqtt_disconnected"
            });
        }

        onMQTTBridgeState(data) {
            let node = this;
            if (data.payload) {
                node.status({
                    fill: "green",
                    shape: "ring",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/out:status.ready"
                });
            } else {
                node.onConnectError();
            }
        }

        onClose() {
            let node = this;

            clearTimeout(node.cleanTimer);
            node.flushPendingOutputs();

            if (node.server) {
                if (node.listener_onMQTTConnect) {
                    node.server.removeListener('onMQTTConnect', node.listener_onMQTTConnect);
                }
                if (node.listener_onConnectError) {
                    node.server.removeListener('onConnectError', node.listener_onConnectError);
                }
                if (node.listener_onMQTTBridgeState) {
                    node.server.removeListener('onMQTTBridgeState', node.listener_onMQTTBridgeState);
                }
                if (node.listener_onMQTTMessage) {
                    node.server.removeListener('onMQTTMessage', node.listener_onMQTTMessage);
                }
            }
        }

        fromHomeKitFormat(message, device) {
            // Validação defensiva
            if (!message || !message.payload) 
                return null;
            
            if ("hap" in message && message.hap.context === undefined) {
                return null;
            }

            let payload = message['payload'];
            let msg = {};

            if (payload.On !== undefined) {
                msg['state'] = payload.On ? "on" : "off";
            }
            if (payload.Brightness !== undefined) {
                msg['brightness'] = Zigbee2mqttHelper.convertRange(payload.Brightness, [0, 100], [0, 255]);
                if ("current_values" in device) {
                    device.current_values.brightness = msg['brightness'];
                }
                if (payload.Brightness >= 254) payload.Brightness = 255;
                msg['state'] = payload.Brightness > 0 ? "on" : "off"
            }
            if (payload.Hue !== undefined) {
                msg['color'] = {"hue": payload.Hue};
                if ("current_values" in device) {
                    if ("brightness" in device.current_values) msg['brightness'] = device.current_values.brightness;
                    if ("color" in device.current_values && "saturation" in device.current_values.color) msg['color']['saturation'] = device.current_values.color.saturation;
                    if ("color" in device.current_values && "hue" in device.current_values.color) device.current_values.color.hue = payload.Hue;
                }
                msg['state'] = "on";
            }
            if (payload.Saturation !== undefined) {
                msg['color'] = {"saturation": payload.Saturation};
                if ("current_values" in device) {
                    if ("brightness" in device.current_values) msg['brightness'] = device.current_values.brightness;
                    if ("color" in device.current_values && "hue" in device.current_values.color) msg['color']['hue'] = device.current_values.color.hue;
                    if ("color" in device.current_values && "saturation" in device.current_values.color) device.current_values.color.saturation = payload.Saturation;
                }
                msg['state'] = "on";
            }
            if (payload.ColorTemperature !== undefined) {
                msg['color_temp'] = Zigbee2mqttHelper.convertRange(payload.ColorTemperature, [150, 500], [150, 500]);
                if ("current_values" in device) {
                    if ("color_temp" in device.current_values) device.current_values.color_temp = msg['color_temp'];
                }
                msg['state'] = "on";
            }
            if (payload.LockTargetState !== undefined) {
                msg['state'] = payload.LockTargetState ? "LOCK" : "UNLOCK";
            }
            if (payload.TargetPosition !== undefined) {
                msg['position'] = payload.TargetPosition;
            }

            return msg;
        }
    }


    RED.nodes.registerType('zigbee2mqtt-eb-out', Zigbee2mqttNodeOut);
};

// Exposto apenas para testes unitários (o Node-RED ignora propriedades extra do módulo)
module.exports.resolveDeviceTarget = resolveDeviceTarget;
