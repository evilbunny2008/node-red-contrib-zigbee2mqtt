var NODE_PATH = '/zigbee2mqtt-eb/';

module.exports = function(RED) {
    // verbose diagnostics only appear when Node-RED's log level is 'debug'
    function debugLog() {
        RED.log.debug(Array.prototype.map.call(arguments, function (a) {
            return (a !== null && typeof a === 'object') ? JSON.stringify(a) : String(a);
        }).join(' '));
    }

    // ═══════════════════════════════════════════════════════════
    // OUTROS ENDPOINTS (mantidos iguais)
    // ═══════════════════════════════════════════════════════════
    
    RED.httpAdmin.get(NODE_PATH + 'getDevices', function (req, res) {
        var config = req.query;
        if (!config || typeof config !== 'object') {
             return res.status(400).json({error: "Invalid request parameters"});
        }
        // IDs do Node-RED são tipicamente hexadecimais e pontos.
        if (!config.controllerID || typeof config.controllerID !== 'string' || !/^[a-zA-Z0-9\._]+$/.test(config.controllerID)) {
            return res.status(400).json({error: "Invalid controllerID format"});
        }
        var controller = RED.nodes.getNode(config.controllerID);
        
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            controller.getDevices(function (items) {
                if (items) {
                    res.json(items);
                } else {
                    res.status(404).end();
                }
            }, true);
        } else {
            res.json([[],[]]);
        }
    });

    RED.httpAdmin.post(NODE_PATH + 'restart', RED.auth.needsPermission("zigbee2mqtt.write"), function (req, res) {
        var config = req.body;
        if (!config || !config.controllerID) {
            return res.status(400).json({error: "Missing controllerID"});
        }
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            try {
                controller.restart();
                res.json({"result":"ok"});
            } catch (e) {
                console.error("[Z2M API] Restart failed:", e);
                res.status(500).json({error: e.message});
            }
        } else {
            res.status(404).json({error: "Controller not found"});
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'setPermitJoin', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var time = config.time ? parseInt(config.time) : 180;
            var result = controller.setPermitJoin(
                config.permit_join === 'true', 
                time
            );
            
            res.json({
                "result": "ok", 
                "time": time,
                "enabled": config.permit_join === 'true'
            });
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'setLogLevel', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            controller.setLogLevel(config.log_level);
            res.json({"result":"ok"});
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'getConfig', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            res.json(controller.bridge_info);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'renameDevice', RED.auth.needsPermission("zigbee2mqtt.write"), function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.renameDevice(config.ieee_address, config.newName);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'removeDevice', RED.auth.needsPermission("zigbee2mqtt.write"), function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.removeDevice(config.id, config.newName);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'renameGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.renameGroup(config.id, config.newName);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'removeGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.removeGroup(config.id);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'addGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.addGroup(config.name);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'removeDeviceFromGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.removeDeviceFromGroup(config.deviceId, config.groupId);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'addDeviceToGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.addDeviceToGroup(config.deviceId, config.groupId);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'refreshMap', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            controller.refreshMap(true, config.engine).then(function(response){
                res.json(response);
            }).catch(error => {
                res.status(404).end();
            });
        } else {
            res.status(404).end();
        }
    });
    
    RED.httpAdmin.get(NODE_PATH + 'showMap', function (req, res) {
        var config = req.query;
        if (!config.controllerID) {
            return res.status(400).send("Missing controllerID");
        }

        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.type === "zigbee2mqtt-eb-server") {
            var response = controller.map;
            
            if (response) {
                // ✅ Fix: Definir Content-Type usando res.set para maior compatibilidade com Express
                res.set('Content-Type', 'image/svg+xml');
                res.send(response);
            } else {
                // Caso o mapa ainda não tenha sido gerado
                res.status(404).send("Map data not available. Please refresh map first.");
            }
        } else {
            res.status(404).send("Controller not found or invalid type");
        }
    });
    
    RED.httpAdmin.get(NODE_PATH + 'serverState/:id', function(req, res) {
        const serverId = req.params.id;
        
        debugLog('\n========================================');
        debugLog('[Z2M API] 📡 serverState request');
        debugLog('[Z2M API] ServerId:', serverId);
        
        const serverNode = RED.nodes.getNode(serverId);
        
        if (!serverNode) {
            debugLog('[Z2M API] ❌ Server node NOT FOUND');
            debugLog('========================================\n');
            return res.json({ 
                online: false,
                state: 'not_configured',
                error: 'Server not found'
            });
        }
        
        const hasMqttClient = !!serverNode.mqtt;
        const isMqttConnected = serverNode.connection === true;
        const bridgeState = serverNode.bridge_state;
        
        debugLog('[Z2M API] 🔍 Analyzing state:');
        debugLog('  - Has MQTT client:', hasMqttClient);
        debugLog('  - MQTT connected:', isMqttConnected);
        debugLog('  - Bridge state:', bridgeState, '(type:', typeof bridgeState + ')');
        
        let state = 'unknown';
        let online = false;
        let errorComponent = null;
        
        // LÓGICA DE DETECÇÃO
        if (!isMqttConnected || !hasMqttClient) {
            state = 'mqtt_offline';
            online = false;
            errorComponent = 'mqtt';
            debugLog('  → MQTT OFFLINE');
        }
        else if (isMqttConnected && (bridgeState === false || bridgeState === 'offline')) {
            state = 'z2m_offline';
            online = false;
            errorComponent = 'zigbee2mqtt';
            debugLog('  → Z2M OFFLINE (MQTT is OK)');
        }
        else if (isMqttConnected && bridgeState === null) {
             state = 'unknown'; // Connected but no bridge state yet
             online = false;
             errorComponent = 'zigbee2mqtt_waiting';
        }
        else if (isMqttConnected && (bridgeState === true || bridgeState === 'online')) {
            state = 'online';
            online = true;
            errorComponent = null;
            debugLog('  → ALL SYSTEMS ONLINE');
        }
        else {
            state = 'unknown';
            online = false;
            errorComponent = 'unknown';
            debugLog('  → UNKNOWN STATE');
        }
        
        // ✅ ADICIONAR COORDINATOR AO RESPONSE
        let coordinator = null;
        if (serverNode.bridge_info && serverNode.bridge_info.coordinator) {
            coordinator = {
                type: serverNode.bridge_info.coordinator.type || 'Unknown',
                meta: {
                    revision: serverNode.bridge_info.coordinator.meta?.revision || 'Unknown'
                }
            };
        }
        
        const response = {
            // Estado geral
            online: online,
            state: state,
            errorComponent: errorComponent,
            
            // Detalhes MQTT
            mqtt: {
                connected: isMqttConnected,
                has_client: hasMqttClient,
                host: serverNode.config?.host || 'Unknown',
                port: serverNode.config?.mqtt_port || '1883'
            },
            
            // Detalhes Zigbee2MQTT
            zigbee2mqtt: {
                bridge_state: bridgeState,
                base_topic: serverNode.config?.base_topic || 'zigbee2mqtt',
                version: serverNode.bridge_info?.version || null,
                permit_join: serverNode.bridge_info?.permit_join || false,
                log_level: serverNode.bridge_info?.log_level || 'info',
                coordinator: coordinator // ✅ ADICIONAR COORDINATOR
            },
            
            // Estatísticas
            stats: {
                devices: serverNode.devices ? serverNode.devices.length : 0,
                groups: serverNode.groups ? serverNode.groups.length : 0
            }
        };
        
        debugLog('[Z2M API] 📤 Response:', {
            online: response.online,
            state: response.state,
            errorComponent: response.errorComponent,
            coordinator: coordinator ? `${coordinator.type} (${coordinator.meta.revision})` : 'null'
        });
        debugLog('========================================\n');
        
        res.json(response);
    });

    // This file exists purely to register the httpAdmin routes above (used by the
    // editor's device/group pickers). It has no runtime behaviour of its own, but is
    // registered as a real (invisible) node so that node-red-dev/other node package
    // validators can parse it like any other node file.
    function Zigbee2mqttApiNode(config) {
        RED.nodes.createNode(this, config);
    }
    RED.nodes.registerType('zigbee2mqtt-eb-api', Zigbee2mqttApiNode, {
        category: 'config' // config-type nodes are automatically excluded from the palette
    });
};
