const Zigbee2mqttHelper = require('../resources/Zigbee2mqttHelper.js');
var mqtt = require('mqtt');
var Viz = require('@viz-js/viz');
var vizInstancePromise = Viz.instance();

// Node-RED system logger (4 levels: error / warn / notice / debug) controlled by the
// "Logger Node-RED" select (node-config-input-debug_level). It is independent from the
// runtime debug (Z2MDebug), which keeps working exactly as before.
const Z2MLogger = require('../resources/js/node-red-contrib-zigbee2mqtt-logger.js').Logger;
// Home Assistant (MQTT Discovery): constantes, discovery, estado enabled/disabled e fila - tudo neste módulo
const HAHelper = require('../resources/js/node-red-contrib-zigbee2mqtt-homeassistant.js');



// ═══════════════════════════════════════════════════════════════════════════
// v3.1.0 - HOME ASSISTANT (MQTT Discovery): TODO o código vive agora em
//   resources/js/node-red-contrib-zigbee2mqtt-homeassistant.js
// (constantes, device_class, discovery, estado enabled/disabled, fila de mensagens).
// Aqui ficam apenas wrappers finos com os MESMOS nomes de método, para que o in.js
// e os callbacks MQTT deste ficheiro continuem a funcionar sem alterações.
// ═══════════════════════════════════════════════════════════════════════════

