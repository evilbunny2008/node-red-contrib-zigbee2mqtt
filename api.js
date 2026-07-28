var NODE_PATH = '/zigbee2mqtt-eb/';

module.exports = function(RED) {
    RED.httpAdmin.get(NODE_PATH + 'getDevices', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);

        if (controller && controller.constructor.name === "ServerNode") {
            controller.getDevices(function (items) {
                if (items) {
                    res.json(items);
                } else {
                    res.status(404).end();
                }
            }, true);
        } else {
            res.json([{},{}]);
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'restart', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            controller.restart();
            res.json({"result":"ok"});
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'setPermitJoin', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            controller.setPermitJoin(config.permit_join==='true'?true:false);
            res.json({"result":"ok"});
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'setLogLevel', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            controller.setLogLevel(config.log_level);
            res.json({"result":"ok"});
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'getConfig', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            res.json(controller.bridge_info);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'renameDevice', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.renameDevice(config.ieee_address, config.newName);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'removeDevice', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.removeDevice(config.id, config.newName);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'renameGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.renameGroup(config.id, config.newName);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'removeGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.removeGroup(config.id);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'addGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.addGroup(config.name);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'removeDeviceFromGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.removeDeviceFromGroup(config.deviceId, config.groupId);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'addDeviceToGroup', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.addDeviceToGroup(config.deviceId, config.groupId);
            res.json(response);
        } else {
            res.status(404).end();
        }
    });

    RED.httpAdmin.get(NODE_PATH + 'refreshMap', function (req, res) {
        var config = req.query;
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
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
        var controller = RED.nodes.getNode(config.controllerID);
        if (controller && controller.constructor.name === "ServerNode") {
            var response = controller.map;
            res.writeHead(200, {'Content-Type': 'image/svg+xml'});
            res.end(response); // Send the file data to the browser.
        } else {
            res.status(404).end();
        }
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
}
