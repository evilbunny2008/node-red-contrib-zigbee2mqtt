const Zigbee2mqttHelper = require('../resources/Zigbee2mqttHelper.js');
// Node-RED system logger (4 levels); the level is the one chosen in the server config node
const Z2MLogger = require('../resources/js/node-red-contrib-zigbee2mqtt-logger.js').Logger;

module.exports = function(RED) {

    class Zigbee2mqttNodeBridge {
        constructor(config) {

            RED.nodes.createNode(this, config);

            let node = this;
            node.config = config;
            // Logger Node-RED: follows the level of the selected server node (live, no redeploy needed)
            node.logger = Z2MLogger.create(node, {
                prefix: 'Bridge',
                getLevel: function () { return node.server ? node.server.debug_level : undefined; }
            });
            node.cleanTimer = null;
            node.is_subscribed = false;
            node.server = RED.nodes.getNode(node.config.server);
            if (!node.server) {
                node.logger.error('No Zigbee2MQTT server configuration node selected/found - the bridge node is inactive');
            }

            if (node.server) {
                node.listener_onMQTTConnect = function() { node.onMQTTConnect(); }
                node.server.on('onMQTTConnect', node.listener_onMQTTConnect);

                node.listener_onMQTTMessageBridge = function(data) { node.onMQTTMessageBridge(data); }
                node.server.on('onMQTTMessageBridge', node.listener_onMQTTMessageBridge);

                // onConnectError() existed but was never subscribed: without this the bridge node
                // kept showing its last status when the MQTT connection dropped.
                node.listener_onConnectError = function(err) { node.onConnectError(err); }
                node.server.on('onConnectError', node.listener_onConnectError);

                node.on('close', () => node.onClose());

                if (typeof(node.server.mqtt) === 'object') {
                    node.onMQTTConnect();
                }
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.no_server"
                });
            }

            if (node.server) {
                node.on('input', function (message_in) {
                    // Validação robusta de entrada
                    if (!message_in || typeof message_in !== 'object') {
                         node.warn("Ignored invalid input message (not an object)");
                         return;
                    }
                    // CORREÇÃO: Tratar payload undefined explicitamente para evitar erros silenciosos
                    if (message_in.payload === undefined && node.config.payloadType === 'msg') {
                        node.warn("Message payload is undefined but required by configuration");
                        return;
                    }
                    
                    if (!node.server || !node.server.mqtt || !node.server.connection) {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.no_connection"
                        });
                        node.error("MQTT not connected - cannot publish message");
                        return;
                    }

                    if (!message_in.topic) {
                        node.error("Message must have a 'topic' property");
                        return;
                    }

                    if (message_in.payload === undefined || message_in.payload === null) {
                        node.error("Message must have a 'payload' property");
                        return;
                    }

                    node.log('Published to mqtt topic: ' + message_in.topic + 
                             ' Payload: ' + JSON.stringify(message_in.payload));

                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: "@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.publishing"
                    });

                    node.server.mqtt.publish(
                        message_in.topic, 
                        JSON.stringify(message_in.payload),
                        { qos: parseInt(node.server.config.mqtt_qos || 0) },
                        (err) => {
                            if (err) {
                                node.status({
                                    fill: "red",
                                    shape: "dot",
                                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.publish_failed"
                                });
                                node.error("MQTT publish error: " + err.message);
                                
                                setTimeout(() => {
                                    node.setNodeStatus();
                                }, 5000);
                            } else {
                                setTimeout(() => {
                                    node.setNodeStatus();
                                }, 1000);
                            }
                        }
                    );
                });

            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.no_server"
                });
            }
        }

        onClose() {
            let node = this;
            if (node.server) {
                node.logger.debug('Bridge node closing');
                // REFATORADO: Desregistar cliente
                if (typeof node.server.unregisterClient === 'function') {
                    node.server.unregisterClient(node);
                }

                if (node.listener_onConnectError) {
                    node.server.removeListener('onConnectError', node.listener_onConnectError);
                }
                if (node.listener_onMQTTConnect) {
                    node.server.removeListener('onMQTTConnect', node.listener_onMQTTConnect);
                }
                if (node.listener_onMQTTMessageBridge) {
                    node.server.removeListener("onMQTTMessageBridge", node.listener_onMQTTMessageBridge);
                }
            }
        }

        onMQTTConnect() {
            this.logger.debug('MQTT connection of the server node is up');
            let node = this;
            node.setNodeStatus();
        }

        onConnectError() {
            // Logger Node-RED (throttled: the MQTT client retries every 5s)
            this.logger.throttle('warn', 'bridge-conn-error', 30000,
                'The server node reported an MQTT connection error' + (arguments[0] && arguments[0].message ? ': ' + arguments[0].message : ''));
            let node = this;
            node.status({
                fill: "red",
                shape: "dot",
                text: RED._("@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.offline")
            });
        }

        setNodeStatus() {
            let node = this;

            if (node.server.bridge_info && node.server.bridge_info.permit_join && node.server.bridge_state) {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: "@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.searching"
                });
            } else {
                let text = node.server.bridge_state ?
                    RED._("@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.online") :
                    RED._("@evilbunny/node-red-contrib-zigbee2mqtt/bridge:status.offline");
                
                if (node.server.bridge_info && "log_level" in node.server.bridge_info) {
                    text += ' (log: ' + node.server.bridge_info.log_level + ')';
                }
                
                node.status({
                    fill: node.server.bridge_state ? "green" : "red",
                    shape: "dot",
                    text: text
                });
            }
        }
        
        onMQTTMessageBridge(data) {
            let node = this;
             // Proteção contra payload nulo ou indefinido
            if (!data || !Object.prototype.hasOwnProperty.call(data, 'payload'))
                return;
            
            let payload;
            try {
                const strPayload = (typeof data.payload === 'object' && data.payload !== null) 
                    ? data.payload.toString() 
                    : String(data.payload);
                    
                payload = Zigbee2mqttHelper.isJson(strPayload) ? JSON.parse(strPayload) : strPayload;
            } catch (e) {
                node.warn("Failed to parse bridge message: " + e.message);
                payload = data.payload;
            }
            
            if (node.server.getTopic('/bridge/state') === data.topic) {
                // Logger Node-RED: log only real state transitions
                const bridgeOnline = (payload && typeof payload === 'object') ? payload.state === 'online' : payload === 'online';
                if (node._lastBridgeOnline !== bridgeOnline) {
                    if (bridgeOnline) {
                        node.logger.notice('Zigbee2MQTT bridge is online');
                    } else {
                        node.logger.warn('Zigbee2MQTT bridge is OFFLINE (check zigbee2mqtt and the MQTT broker)');
                    }
                    node._lastBridgeOnline = bridgeOnline;
                }
                node.setNodeStatus();
            } else if (node.server.getTopic('/bridge/info') === data.topic) {
                if (payload.permit_join != (node.status.fill === 'yellow')) {
                    node.setNodeStatus();
                }
            } else if (node.server.getTopic('/bridge/event') === data.topic) {
                if (!payload) 
                    return;
                // Throttle visual: Atualizar no máximo a cada 1s para evitar sobrecarga do editor
                node.logger.debug('Bridge event: ' + (payload.type || 'event') + (payload.data ? ' ' + JSON.stringify(payload.data) : ''));
                const now = Date.now();
                if (node._lastStatusUpdate === undefined) 
                    node._lastStatusUpdate = 0;
                
                if (now - node._lastStatusUpdate > 1000) {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: payload.type || 'event'
                    });
                    node._lastStatusUpdate = now;
                }
                
                // Debounce do reset de status
                if (node.cleanTimer) clearTimeout(node.cleanTimer);
                node.cleanTimer = setTimeout(() => {
                    node.setNodeStatus();
                }, 2000); // 2s é suficiente para ler o evento
            }
 
            node.send({
                payload: payload,
                topic: data.topic
            });
        }
    }
    RED.nodes.registerType('zigbee2mqtt-eb-bridge', Zigbee2mqttNodeBridge);
    
};