module.exports = function(RED) {
    "use strict";

    class ServerNode {
        constructor(n) {
            RED.nodes.createNode(this, n);
            var node = this;
            node.config = n;

            // Logger Node-RED: level comes from the config node (UI) and can be changed at runtime
            // through setDebugLevel() without a redeploy (see api.js -> setDebugLevel).
            node.debug_level = Z2MLogger.normalizeLevel(n.debug_level);
            node.logger = Z2MLogger.create(node, {
                prefix: 'Server',
                getLevel: function () { return node.debug_level; }
            });
            node.connection = false;
            node.items = undefined;
            node.groups = undefined;
            node.devices = undefined;
            node.devices_values = new Map();
            // v3.1.0: nós "in" expostos ao Home Assistant (objectId -> nó) e cache do último discovery publicado
            node.haNodes = new Map();
            node.haConfigCache = new Map();
            // v3.1.x: gestor Home Assistant (adota os Maps acima; toda a lógica está no módulo)
            node.ha = HAHelper.createHomeAssistantManager(node);
            node.availability = {};
            node.bridge_info = null;
            node.bridge_state = null;
            node.map = null;
            // ✅ Tentar recuperar cache persistente no arranque
            node.devices = node.context().global.get('z2m_devices_' + node.id) || null;
            node.groups = node.context().global.get('z2m_groups_' + node.id) || null;
            if (node.devices) {
                node.logger.debug('Restored cached device list (' + (Array.isArray(node.devices) ? node.devices.length : '?') + ' devices) from the global context');
            }
            
            node.on('close', (removed, done) => this.onClose(removed, done));
            node.setMaxListeners(50);
            
            // Rastrear nós clientes para limpeza
            node.clientNodes = new Set();
            
            node.registerClient = (clientNode) => node.clientNodes.add(clientNode);
            node.unregisterClient = (clientNode) => node.clientNodes.delete(clientNode);
            
            //mqtt
            node.mqtt = node.connectMQTT();
            if (!node.mqtt) {
                node.logger.error('MQTT client was not created - the server node stays inactive until host/port/TLS are fixed');
            }
            if (node.mqtt) {
                node.mqtt.on('connect', () => this.onMQTTConnect());
                node.mqtt.on('message', (topic, message, packet) => this.onMQTTMessage(topic, message, packet));
 
                node.mqtt.on('close', () => this.onMQTTClose());
                node.mqtt.on('end', () => this.onMQTTEnd());
                node.mqtt.on('reconnect', () => this.onMQTTReconnect());
                node.mqtt.on('offline', () => this.onMQTTOffline());
                node.mqtt.on('disconnect', (error) => this.onMQTTDisconnect(error));
                node.mqtt.on('error', (error) => this.onMQTTError(error));
            }

             //console.log(node.config._users);
        }
        
        connectMQTT(clientId = null) {
            var node = this;
            
            // 1. Recuperar Credenciais (Prioridade: Credentials > Config)
            let user = null;
            let pass = null;

            if (node.credentials) {
                user = node.credentials.mqtt_user;
                pass = node.credentials.mqtt_pass;
            }

            // Fallback for configs saved by older versions, which stored the login
            // as plaintext node properties. Migrated to credentials when next edited.
            if (!user) user = node.config.mqtt_username || null;
            if (!pass) pass = node.config.mqtt_password || null;

            // 2. Configurar Opções de Conexão
            let port = parseInt(node.config.mqtt_port);
            if (isNaN(port) || port < 1 || port > 65535)
                port = 1883;
            
            var options = {
                port: port,
                username: user,
                password: pass,
                // Readable prefix for broker logs, plus a random suffix so the ID is unique per
                // connection: brokers drop an existing client when another connects with the
                // same ID (e.g. the same flows running on two Node-RED instances, or the
                // temporary map-refresh client).
                clientId: 'NodeRed-Z2M-' + node.id.replace(/\./g, '') + '-' + (clientId ? clientId + '-' : '') + Math.random().toString(36).substring(2, 8),
                clean: true,
                keepalive: 30, // Ainda mais reduzido para detecção rápida em redes instáveis
                reconnectPeriod: 5000,
                connectTimeout: 15000, // Timeout reduzido para falhar rápido e tentar reconectar
                resubscribe: true
            };


            // Logger Node-RED: the port was silently replaced by 1883 above
            if (String(node.config.mqtt_port === undefined || node.config.mqtt_port === null ? '' : node.config.mqtt_port).trim() !== ''
                && String(port) !== String(node.config.mqtt_port).trim()) {
                node.logger.warn('Invalid MQTT port "' + node.config.mqtt_port + '" - using ' + port);
            }
            // Last Will: the broker publishes this if the main connection drops without a
            // clean disconnect (Node-RED crash, network loss). Only for the main connection,
            // not the temporary map-refresh client. See publishStatus() for the rest.
            if (!clientId) {
                options.will = {
                    topic: node.getStatusTopic(),
                    payload: JSON.stringify({state: 'offline'}),
                    qos: 1,
                    retain: true
                };
            }

            // 3. Configurar Protocolo e TLS
            let baseUrl = 'mqtt://';
            var tlsNode = RED.nodes.getNode(node.config.tls);
            
            if (node.config.usetls && tlsNode) {
                tlsNode.addTLSOptions(options);
                baseUrl = 'mqtts://';
                // REFATORADO: Permitir certificados auto-assinados se configurado (comum em IoT local)
                if (options.rejectUnauthorized === undefined) {
                    options.rejectUnauthorized = true; // Ou ler de config
                }
            }


            // Logger Node-RED: TLS requested but no usable TLS config node -> silent fallback to plain mqtt://
            if (node.config.usetls && !tlsNode) {
                node.logger.warn('TLS is enabled but the TLS configuration node was not found - falling back to unencrypted mqtt://');
            }
            // 4. Validar Host
            if (!node.config.host || typeof node.config.host !== 'string' || node.config.host.trim() === '') {
                node.error("MQTT Host not defined or invalid");
                return null;
            }

            // 5. Iniciar Conexão
             // Remover espaços acidentais que utilizadores possam colar
            const cleanHost = node.config.host.trim();
            const fullUrl = baseUrl + cleanHost;
            // Logger Node-RED: mqtt.connect() can throw on malformed URLs/options; the constructor
            // already handles a null client, so log the reason instead of failing silently.
            try {
                node.logger.notice('Connecting to MQTT broker ' + fullUrl + ':' + options.port + (options.username ? ' (authenticated)' : ''));
                return mqtt.connect(fullUrl, options);
            } catch (e) {
                node.logger.error('Could not create the MQTT client for ' + fullUrl + ': ' + e.message);
                return null;
            }
        }
/*
        connectMQTT(clientId = null) {
            var node = this;
            var options = {
                port: node.config.mqtt_port || 1883,
                username: node.config.mqtt_username || null,
                password: node.config.mqtt_password || null,
                clientId: clientId || ('NodeRed-Z2M-' + node.id.replace('.', '')),
            };

            let baseUrl = 'mqtt://';

            var tlsNode = RED.nodes.getNode(node.config.tls);
            if (node.config.usetls && tlsNode) {
                tlsNode.addTLSOptions(options);
                baseUrl = 'mqtts://';
            }

            return mqtt.connect(baseUrl + node.config.host, options);
        }
*/
        subscribeMQTT() {
            var node = this;
            node.mqtt.subscribe(node.getTopic('/#'), {'qos':parseInt(node.config.mqtt_qos||0)}, function(err) {
                if (err) {
                    node.warn('MQTT Error: Subscribe to "' + node.getTopic('/#'));
                    node.emit('onConnectError', err);
                } else {
                    node.log('MQTT Subscribed to: "' + node.getTopic('/#'));
                }
            });
        }

        unsubscribeMQTT() {
            var node = this;
            node.log('MQTT Unsubscribe from mqtt topic: ' + node.getTopic('/#'));
            if (node.mqtt) {
                node.mqtt.unsubscribe(node.getTopic('/#'), function(err) {});
            }
            // Clear Map instead of assigning new object
            if (node.devices_values instanceof Map) {
                node.devices_values.clear();
            } else {
                node.devices_values = new Map();
            }
        }

        getDevices(callback, withGroups = false) {
            if (typeof (callback) !== 'function') {
                return
            }
            let node = this;

            // ✅ NOVA LÓGICA: Juntar os dados estáticos com os valores em cache
            const mergeValues = (devicesList) => {
                return devicesList.map(device => {
                    let topic = node.getTopic('/' + (device.friendly_name || device.ieee_address));
                    
                    // Check if Map has the topic
                    if (node.devices_values instanceof Map && node.devices_values.has(topic)) {
                        let d = { ...device };
                        d.current_values = node.devices_values.get(topic);
                        return d;
                    }
                    // Fallback for legacy Object structure (safety)
                    else if (!(node.devices_values instanceof Map) && node.devices_values && node.devices_values[topic]) {
                         let d = { ...device };
                         d.current_values = node.devices_values[topic];
                         return d;
                    }
                    return device;
                });
            };

            if (node.devices && (!withGroups || node.groups)) {
                node.log('Using cached devices');
                
                // ✅ APLICAR O MERGE ANTES DE ENVIAR PARA O EDITOR
                let devicesWithValues = mergeValues(node.devices);
                callback(withGroups ? [devicesWithValues, node.groups] : devicesWithValues);
            } else {
                node.log('Waiting for device list')
                let timeout = null
                let checkAvailability = null
                

                // Logger Node-RED: connectivity checks before asking Zigbee2MQTT for the lists
                if (!node.devices && !node.mqtt) {
                    node.logger.error('getDevices: no MQTT client available (check host/port in the server configuration)');
                    callback(withGroups ? [[], []] : []);
                    return;
                }
                if (!node.devices && !node.connection) {
                    node.logger.warn('getDevices: MQTT is not connected yet - the request is queued and may time out');
                }
                if (!node.devices) {
                     node.mqtt.publish(node.getTopic('/bridge/request/devices/get'), '');
                     node.mqtt.publish(node.getTopic('/bridge/request/groups/get'), '');
                }

                new Promise(function(resolve, reject) {
                    timeout = setTimeout(function() {
                        if (checkAvailability) node.removeListener('onMQTTMessageBridge', checkAvailability);
                        resolve(false); 
                    }, 5000); 

                    checkAvailability = function(topic) {
                        if (node.devices && (!withGroups || node.groups)) {
                             clearTimeout(timeout);
                             resolve(true);
                        }
                    }
                    node.on('onMQTTMessageBridge', checkAvailability);
                }).then(function() {
                    clearTimeout(timeout)
                    if (checkAvailability) node.removeListener('onMQTTMessageBridge', checkAvailability);
                    
                    if (node.devices && (!withGroups || node.groups)) {
                        // ✅ APLICAR O MERGE TAMBÉM AQUI
                        let devicesWithValues = mergeValues(node.devices);
                        callback(withGroups ? [devicesWithValues, node.groups] : devicesWithValues);
                    } else {
                        node.error('Error: getDevices timeout')
                        callback(withGroups ? [[], []] : []);
                    }
                })
            }
        }

        rebuildLookupMap(varName) {
            var node = this;
            if (!node[varName]) return;

            // Drop old entries of this type
            for (let key of node.lookupMap.keys()) {
                if (key.startsWith(varName + ':')) node.lookupMap.delete(key);
            }

            // Index every key the original linear search matched: friendly_name,
            // ieee_address / group id, their full MQTT topics (used by incoming device
            // and availability messages), and the generated selector form of the topic.
            const add = (k, item) => {
                if (k !== undefined && k !== null && k !== '' && !node.lookupMap.has(`${varName}:${k}`)) {
                    node.lookupMap.set(`${varName}:${k}`, item);
                }
            };
            node[varName].forEach(item => {
                const names = [];
                if (item.friendly_name) names.push(item.friendly_name);
                if (varName === 'devices' && item.ieee_address) names.push(item.ieee_address);
                names.forEach(name => {
                    add(name, item);
                    const topic = node.getTopic('/' + name);
                    add(topic, item);
                    if (name === item.friendly_name) add(Zigbee2mqttHelper.generateSelector(topic), item);
                });
                if (varName === 'groups' && item.id !== undefined) add(String(item.id), item);
            });
            // remember which list the map was built from; node.devices/node.groups are
            // replaced with a new array on every bridge update (including renames)
            node.lookupMap.set(varName + '_source', node[varName]);
        }

        _getItemByKey(key, varName) {
            var node = this;
            if (!node[varName]) return null;

            if (!node.lookupMap) node.lookupMap = new Map();

            if (node.lookupMap.get(varName + '_source') !== node[varName]) {
                node.rebuildLookupMap(varName);
            }

            // group ids may arrive as numbers or numeric strings
            const cacheKey = `${varName}:${(varName === 'groups' && typeof key === 'number') ? String(key) : key}`;
            let result = node.lookupMap.get(cacheKey);
 
            if (result) {
                // Clone para evitar mutar a referência original
                result = { ...result }; 
                result['current_values'] = null;
                result['homekit'] = null;
                result['format'] = null;

                let topic = node.getTopic('/' + (result.friendly_name ? result.friendly_name : result.ieee_address));
                
                // Verificar se temos valores em cache para este tópico (Map support)
                let values = null;
                if (node.devices_values instanceof Map) {
                    values = node.devices_values.get(topic);
                } else if (node.devices_values) {
                    values = node.devices_values[topic];
                }
 
                if (values) {
                    result['current_values'] = values;
                    result['homekit'] = Zigbee2mqttHelper.payload2homekit(values);
                    result['format'] = Zigbee2mqttHelper.formatPayload(values, result);
                }
            }
            return result;
        }
        getDeviceOrGroupByKey(key) {
            let device = this.getDeviceByKey(key);
            if (device) {
                return device;
            }
            let group = this.getGroupByKey(key);
            if (group) {
                return group;
            }

            return null;
        }

        getDeviceByKey(key) {
            return this._getItemByKey(key, 'devices');
        }

        getGroupByKey(key) {
            return this._getItemByKey(key, 'groups');
        }

        getDeviceAvailabilityColor(topic) {
            let color = 'blue';
            if (topic in this.availability) {
                color = this.availability[topic]?'green':'red';
            }
            return color;
        }

        getBaseTopic() {
            // Garantir que não termina em barra para evitar //
            let topic = this.config.base_topic || 'zigbee2mqtt';
            if (topic.endsWith('/')) 
                topic = topic.slice(0, -1);
            return topic;
        }
 
        getTopic(path) {
            // Garantir que path começa com barra
            if (path && !path.startsWith('/')) 
                path = '/' + path;
            return this.getBaseTopic() + path;
        }

        /**
         * Retained Node-RED connection status for this server node's base topic, in the same format as
         * zigbee2mqtt's own bridge/state: {"state":"online"} / {"state":"offline"}.
         * Published online on connect, offline on clean shutdown, and offline by the
         * broker (Last Will) if the connection is lost.
         */
        getStatusTopic() {
            return 'node-red/' + this.getBaseTopic() + '/state';
        }

        publishStatus(state, callback) {
            let node = this;
            if (!node.mqtt || !node.connection) {
                if (callback) callback();
                return;
            }
            // state === null clears the retained message (used when the server node is deleted)
            let payload = state === null ? '' : JSON.stringify({state: state});
            node.mqtt.publish(node.getStatusTopic(), payload, {qos: 1, retain: true}, function (err) {
                if (err) node.logger.warn('Could not publish the Node-RED status topic: ' + err.message);
                if (callback) callback();
            });
        }

        restart() {
            let node = this;
            // Logger Node-RED
            if (!node.mqtt) {
                node.logger.error('Cannot restart zigbee2mqtt: no MQTT client available');
                throw new Error('MQTT client not available');
            }
            if (!node.connection) {
                node.logger.warn('Restart requested while MQTT is disconnected - the request is queued until the broker is back');
            }
            node.mqtt.publish(node.getTopic('/bridge/request/restart'));
            node.log('Restarting zigbee2mqtt...');
        }
		
		/**
         * Normaliza e valida o nome de um grupo.
         * - aceita string (ou número, convertido para string)
         * - aplica trim()
         * - rejeita: vazio, só barras ("/", "//"), caracteres de controlo
         *
         * @param {*} name
         * @returns {string|null} nome limpo, ou null se inválido
         */
        normalizeGroupName(name) {
            if (typeof name === 'number' && isFinite(name)) {
                name = String(name);
            }
            if (typeof name !== 'string') {
                return null;
            }

            const clean = name.trim();

            if (clean === '') {
                return null;
            }
            // só separadores de hierarquia, ex: "/" ou "//"
            if (/^[\/\\]+$/.test(clean)) {
                return null;
            }
            // caracteres de controlo (\u0000-\u001F, \u007F)
            if (/[\u0000-\u001F\u007F]/.test(clean)) {
                return null;
            }

            return clean;
        }
		
        /**
         * Level of the Node-RED system logger ("Logger Node-RED" select: error | warn | notice | debug).
         * Applied immediately; the editor persists it in the config node (debug_level) on the next Deploy.
         */
        getDebugLevel() {
            return this.debug_level;
        }

        setDebugLevel(level) {
            let node = this;
            if (!Z2MLogger.isValidLevel(level)) {
                node.logger.warn('Ignored invalid logger level: ' + JSON.stringify(level));
                return {'error': true, 'code': 'invalid_level', 'description': 'invalid level (use: ' + Object.keys(Z2MLogger.LEVELS).join(', ') + ')'};
            }
            const previous = node.debug_level;
            node.debug_level = level;
            if (previous !== level) {
                node.logger.notice('Logger Node-RED level changed: ' + previous + ' -> ' + level);
            }
            return {'success': true, 'level': level, 'previous': previous};
        }

        setLogLevel(val) {
            let node = this;
            if (['info', 'debug', 'warning', 'error'].indexOf(val) < 0) val = 'info';
            let payload = {
                'options': {
                    'advanced': {
                        'log_level': val,
                    },
                },
            };
            // Logger Node-RED
            if (!node.mqtt) {
                node.logger.error('Cannot set the zigbee2mqtt log level: no MQTT client available');
                throw new Error('MQTT client not available');
            }
            if (!node.connection) {
                node.logger.warn('Setting the zigbee2mqtt log level while MQTT is disconnected - the request is queued until the broker is back');
            }
            node.mqtt.publish(node.getTopic('/bridge/request/options'), JSON.stringify(payload));
            node.log('Log Level was set to: ' + val);
        }

// FIX para Issue #146
    setPermitJoin(val, customTime) {
        let node = this;
        
        // ✅ VALIDAR CONEXÃO MQTT
        if (!node.mqtt || !node.connection) {
            node.warn('Cannot set permit_join: MQTT not connected');
            return {'error': true, 'code': 'mqtt_not_connected', 'description': 'MQTT not connected'};
        }
        
        // ✅ DETERMINAR TEMPO
        // Aceita: setPermitJoin(true, 300) ou setPermitJoin(true) [default 180s]
        let time = 180; // Default: 3 minutos
        
        if (customTime !== undefined && customTime !== null) {
            const parsed = parseInt(customTime);
            if (!isNaN(parsed) && parsed > 0) {
                time = parsed;
            }
            else {
                node.warn('Invalid permit join time, using default'); 
            }
        }
        
        // ✅ PREPARAR PAYLOAD (novo formato Zigbee2MQTT)
        let payload;
        
        if (val === true || val === 'true' || parseInt(val) > 0) {
            // Ativar pairing mode
            payload = {
                'value': true,
                'time': time
            };
            
            const minutes = Math.floor(time / 60);
            const seconds = time % 60;
            const timeStr = minutes > 0 ? 
                `${minutes}m ${seconds}s` : 
                `${seconds}s`;
            
            node.log(`Permit Join ENABLED for ${timeStr} (${time} seconds)`);
            
        } else {
            // Desativar pairing mode
            payload = {
                'value': false
            };
            node.log('Permit Join DISABLED');
        }

        // PUBLICAR NO TÓPICO CORRETO
        // Zigbee2MQTT v1.x usa 'value', versões mais recentes podem aceitar boolean direto ou payload diferente.
        // O formato {"value": true, "time": 180} é o padrão atual para /bridge/request/permit_join
        node.mqtt.publish(
            node.getTopic('/bridge/request/permit_join'),
            JSON.stringify(payload),
            { qos: parseInt(node.config.mqtt_qos || 0) },
            (err) => {
                if (err) {
                    node.error('Failed to set permit_join: ' + err.message);
                }
            }
        );
        
        return {
            'success': true, 
            'description': 'command sent', 
            'time': time
        };
    }
        renameDevice(ieee_address, newName) {
            let node = this;

            let device = node.getDeviceByKey(ieee_address);
            if (!device) {
                node.logger.warn('renameDevice: no such device "' + ieee_address + '"'); return {'error': true, 'code': 'no_such_device', 'description': 'no such device'};
            }

            if (!newName.length) {
                node.logger.warn('renameDevice: the new name for "' + ieee_address + '" is empty'); return {'error': true, 'code': 'name_empty', 'description': 'can not be empty'};
            }

            let payload = {
                'from': device.friendly_name, 'to': newName,
            };

            node.mqtt.publish(node.getTopic('/bridge/request/device/rename'), JSON.stringify(payload));
            node.log('Rename device ' + ieee_address + ' to ' + newName);

            return {'success': true, 'description': 'command sent'};
        }

        removeDevice(ieee_address) {
            let node = this;

            let device = node.getDeviceByKey(ieee_address);
            if (!device) {
                node.logger.warn('removeDevice: no such device "' + ieee_address + '"'); return {'error': true, 'code': 'no_such_device', 'description': 'no such device'};
            }
            let payload = {
                'id': ieee_address,
                'force': true
            };

            node.mqtt.publish(node.getTopic('/bridge/device/remove'), JSON.stringify(payload));
            node.log('Remove device: ' + device.friendly_name);

            return {'success': true, 'description': 'command sent'};
        }

        setDeviceOptions(ieee_address, options) {
            let node = this;
            let device = node.getDeviceByKey(ieee_address);
            if (!device) {
                node.logger.warn('setDeviceOptions: no such device "' + ieee_address + '"'); return {'error': true, 'code': 'no_such_device', 'description': 'no such device'};
            }

            let payload = {
                'id': ieee_address,
                'options': options
            };

            node.mqtt.publish(node.getTopic('/bridge/request/device/options'), JSON.stringify(payload));
            node.log('Set device options for "'+device.friendly_name+'" : '+JSON.stringify(payload));

            return {"success":true,"description":"command sent"};
        }

        renameGroup(id, newName) {
            let node = this;

            let group = node.getGroupByKey(id);
            if (!group) {
                node.logger.warn('renameGroup: no such group "' + id + '"'); return {'error': true, 'code': 'no_such_group', 'description': 'no such group'};
            }

            const cleanName = node.normalizeGroupName(newName);
            if (!cleanName) {
                node.warn('renameGroup aborted: new name is empty or invalid (received: ' + JSON.stringify(newName) + ')');
                return {'error': true, 'code': 'name_empty', 'description': 'can not be empty'};
            }

            // Nada a fazer se o nome (já normalizado) é igual ao atual
            if (cleanName === group.friendly_name) {
                node.log('renameGroup skipped: name unchanged (' + cleanName + ')');
                return {'success': true, 'description': 'name unchanged'};
            }

            let payload = {
                'from': group.friendly_name, 'to': cleanName,
            };
            node.mqtt.publish(node.getTopic('/bridge/request/group/rename'), JSON.stringify(payload));
            node.log('Rename group ' + id + ' to ' + cleanName);

            return {'success': true, 'description': 'command sent'};
        }

        removeGroup(id) {
            let node = this;

            let group = node.getGroupByKey(id);
            if (!group) {
                node.logger.warn('removeGroup: no such group "' + id + '"'); return {'error': true, 'code': 'no_such_group', 'description': 'no such group'};
            }

            let payload = {
                'id': id,
            };
            node.mqtt.publish(node.getTopic('/bridge/request/group/remove'), JSON.stringify(payload));
            node.log('Remove group: ' + group.friendly_name);

            return {'success': true, 'description': 'command sent'};
        }

        addGroup(name) {
            let node = this;

            const cleanName = node.normalizeGroupName(name);
            if (!cleanName) {
                node.warn('addGroup aborted: group name is empty or invalid (received: ' + JSON.stringify(name) + ')');
                // O bridge.html já faz alert(data.description) quando "error" in data
                return {'error': true, 'code': 'group_name_empty', 'description': 'group name can not be empty'};
            }

            // (acrescento meu, não pedido: evita TypeError se o MQTT estiver desligado;
            //  podes apagar este bloco se preferires manter só a validação do nome)
            if (!node.mqtt || !node.connection) {
                node.warn('addGroup aborted: MQTT not connected');
                return {'error': true, 'code': 'mqtt_not_connected', 'description': 'MQTT not connected'};
            }

            let payload = {
                'friendly_name': cleanName,
            };
            node.mqtt.publish(node.getTopic('/bridge/request/group/add'), JSON.stringify(payload));
            node.log('Add group: ' + cleanName);

            return {'success': true, 'description': 'command sent'};
        }

        removeDeviceFromGroup(deviceId, groupId) {
            let node = this;

            let device = node.getDeviceByKey(deviceId);
            if (!device) {
                device = {'friendly_name': deviceId};
            }

            let group = node.getGroupByKey(groupId);
            if (!group) {
                node.logger.warn('removeDeviceFromGroup: no such group "' + groupId + '"'); return {'error': true, 'code': 'no_such_group', 'description': 'no such group'};
            }
            let payload = {
                'group': groupId, 'device': deviceId,
            };
            node.mqtt.publish(node.getTopic('/bridge/request/group/members/remove'), JSON.stringify(payload));
            node.log('Removing device: ' + device.friendly_name + ' from group: ' + group.friendly_name);

            return {'success': true, 'description': 'command sent'};
        }

        addDeviceToGroup(deviceId, groupId) {
            let node = this;

            let device = node.getDeviceByKey(deviceId);
            if (!device) {
                node.logger.warn('addDeviceToGroup: no such device "' + deviceId + '"'); return {'error': true, 'code': 'no_such_device', 'description': 'no such device'};
            }

            let group = node.getGroupByKey(groupId);
            if (!group) {
                node.logger.warn('addDeviceToGroup: no such group "' + groupId + '"'); return {'error': true, 'code': 'no_such_group', 'description': 'no such group'};
            }
            let payload = {
                'group': groupId,
                'device': deviceId,
            };
            node.mqtt.publish(node.getTopic('/bridge/request/group/members/add'), JSON.stringify(payload));
            node.log('Adding device: ' + device.friendly_name + ' to group: ' + group.friendly_name);

            return {'success': true, 'description': 'command sent'};
        }

        refreshMap(wait = false, engine = null) {
            var node = this;

            return new Promise(function(resolve, reject) {
                if (wait) {
                    var timeout = null;
                    var timeout_ms = 60000 * 5;

                    var client = node.connectMQTT('tmp');
                    client.on('connect', function() {

                        //end function after timeout, if now response
                        timeout = setTimeout(function() {
                            node.logger.warn('Network map: no response from zigbee2mqtt within ' + (timeout_ms / 1000) + 's - giving up');
                            client.end(true);
                        }, timeout_ms);
                        client.subscribe(node.getTopic('/bridge/response/networkmap'), function(err) {
                            if (!err) {
                                client.publish(node.getTopic('/bridge/request/networkmap'), JSON.stringify({'type': 'graphviz', 'routes': false}));

                                node.log('Refreshing map and waiting...');
                            } else {
                                RED.log.error('zigbee2mqtt: Map subscribe error: ' + err);
                                client.end(true);
                                reject({'success': false, 'description': 'Subscribe failed'});
                            }
                        });
                    });

                    client.on('error', function(error) {
                        RED.log.error('zigbee2mqtt: error code #0024: ' + error);
                        client.end(true);
                        reject({'success': false, 'description': 'zigbee2mqtt: error code #0024'});
                    });

                    client.on('end', function(error, s) {
                        clearTimeout(timeout);
                    });

                    client.on('message', function(topic, message) {
                        if (node.getTopic('/bridge/response/networkmap') === topic) {

                            var messageString = message.toString();
                            node.graphviz(JSON.parse(messageString).data.value, engine).then(function(data) {
                                resolve({'success': true, 'svg': node.map});
                            }).catch(error => {
                                node.logger.error('Network map: graphviz rendering failed: ' + (error && error.message ? error.message : error));
                                reject({'success': false, 'description': 'graphviz failed'});
                            });
                            client.end(true);
                        }
                    });
                } else {
                    node.mqtt.publish(node.getTopic('/bridge/request/networkmap'), JSON.stringify({'type': 'graphviz', 'routes': false}));
                    node.log('Refreshing map...');

                    resolve({'success': true, 'svg': node.map});
                }
            });
        }

        async graphviz(payload, engine = null) {
            var node = this;
            var options = {
                format: 'svg', engine: engine ? engine : 'circo',
            };
            var viz = await vizInstancePromise;
            return node.map = await viz.renderString(payload, options);
        }

        // ═══════════════════════════════════════════════════════════════════
        // v3.1.0 - FILTRO GRANULAR (filterProperties)
        // ═══════════════════════════════════════════════════════════════════

        /** string legada / array / null -> array limpo de strings (vazio = sem filtro) */
        normalizeList(value) {
            if (typeof value === 'string') {
                value = (value && value !== '0') ? [value] : [];
            }
            if (!Array.isArray(value)) return [];
            return value
                .filter(function (v) { return typeof v === 'string' && v.trim() !== ''; })
                .map(function (v) { return v.trim(); });
        }

        /**
         * Extrai de `payload` apenas as chaves escolhidas em filterProperties, para que a deteção de
         * mudanças ignore ruído (linkquality, last_seen, ...).
         *  - sem filterProperties        -> devolve o payload completo (comportamento anterior)
         *  - chave "homekit_<x>"         -> lida em `homekit` (se fornecido)
         *  - chave inexistente no payload-> é ignorada (mensagens parciais não contam como mudança)
         */
        getComparisonValue(payload, filterProperties, homekit) {
            const props = this.normalizeList(filterProperties);
            if (!props.length) return payload;
            if (payload === null || payload === undefined || typeof payload !== 'object') return payload;

            const out = {};
            props.forEach(function (prop) {
                if (prop.indexOf('homekit_') === 0 && homekit && typeof homekit === 'object') {
                    const hkKey = prop.slice('homekit_'.length);
                    if (hkKey in homekit) { out[prop] = homekit[hkKey]; return; }
                }
                if (prop in payload) out[prop] = payload[prop];
            });
            return out;
        }

        /** v3.3.9 - string legada / array / null -> array limpo (vazio = sem filtro). Alias de normalizeList. */
        parseFilterProperties(value) {
            return this.normalizeList(value);
        }

        /**
         * v3.3.9 - Das propriedades escolhidas em filterProperties, devolve APENAS as que vêm
         * no payload MQTT BRUTO (o que o Z2M acabou de publicar), ignorando o que só existe
         * na cache fundida (current_values). "homekit_<x>" avalia-se com payload2homekit(rawPayload).
         */
        selectFilterProperties(rawPayload, filterProperties) {
            const props = this.parseFilterProperties(filterProperties);
            if (!props.length || !rawPayload || typeof rawPayload !== 'object') return [];
            let rawHomekit = null;
            const present = [];
            props.forEach(function (prop) {
                if (prop.indexOf('homekit_') === 0) {
                    if (rawHomekit === null) rawHomekit = Zigbee2mqttHelper.payload2homekit(rawPayload) || {};
                    if (prop.slice('homekit_'.length) in rawHomekit) present.push(prop);
                } else if (prop in rawPayload) {
                    present.push(prop);
                }
            });
            return present;
        }

        /**
         * v3.3.9 - Compara `values` ({prop: valor}) com o último valor guardado para `scope`
         * ('_' no modo single; ieee_address/id no modo multiple) e guarda os novos.
         * node.last_filter_value passou de string para objeto { scope: { prop: valorSerializado } }.
         * @returns {boolean} true se pelo menos uma chave mudou (ou é vista pela 1ª vez)
         */
        compareAndStoreFilter(node, scope, values) {
            if (!node.last_filter_value || typeof node.last_filter_value !== 'object') node.last_filter_value = {};
            const slot = node.last_filter_value[scope] || (node.last_filter_value[scope] = {});
            let changed = false;
            Object.keys(values || {}).forEach(function (prop) {
                const serialized = JSON.stringify(values[prop]);
                if (slot[prop] !== serialized) { slot[prop] = serialized; changed = true; }
            });
            return changed;
        }

        /** Versão para o modo "Multiple input": uma entrada por device, serializada */
        getMultipleComparison(payload, filterProperties) {
            const that = this;
            const out = {};
            Object.keys(payload || {}).forEach(function (key) {
                const entry = payload[key] || {};
                out[key] = that.getComparisonValue(entry.payload, filterProperties, entry.homekit);
            });
            return JSON.stringify(out);
        }

        // ═══════════════════════════════════════════════════════════════════
        // v3.1.0 - HOME ASSISTANT: wrappers finos
        // A implementação está em resources/js/node-red-contrib-zigbee2mqtt-homeassistant.js
        // (node.ha = HomeAssistantManager). Os nomes públicos mantêm-se: o in.js chama
        // registerHomeAssistantNode/unregisterHomeAssistantNode e os callbacks MQTT chamam os restantes.
        // ═══════════════════════════════════════════════════════════════════

        haObjectId(...args) {
            return this.ha.haObjectId(...args);
        }

        haIdFromString(...args) {
            return this.ha.haIdFromString(...args);
        }

        getHaDiscoveryPrefix(...args) {
            return this.ha.getHaDiscoveryPrefix(...args);
        }

        getHaTopicPrefix(...args) {
            return this.ha.getHaTopicPrefix(...args);
        }

        haAvailability(...args) {
            return this.ha.haAvailability(...args);
        }

        registerHomeAssistantNode(...args) {
            return this.ha.registerHomeAssistantNode(...args);
        }

        unregisterHomeAssistantNode(...args) {
            return this.ha.unregisterHomeAssistantNode(...args);
        }

        clearHomeAssistantDiscovery(...args) {
            return this.ha.clearHomeAssistantDiscovery(...args);
        }

        subscribeHomeAssistant(...args) {
            return this.ha.subscribeHomeAssistant(...args);
        }

        publishHomeAssistantEnabledState(...args) {
            return this.ha.publishHomeAssistantEnabledState(...args);
        }

        scheduleHomeAssistantStateFallback(...args) {
            return this.ha.scheduleHomeAssistantStateFallback(...args);
        }

        buildHomeAssistantEntities(...args) {
            return this.ha.buildHomeAssistantEntities(...args);
        }

        publishHomeAssistantDiscovery(...args) {
            return this.ha.publishHomeAssistantDiscovery(...args);
        }

        announceHomeAssistantNodes(...args) {
            return this.ha.announceHomeAssistantNodes(...args);
        }

        onHomeAssistantMessage(...args) {
            return this.ha.onHomeAssistantMessage(...args);
        }

        onZigbeeEntitiesUpdated(...args) {
            return this.ha.onZigbeeEntitiesUpdated(...args);
        }

        nodeSend(node, opts) {
            if (node.config.enableMultiple) {
                this.nodeSendMultiple(node, opts)
            } else {
                this.nodeSendSingle(node, opts)
            }
        }

        nodeSendSingle(node, opts) {
            clearTimeout(node.cleanTimer);

            opts = Object.assign({
                'node_send':true,
                'key':node.config.device_id,
                'msg': {},
                'filter': false, //skip the same payload, send only changes
                'retained': false //replayed from the broker's retained store, not a live event
            }, opts);

            let msg = opts.msg;
            let payload = null;
            let payload_all = null;
            let text = RED._("@evilbunny/node-red-contrib-zigbee2mqtt/server:status.received");
            let item = this.getDeviceOrGroupByKey(opts.key);
            if (!item) {
                this.logger.throttle('warn', 'nodesend-nodev:' + opts.key, 60000,
                    'Node "' + (node.name || node.id) + '": device/group not found for key "' + opts.key + '"');
            }

            if (item) {
                payload_all = item.current_values;
                if (payload_all == null) {
                    node.warn('You need to turn on the "retain" option for the device in Zigbee2MQTT to be able to read it before a state change.')
                }
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/server:status.no_device"
                });
                return;
            }

            let useProperty = null;
            // normalize config.state: supports the new array format, and legacy single-string configs
            let stateList = node.config.state;
            if (typeof stateList === 'string') {
                stateList = (stateList && stateList !== '0') ? [stateList] : [];
            }
            if (!Array.isArray(stateList)) {
                stateList = [];
            }

            if (stateList.length) {
                let collected = {};
                let foundAny = false;

                for (let prop of stateList) {
                    let homekitKey = prop.split("homekit_").join('');
                    if (item.homekit && homekitKey in item.homekit) {
                        collected[prop] = item.homekit[homekitKey];
                        useProperty = homekitKey;
                        foundAny = true;
                    } else if (payload_all && prop in payload_all) {
                        collected[prop] = payload_all[prop];
                        useProperty = prop;
                        foundAny = true;
                    }
                    // if a requested property isn't present on this message, it's just skipped
                    // (e.g. a button event won't carry every sensor property)
                }

                if (!foundAny) {
                    //none of the requested properties were found in payload (button case)
                    //payload: { last_seen: '2022-07-27T15:25:22+03:00', linkquality: 36 }
                    //payload: { action: 'single', last_seen: '2022-07-27T15:25:22+03:00', linkquality: 36 }
                    return;
                }

                // always output an object keyed by property name, even for a single
                // selected property, so payload.<property> works consistently regardless of count
                payload = collected;
                if (stateList.length === 1) {
                    text = collected[stateList[0]];
                } else {
                    useProperty = null; // unit-suffix below only makes sense for a single property
                }
            } else {
                payload = payload_all;
            }

            // Convert object text to string for status display (prevents [object Object])
            if (typeof text === 'object' && text !== null) {
                try {
                    text = JSON.stringify(text);
                } catch(e) { text = 'Object'; }
            }

            //add unit
            if (useProperty) {
                try {
                    if (item.definition && item.definition.exposes) {
                        for (let ind in item.definition.exposes) {
                            if ('features' in item.definition.exposes[ind]) {
                                for (let featureInd in item.definition.exposes[ind].features) {
                                    if (item.definition.exposes[ind]['features'][featureInd]['property'] == useProperty && 'unit' in item.definition.exposes[ind]['features'][featureInd]) {
                                        text += ' ' + item.definition.exposes[ind]['features'][featureInd]['unit'];
                                    }
                                }
                            } else {
                                if (item.definition.exposes[ind]['property'] == useProperty && 'unit' in item.definition.exposes[ind]) {
                                    text += ' ' + item.definition.exposes[ind]['unit'];
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            if (opts.retained && opts.node_send
                && 'outputAtStartup' in node.config && !node.config.outputAtStartup) {
                // Retained message replayed by the broker on (re)connect - not a live event.
                // (o broker só marca "retained" nas mensagens repetidas na subscrição = janela de arranque/reconexão)
                // Seed last_value so change-filtering still works, but do not emit.
                node.last_value = payload;
                // v3.1.0: semear também a comparação granular (filterProperties)
                const seedProps = this.normalizeList(opts.filterProperties);
                if (seedProps.length) {
                    this.compareAndStoreFilter(node, '_', this.getComparisonValue(payload_all, seedProps, item.homekit));
                }
                (node.logger || this.logger).debug('[Z2M] Message suppressed: retained message during startup window');
                return;
            }

            // ── v3.1.0: comparação granular - só as chaves escolhidas em filterProperties contam ──
            // Substitui a comparação do payload completo (opts.filter) quando há propriedades escolhidas.
            const filterProps = this.normalizeList(opts.filterProperties);
            if (filterProps.length && opts.node_send) {
                // v3.3.9: só contam as chaves que vieram REALMENTE na mensagem MQTT (rawPayload);
                // sem rawPayload (chamador antigo) usa todas as chaves escolhidas.
                const rawPresent = (opts.rawPayload && typeof opts.rawPayload === 'object')
                    ? this.selectFilterProperties(opts.rawPayload, filterProps)
                    : filterProps;
                if (!rawPresent.length) {
                    (node.logger || this.logger).debug('[Z2M] Message filtered: none of the selected properties [' + filterProps.join(', ') + '] is in the raw payload');
                    return;
                }
                const currentGranular = this.getComparisonValue(payload_all, rawPresent, item.homekit);
                if (!this.compareAndStoreFilter(node, '_', currentGranular)) {
                    (node.logger || this.logger).debug('[Z2M] Message filtered: no change in [' + rawPresent.join(', ') + ']');
                    return;
                }
                (node.logger || this.logger).debug('[Z2M] Granular filtering: comparing ' + rawPresent.join(', ') + ' -> changed');
                opts.filter = false; // já tratado de forma granular
            }

            if (opts.filter) {
                // OTIMIZAÇÃO: Comparação rápida antes de serializar
                if (opts.node_send) {
                    // Se forem primitivos iguais, retorna já
                    if (node.last_value === payload) return;
                    
                    // Se um for null/undefined e o outro não, são diferentes
                    if (!node.last_value || !payload) { /* prossegue */ }
                    
                    // Apenas usa JSON.stringify se ambos forem objetos/arrays
                    else if (typeof node.last_value === 'object' && typeof payload === 'object') {
                        if (JSON.stringify(node.last_value) === JSON.stringify(payload)) return;
                    }
                }
            }

            if (item && "power_source" in item && 'Battery' === item.power_source && payload_all && "battery" in payload_all && parseInt(payload_all.battery) > 0) {
                text += ' ⚡' + payload_all.battery + '%';
            }

            msg.topic = this.getTopic('/'+item.friendly_name);
            if ("payload" in msg) {
                msg.payload_in = msg.payload;
            }
            if ('last_value' in node) {
                msg.changed = {
                    'old': node.last_value,
                    'new': payload//,
                    // 'diff': Zigbee2mqttHelper.objectsDiff(node.last_value, payload)
                };
            }
            msg.payload = payload;
            msg.payload_raw = payload_all;
            msg.homekit = item.homekit;
            msg.format = item.format;
            msg.selector = Zigbee2mqttHelper.generateSelector(msg.topic);
            msg.item = item;
            if (opts.node_send) {
                // console.log('SEND:');
                // console.log(payload);
                node.send(msg);
                node.last_value = payload;
            }

            let time = Zigbee2mqttHelper.statusUpdatedAt();
            let fill = this.getDeviceAvailabilityColor(msg.topic);
            let status = {
                fill: fill,
                shape: 'dot',
                text: text
            };
            node.setSuccessfulStatus(status);

            node.cleanTimer = setTimeout(() => {
                status.text += ' ' + time;
                status.shape = 'ring';
                node.setSuccessfulStatus(status);
            }, 3000);
        }

        nodeSendMultiple(node, opts) {
            let that = this;
            clearTimeout(node.cleanTimer);

            opts = Object.assign({
                'node_send':true,
                'key':node.config.device_id,
                'msg': {},
                'changed': null,
                'filter': false, //skip the same payload, send only changes
                'retained': false //replayed from the broker's retained store, not a live event
            }, opts);

            let msg = opts.msg;
            let payload = {};
            let math = [];
            let text = RED._("@evilbunny/node-red-contrib-zigbee2mqtt/server:status.received");

            for (let index in node.config.device_id) {
                let item = that.getDeviceOrGroupByKey(node.config.device_id[index]);
                if (!item) {
                    that.logger.throttle('warn', 'nodesend-nodev:' + node.config.device_id[index], 60000,
                        'Node "' + (node.name || node.id) + '": device/group not found for key "' + node.config.device_id[index] + '"');
                }
                if (item) {
                    let itemData = {};
                    itemData.item = item;
                    itemData.topic = this.getTopic('/' + item.friendly_name);
                    itemData.selector = Zigbee2mqttHelper.generateSelector(itemData.topic);
                    itemData.homekit = item.homekit;
                    itemData.payload = item.current_values;
                    itemData.format = item.format;

                    payload[node.config.device_id[index]] = itemData;
                    math.push(itemData.payload);
                }
            }

            msg.payload_in = ("payload" in msg)?msg.payload:null;
            msg.payload = payload;
            msg.math = Zigbee2mqttHelper.formatMath(math);
            if (opts.changed !== null) {
                msg.changed = opts.changed;
            }

            if (!Object.keys(msg.payload).length) {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/server:status.no_device"
                });
                return;
            }

            if (opts.retained && opts.node_send
                && 'outputAtStartup' in node.config && !node.config.outputAtStartup) {
                // Retained message replayed by the broker on (re)connect - not a live event.
                // (o broker só marca "retained" nas mensagens repetidas na subscrição = janela de arranque/reconexão)
                // Seed last_value so change-filtering still works, but do not emit.
                node.last_value = payload;
                // v3.1.0: semear também a comparação granular (filterProperties)
                const seedPropsMulti = that.normalizeList(opts.filterProperties);
                if (seedPropsMulti.length) {
                    Object.keys(payload).forEach(function (k) {
                        const entry = payload[k] || {};
                        const scopeId = entry.item ? String(entry.item.ieee_address !== undefined ? entry.item.ieee_address : entry.item.id) : String(k);
                        that.compareAndStoreFilter(node, scopeId, that.getComparisonValue(entry.payload, seedPropsMulti, entry.homekit));
                    });
                }
                (node.logger || that.logger).debug('[Z2M] Message suppressed: retained message during startup window');
                return;
            }

            // ── v3.1.0: comparação granular no modo "Multiple input" ──
            const filterPropsMulti = that.normalizeList(opts.filterProperties);
            if (filterPropsMulti.length && opts.node_send) {
                const changedMsg = opts.changed;                                   // {topic, payload(bruto), item, retained}
                const changedItem = changedMsg && changedMsg.item;
                const rawMulti = opts.rawPayload || (changedMsg && changedMsg.payload);

                if (changedItem && rawMulti && typeof rawMulti === 'object') {
                    const scopeId = String(changedItem.ieee_address !== undefined ? changedItem.ieee_address : changedItem.id);
                    const rawPresentMulti = that.selectFilterProperties(rawMulti, filterPropsMulti);
                    if (!rawPresentMulti.length) {
                        (node.logger || that.logger).debug('[Z2M] Message filtered: none of the selected properties is in the raw payload of ' + scopeId);
                        return;
                    }
                    const matchKey = Object.keys(payload).find(function (k) {
                        const it = payload[k] && payload[k].item;
                        return it && String(it.ieee_address !== undefined ? it.ieee_address : it.id) === scopeId;
                    });
                    const entryMulti = matchKey !== undefined ? payload[matchKey] : null;
                    const currentMulti = entryMulti ? that.getComparisonValue(entryMulti.payload, rawPresentMulti, entryMulti.homekit) : {};
                    if (!that.compareAndStoreFilter(node, scopeId, currentMulti)) {
                        (node.logger || that.logger).debug('[Z2M] Message filtered: no change in [' + rawPresentMulti.join(', ') + '] of ' + scopeId);
                        return;
                    }
                } else {
                    // sem payload bruto: comportamento anterior (comparação serializada)
                    const comparisonMulti = that.getMultipleComparison(payload, filterPropsMulti);
                    if (node.last_filter_value_legacy !== undefined && node.last_filter_value_legacy === comparisonMulti) {
                        (node.logger || that.logger).debug('[Z2M] Message filtered: no changes detected in selected properties');
                        return;
                    }
                    node.last_filter_value_legacy = comparisonMulti;
                }
            }
            //
            // if (opts.filter) {
            //     if (opts.node_send && JSON.stringify(node.last_value) === JSON.stringify(payload)) {
            //         // console.log('Filtered the same value');
            //         return;
            //     }
            // }


            // if ('last_value' in node) {
            //     msg.changed = {
            //         'old': node.last_value,
            //         'new': payload//,
            //         // 'diff': Zigbee2mqttHelper.objectsDiff(node.last_value, payload)
            //     };
            // }

            if (opts.node_send) {
                // console.log('SEND:');
                // console.log(payload);
                node.send(msg);
                node.last_value = payload;
            }

            let time = Zigbee2mqttHelper.statusUpdatedAt();
            let status = {
                fill: 'blue',
                shape: 'dot',
                text: text
            };
            node.setSuccessfulStatus(status);

            node.cleanTimer = setTimeout(() => {
                status.text += ' ' + time;
                status.shape = 'ring';
                node.setSuccessfulStatus(status);
            }, 3000);
        }

        onMQTTConnect() {
            var node = this;
            node.connection = true;  // ✅ Marca como conectado
            node.log('MQTT Connected');
            // Logger Node-RED
            node._reconnects = 0;
            if (node._connLostAt) {
                node.logger.notice('MQTT connection restored after ' + Math.round((Date.now() - node._connLostAt) / 1000) + 's');
                node._connLostAt = null;
            } else {
                node.logger.debug('MQTT connected to ' + node.config.host + ':' + (node.config.mqtt_port || 1883) + ', base topic "' + node.getBaseTopic() + '"');
            }
            node.publishStatus('online');
            node.emit('onMQTTConnect');
            node.subscribeMQTT();
            // v3.1.0: Home Assistant - subscrever o estado enabled, anunciar as entidades e aguardar o estado
            if (node.haNodes && node.haNodes.size) {
                node.subscribeHomeAssistant();
                node.announceHomeAssistantNodes(true);
                node.haNodes.forEach(function (clientNode) { node.scheduleHomeAssistantStateFallback(clientNode); });
            }
        }

        onMQTTDisconnect(error) {
            var node = this;
            node.connection = false;  // ✅ CORRIGIDO: Marca como desconectado
            node.log('MQTT Disconnected');
            node.emit('onConnectError', error);  // ✅ CORRIGIDO: Notifica os nós
            if (error) {
                node.warn('MQTT disconnect: ' + (error && error.message ? error.message : error));
            }
        }

        onMQTTError(error) {
            var node = this;
            node.connection = false;  // ✅ CORRIGIDO: Marca como desconectado
            node.log('MQTT Error');
            node.emit('onConnectError', error);  // ✅ CORRIGIDO: Notifica os nós
            if (error) {
                node.warn('MQTT error: ' + (error && error.message ? error.message : error));
            }
        }

        onMQTTOffline() {
            let node = this;
            node.connection = false;  // ✅ CORRIGIDO: Marca como desconectado
            node.warn('MQTT Offline');
            node.emit('onConnectError');  // ✅ CORRIGIDO: Notifica os nós
        }

        onMQTTEnd() {
            var node = this;
            node.connection = false;  // ✅ CORRIGIDO: Marca como desconectado
            node.log('MQTT End');
        }

        onMQTTReconnect() {
            var node = this;
            // Mantém connection = false até receber onMQTTConnect
            node.log('MQTT Reconnect attempt...');
            // Logger Node-RED
            node._reconnects = (node._reconnects || 0) + 1;
            node.logger.debug('MQTT reconnect attempt #' + node._reconnects);
        }

        onMQTTClose() {
            var node = this;
            node.connection = false;  // ✅ CORRIGIDO: Marca como desconectado
            node.log('MQTT Close');
            // Logger Node-RED: connectivity loss (throttled: the client retries every 5s)
            if (!node._connLostAt) node._connLostAt = Date.now();
            node.logger.throttle('warn', 'mqtt-close', 30000,
                'Connection to MQTT broker ' + node.config.host + ':' + (node.config.mqtt_port || 1883) + ' is down - retrying every 5s');
        }

        onMQTTMessage(topic, message, packet) {
            var node = this;
            var messageString = message.toString();

            // v3.1.0: estado/comandos enabled do Home Assistant (node-red/<base>/ha/...) - nunca são valores de devices
            if (node.haNodes && topic.indexOf(node.getHaTopicPrefix()) === 0) {
                node.onHomeAssistantMessage(topic, messageString);
                return;
            }

            //bridge
            if (topic.includes('/bridge/')) {
                if (node.getTopic('/bridge/devices') === topic) {
                    if (Zigbee2mqttHelper.isJson(messageString)) {
                        try {
                            const devices = JSON.parse(messageString);
                            node.devices = devices;
                            // Logger Node-RED: notice when the count changes, debug otherwise (renames, re-publishes)
                            const devCount = Array.isArray(devices) ? devices.length : 0;
                            node.logger[node._deviceCount === devCount ? 'debug' : 'notice']('Zigbee2MQTT device list received: ' + devCount + ' devices');
                            node._deviceCount = devCount;
                            node.context().global.set('z2m_devices_' + node.id, devices);
                            // v3.1.0: as exposes podem ter mudado (sensor <-> binary_sensor) - republica só o que mudou
                            try { node.announceHomeAssistantNodes(false); } catch (haErr) { node.logger.warn('Home Assistant: discovery update failed: ' + haErr.message); }
                            // v3.1.x: deteção de devices novos/removidos/renomeados (middleware independente)
                            try { node.onZigbeeEntitiesUpdated('devices', devices); } catch (haErr) { node.logger.warn('Home Assistant: entity detection failed: ' + haErr.message); }
                        } catch (e) {
                            node.warn('Failed to parse devices JSON: ' + e.message);
                        }
                    }
                } else if (node.getTopic('/bridge/groups') === topic) {
                    if (Zigbee2mqttHelper.isJson(messageString)) {
                        try {
                            const groups = JSON.parse(messageString);
                            node.groups = groups;
                            const grpCount = Array.isArray(groups) ? groups.length : 0;
                            node.logger[node._groupCount === grpCount ? 'debug' : 'notice']('Zigbee2MQTT group list received: ' + grpCount + ' groups');
                            node._groupCount = grpCount;
                            node.context().global.set('z2m_groups_' + node.id, groups);
                            // v3.1.x: nós "in" apontados a GRUPOS só podem ser anunciados depois de a lista de grupos chegar
                            try { node.onZigbeeEntitiesUpdated('groups', groups); } catch (haErr) { node.logger.warn('Home Assistant: entity detection failed: ' + haErr.message); }
                        } catch (e) {
                            node.warn('Failed to parse groups JSON: ' + e.message);
                        }
                    }
                    if (node.devices) {
                        for (let ind in node.devices) {
                            let dTopic = node.getTopic('/' + (node.devices[ind]['friendly_name'] ? node.devices[ind]['friendly_name'] : node.devices[ind]['ieee_address']));
                            const hasValue = (node.devices_values instanceof Map) ? node.devices_values.has(dTopic) : (dTopic in node.devices_values);
                            if (!hasValue && node.devices[ind].definition) {
                                let getPayload = {};
                                let isEmpty = true;
                                for (let exp of node.devices[ind].definition.exposes) {
                                    if (exp.access && (exp.access & 0b100)) {
                                        getPayload[exp.name] = "";
                                        isEmpty = false;
                                    }
                                }
                                if (!isEmpty) node.mqtt.publish(dTopic + '/get', JSON.stringify(getPayload));
                            }
                        }
                    }
                } else if (node.getTopic('/bridge/groups') === topic) {
                    if (Zigbee2mqttHelper.isJson(messageString)) {
                        node.groups = JSON.parse(messageString);
                    }
                } else if (node.getTopic('/bridge/state') === topic) {
                    let availabilityStatus = false;
                    
                    if (Zigbee2mqttHelper.isJson(messageString)) {
                        let availabilityStatusObject = JSON.parse(messageString);
                        availabilityStatus = 'state' in availabilityStatusObject && availabilityStatusObject.state === 'online';
                    } else {
                        availabilityStatus = messageString === 'online';
                    }
                    
                    node.bridge_state = availabilityStatus ? 'online' : 'offline';
                    
                    node.emit('onMQTTBridgeState', {
                        topic: topic,
                        payload: availabilityStatus,
                    });
                    if (node.bridge_state !== null || !availabilityStatus) {
                        if (!availabilityStatus) {
                            node.warn(`Bridge offline`)
                        }
                        // ✅ Log silencioso quando fica online (apenas em debug)
                        else if (typeof Z2MDebug !== 'undefined' && Z2MDebug.isEnabled()) {
                            node.log(`Bridge online`)
                        }
                    }
                    node.bridge_state = availabilityStatus
                    // v3.1.0: bridge online -> (re)anunciar as entidades do Home Assistant
                    if (availabilityStatus) {
                        try { node.announceHomeAssistantNodes(true); } catch (haErr) { node.logger.warn('Home Assistant: discovery failed: ' + haErr.message); }
                    }
                } else if (node.getTopic('/bridge/info') === topic) {
                    try {
                        node.bridge_info = JSON.parse(messageString);
                        if (node.bridge_info && typeof node.bridge_info === 'object') {
                            if (!node._bridgeInfoSeen) {
                                node._bridgeInfoSeen = true;
                                node.logger.notice('Zigbee2MQTT bridge info received (version ' + node.bridge_info.version + ')');
                            }
                            const permitJoinNow = !!node.bridge_info.permit_join;
                            if (node._lastPermitJoin !== undefined && node._lastPermitJoin !== permitJoinNow) {
                                node.logger.notice('Zigbee2MQTT permit_join ' + (permitJoinNow ? 'ENABLED (pairing mode)' : 'disabled'));
                            }
                            node._lastPermitJoin = permitJoinNow;
                        }
                    } catch (error) {
                        node.warn("Failed to parse Bridge info JSON:", error);
                        node.bridge_info = null;
                    }
                }

                node.emit('onMQTTMessageBridge', {
                    topic: topic,
                    payload: messageString,
                });

            } else {
                // REFATORADO: Verificação mais robusta de sufixos
                if (topic.endsWith('/set') || topic.endsWith('/get')) {
                    return;
                }

                //availability
                if (topic.endsWith('/availability')) {

                    let availabilityStatus = null;
                    if (Zigbee2mqttHelper.isJson(messageString)) {
                        let availabilityStatusObject = JSON.parse(messageString);
                        availabilityStatus = 'state' in availabilityStatusObject && availabilityStatusObject.state === 'online';

                    } else {
                        availabilityStatus = messageString === 'online';
                    }

                    // Logger Node-RED: log only real transitions (first sighting at debug, going offline at notice)
                    const availKey = topic.split('/availability').join('');
                    if (node.availability[availKey] !== availabilityStatus) {
                        node.logger[availabilityStatus ? 'debug' : 'notice']('Availability: "' + availKey + '" is now ' + (availabilityStatus ? 'online' : 'OFFLINE'));
                    }
                    node.availability[topic.split('/availability').join('')] = availabilityStatus;

                    node.emit('onMQTTAvailability', {
                        topic: topic,
                        payload: availabilityStatus,
                        item: node.getDeviceOrGroupByKey(topic.split('/availability').join(''))
                    });
                    return;
                }

                let payload = null;
                try {
                    const parsed = JSON.parse(messageString);
                    
                    // Verifica se o resultado é um objeto válido e não null
                    if (parsed && typeof parsed === 'object') {
                        payload = {};
                        Object.assign(payload, parsed); // Mantém o comportamento original de clonagem
                    } else {
                        // Se for JSON válido mas não um objeto (ex: número solto), trata como string
                        // para manter consistência com a lógica de Object.assign
                        payload = messageString;
                    }
                } catch (e) {
                    // Se ocorrer erro no JSON.parse, é uma string normal
                    payload = messageString;
                }
                
                // Use Map instead of Object for devices_values to maintain insertion order and avoid expensive Object.keys() calls.
                const MAX_CACHE_SIZE = 2000;
                
                // Map.size is O(1)
                if (node.devices_values.size > MAX_CACHE_SIZE) {
                    const oldestKey = node.devices_values.keys().next().value;
                    node.logger.throttle('debug', 'cache-evict', 60000, 'devices_values cache is full (' + MAX_CACHE_SIZE + ' topics) - evicting the oldest entries');
                    node.devices_values.delete(oldestKey);
                }
 
                const currentVal = node.devices_values.get(topic);
                if (currentVal && typeof currentVal === 'object' && typeof payload === 'object') {
                    // Merge new payload into existing object
                    Object.assign(currentVal, payload);
                    // 🔥 FIX: Delete and Set to update insertion order (True LRU)
                    node.devices_values.delete(topic);
                    // Re-set to update order (LRU behavior) if desired, or just leave modified object
                    node.devices_values.set(topic, currentVal);
                } else {
                    //Delete and Set to update insertion order
                    node.devices_values.delete(topic);
                    node.devices_values.set(topic, payload);
                }
                
                node.emit('onMQTTMessage', {
                    topic: topic,
                    payload: payload,
                    item: node.getDeviceOrGroupByKey(topic),
                    retained: !!(packet && packet.retain)
                });

            }
        }

        onClose(removed, done) {
            var node = this;

            node.logger.debug('Server node closing (' + (removed ? 'removed' : 'restart/deploy') + ')');
            // Notificar clientes registados que o servidor vai fechar
            if (node.clientNodes) {
                node.clientNodes.forEach(client => {
                    if (client.status) client.status({fill: "red", shape: "ring", text: "@evilbunny/node-red-contrib-zigbee2mqtt/server:status.server_stopping"});
                });
                node.clientNodes.clear();
                node.clientNodes = null;
            }
            // v3.1.0: cancelar timers e libertar o registo dos nós expostos ao Home Assistant
            if (node.haNodes) {
                node.haNodes.forEach(function (clientNode) { clearTimeout(clientNode._haFallbackTimer); });
                node.haNodes.clear();
            }
            if (node.haConfigCache) node.haConfigCache.clear();

            // Remover todos os listeners internos do EventEmitter do Node
            node.removeAllListeners();

            const client = node.mqtt;
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                clearTimeout(guard);
                if (client) {
                    try {
                        client.removeAllListeners();
                        // clean disconnect, so the broker doesn't also fire the Last Will
                        client.end(false, {}, () => {});
                    } catch (e) {
                        node.warn("Error closing MQTT client: " + e.message);
                    }
                }
                node.mqtt = null; // Libertar referência para GC
                node.connection = false;
                node.log('MQTT connection closed and resources freed');
                if (done) done();
            };
            // don't hold up a deploy if the broker doesn't acknowledge in time
            const guard = setTimeout(() => {
                node.logger.warn('MQTT broker did not acknowledge the shutdown within 2s - forcing the connection closed');
                if (client) { try { client.end(true); } catch (e) {} }
                finish();
            }, 2000);

            if (client && node.connection) {
                if (client.unsubscribe) client.unsubscribe(node.getTopic('/#'), function () {});
                // deleted server node: clear its retained status; otherwise mark it offline
                node.publishStatus(removed ? null : 'offline', finish);
            } else {
                finish();
            }
            if (node.devices_values instanceof Map) node.devices_values.clear();
        }
    }

    RED.nodes.registerType('zigbee2mqtt-eb-server', ServerNode, {
        credentials: {
            mqtt_user: { type: "text" },
            mqtt_pass: { type: "password" }
        }
    });
};
