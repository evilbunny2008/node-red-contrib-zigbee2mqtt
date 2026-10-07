/**
 * ============================================================================
 * ZIGBEE2MQTT - SISTEMA DE DEBUG COMPLETO
 * ============================================================================
 * 
 * Localização: /resources/js/debug.js
 * 
 * QUICK START:
 *   Z2MDebug.help()                - Ajuda completa
 * 
 * USAGE:
 *   Z2MDebug.enable()              - Ativar debug mode
 *   Z2MDebug.disable()             - Desativar debug mode
 *   Z2MDebug.isEnabled()           - Verificar status
 *   Z2MDebug.help()                - Mostrar ajuda completa
 * 
 *   Z2MDebug.typedInput()          - Diagnóstico TypedInput
 *   Z2MDebug.listServers()         - Listar servidores Z2M
 *   Z2MDebug.selectServer(id)      - Selecionar servidor
 *   Z2MDebug.listDevices()         - Listar devices
 *   Z2MDebug.inspect(name)         - Inspecionar device
 *   Z2MDebug.showCommands(name)    - Ver comandos do device
 *   Z2MDebug.showValues(name)      - Ver valores atuais
 * 
 * CHANGELOG:
 *   - v3.0: API completa com device/group/server management
 *   - v3.0: Fix: listDevices() agora lista TODOS
 *   - v3.0: Adicionado refresh forçado
 *   - v3.0: Adicionadas ferramentas de network
 */

(function(window) {
    'use strict';
// ========================================================================
// EMOJI CONSTANTS (usar em strings, NUNCA direto no código)
// ========================================================================
    const EMOJI = {
        SUCCESS: '\u2705',     // ✅
        ERROR: '\u274C',       // ❌
        WARNING: '\u26A0\uFE0F', // ⚠️
        INFO: '\u2139\uFE0F',  // ℹ️
        LOADING: '\u23F3',     // ⏳
        FIRE: '\uD83D\uDD25',  // 🔥
        REFRESH: '\uD83D\uDD04', // 🔄
        SEARCH: '\uD83D\uDD0D', // 🔍
        PACKAGE: '\uD83D\uDCE6', // 📦
        LINK: '\uD83D\uDD17',  // 🔗
        CHART: '\uD83D\uDCCA', // 📊
        PARTY: '\uD83C\uDF89'  // 🎉
    };    
    // ========================================================================
    // 🎨 CONFIGURAÇÃO DE CORES
    // ========================================================================
    const COLORS = {
        title:      'color: #2196F3; font-weight: bold; font-size: 14px;',
        subtitle:   'color: #FF9800; font-weight: bold;',
        key:        'color: #4CAF50; font-weight: bold;',
        value:      'color: #666;',
        error:      'color: #F44336; font-weight: bold;',
        success:    'color: #4CAF50; font-weight: bold;',
        warning:    'color: #FF9800; font-weight: bold;',
        info:       'color: #2196F3;',
        property:   'color: #9C27B0; font-weight: bold;',
        command:    'color: #00BCD4; font-weight: bold;',
        prefix:     'color: #9C27B0; font-weight: bold;'
    };
    
    // ========================================================================
    // 📊 ESTADO GLOBAL
    // ========================================================================
    let DEBUG = false;
    let selectedServer = null;
    let devicesCache = null;
    let groupsCache = null;
    
    try {
        DEBUG = localStorage.getItem('z2m_debug') === 'true';
    } catch(e) {
        console.warn('[Z2M] localStorage inaccessível');
    }
    
    // ========================================================================
    // 🛠️ HELPERS INTERNOS
    // ========================================================================
    
    function print(text, style = '') {
        console.log(`%c${text}`, style);
    }
    
    function printBox(text, style = COLORS.title) {
        console.log('');
        console.log(`%c╔${'═'.repeat(text.length + 2)}╗`, style);
        console.log(`%c║ ${text} ║`, style);
        console.log(`%c╚${'═'.repeat(text.length + 2)}╝`, style);
        console.log('');
    }
    
    function printSection(title) {
        console.log('');
        console.log(`%c▶ ${title}`, COLORS.subtitle);
        console.log(`%c${'─'.repeat(60)}`, 'color: #ddd;');
    }
    
    function createDebugger(prefix) {
        return {
            log: function() {
                if (!DEBUG) return;
                console.log('%c[' + prefix + ']', COLORS.prefix, ...arguments);
            },
            warn: function() {
                if (!DEBUG) return;
                console.warn('%c[' + prefix + ']', COLORS.warning, ...arguments);
            },
            error: function() {
                if (!DEBUG) return;
                console.error('%c[' + prefix + ' ERROR]', COLORS.error, ...arguments);
            },
            info: function() {
                if (!DEBUG) return;
                console.info('%c[' + prefix + ']', COLORS.info, ...arguments);
            },
            group: function(label) {
                if (!DEBUG) return;
                console.group('%c[' + prefix + '] ' + label, COLORS.prefix);
            },
             success: function() {
                if (!DEBUG) return;
                console.log('%c[' + prefix + ' SUCCESS]', COLORS.success, ...arguments);
            },
            groupEnd: function() {
                if (!DEBUG) return;
                console.groupEnd();
            },
            table: function(data) {
                if (!DEBUG) return;
                console.table(data);
            },
            isEnabled: function() {
                return DEBUG;
            }
        };
    }
    
    // ========================================================================
    // 🔧 API HELPERS
    // ========================================================================
    
    function getServer(serverId) {
        if (!DEBUG) 
            return;
        
        if (!serverId) {
            print('❌ No server ID provided', COLORS.error);
            return null;
        }
        
        const serverNode = RED.nodes.node(serverId);
        if (!serverNode) {
            print(`❌ Server not found: ${serverId}`, COLORS.error);
            return null;
        }
        
        return serverNode;
    }
    
    async function getDevicesAndGroups(server, forceRefresh = false) {
        if (!DEBUG) 
            return;
        
        return new Promise((resolve, reject) => {
            if (!server) {
                reject('No server provided');
                return;
            }
            
            // ✅ FIX: Usar cache apenas se não for refresh forçado
            if (!forceRefresh && devicesCache && groupsCache) {
                console.log('%c✔ Using cached data', COLORS.success);
                resolve([devicesCache, groupsCache]);
                return;
            }
            
            print('⏳ Loading from API...', COLORS.info);
            
            fetch('zigbee2mqtt-eb/getDevices?' + new URLSearchParams({
                controllerID: server.id
            }), {
                method: 'GET',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data && data[0] && data[1]) {
                    devicesCache = data[0];
                    groupsCache = data[1];
                    print(`✔ Loaded ${devicesCache.length} devices, ${groupsCache.length} groups`, COLORS.success);
                    resolve([devicesCache, groupsCache]);
                } else {
                    reject('No data returned');
                }
            })
            .catch(error => {
                reject(error);
            });
        });
    }
    
    function findDevice(devices, name) {
        if (!DEBUG) 
            return;
        
        if (!devices || !Array.isArray(devices)) return null;
        
        // Exact match
        let device = devices.find(d => 
            d.friendly_name === name || 
            d.ieee_address === name
        );
        
        // Case-insensitive
        if (!device) {
            const nameLower = name.toLowerCase();
            device = devices.find(d => 
                d.friendly_name?.toLowerCase() === nameLower ||
                d.ieee_address?.toLowerCase() === nameLower
            );
        }
        
        // Partial match
        if (!device) {
            const nameLower = name.toLowerCase();
            device = devices.find(d => 
                d.friendly_name?.toLowerCase().includes(nameLower) ||
                d.ieee_address?.toLowerCase().includes(nameLower)
            );
        }
        
        return device;
    }
    
    function findGroup(groups, id) {
        if (!DEBUG) 
            return;
        
        if (!groups || !Array.isArray(groups)) return null;
        
        // Try by ID
        let group = groups.find(g => g.id == id);
        
        // Try by friendly_name
        if (!group) {
            group = groups.find(g => g.friendly_name === id);
        }
        
        return group;
    }
    
    function extractCommands(device) {
        if (!DEBUG) 
            return;
        
        if (!device?.definition?.exposes) return [];
        
        const commands = [];
        
        const flatten = (exposes) => {
            for (const expose of exposes) {
                if (expose.property && expose.access && (expose.access & 2)) {
                    commands.push({
                        property: expose.property,
                        name: expose.name || expose.property,
                        type: expose.type,
                        access: expose.access,
                        access_binary: expose.access.toString(2).padStart(3, '0'),
                        values: expose.values || null,
                        value_min: expose.value_min,
                        value_max: expose.value_max,
                        value_step: expose.value_step,
                        unit: expose.unit,
                        description: expose.description
                    });
                }
                
                if (expose.features && Array.isArray(expose.features)) {
                    flatten(expose.features);
                }
            }
        };
        
        flatten(device.definition.exposes);
        
        return commands;
    }
    
    // ========================================================================
    // 📡 SERVER MANAGEMENT
    // ========================================================================
    
    function listServers() {
        if (!DEBUG) 
            return;
        
        printBox('ZIGBEE2MQTT SERVERS');
        
        const servers = [];
        RED.nodes.eachConfig((node) => {
            if (node.type === 'zigbee2mqtt-eb-server') {
                servers.push(node);
            }
        });
        
        if (servers.length === 0) {
            print('❌ No Z2M servers configured', COLORS.error);
            return;
        }
        
        console.table(servers.map(s => ({
            ID: s.id,
            Name: s.name || '(unnamed)',
            Host: s.host,
            Port: s.mqtt_port || 1883,
            'Base Topic': s.base_topic || 'zigbee2mqtt',
            '✓': selectedServer?.id === s.id ? '✓' : ''
        })));
        
        print('', '');
        print(`💡 Use Z2MDebug.selectServer("${servers[0].id}")`, COLORS.info);
    }
    
    function selectServer(serverId) {
        if (!DEBUG) 
            return;
        
        const server = getServer(serverId);
        if (!server) return;
        
        selectedServer = server;
        devicesCache = null;
        groupsCache = null;
        
        printBox('SERVER SELECTED');
        
        console.log(`%c✔ Server: ${server.name || '(unnamed)'}`, COLORS.success);
        console.log(`%c  Host: ${server.host}:${server.mqtt_port || 1883}`, COLORS.info);
        console.log(`%c  Base Topic: ${server.base_topic || 'zigbee2mqtt'}`, COLORS.info);
        
        print('', '');
        print('💡 Next: Z2MDebug.listDevices()', COLORS.info);
    }
    
    async function showServerConfig() {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        printBox('SERVER CONFIGURATION');
        
        try {
            const response = await fetch('zigbee2mqtt-eb/getConfig?' + new URLSearchParams({
                controllerID: selectedServer.id
            }));
            
            const config = await response.json();
            
            if (!config) {
                print('❌ No config data', COLORS.error);
                return;
            }
            
            printSection('Bridge Info');
            console.log(`%c  Version: %c${config.version || 'Unknown'}`, COLORS.key, COLORS.value);
            console.log(`%c  Permit Join: %c${config.permit_join ? 'YES' : 'NO'}`, COLORS.key, COLORS.value);
            console.log(`%c  Log Level: %c${config.log_level || 'info'}`, COLORS.key, COLORS.value);
            console.log(`%c  Restart Required: %c${config.restart_required ? 'YES' : 'NO'}`, COLORS.key, COLORS.value);
            
            if (config.coordinator) {
                printSection('Coordinator');
                console.log(`%c  Type: %c${config.coordinator.type}`, COLORS.key, COLORS.value);
                console.log(`%c  Revision: %c${config.coordinator.meta?.revision || 'Unknown'}`, COLORS.key, COLORS.value);
            }
            
            if (config.config) {
                printSection('Configuration');
                console.log(`%c  Advanced Output: %c${config.config.advanced?.output || 'json'}`, COLORS.key, COLORS.value);
                console.log(`%c  Legacy API: %c${config.config.advanced?.legacy_api ? 'ON' : 'OFF'}`, COLORS.key, COLORS.value);
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function restartServer() {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        if (!confirm('⚠️  Restart Zigbee2MQTT server?')) {
            print('Cancelled', COLORS.warning);
            return;
        }
        
        try {
            const response = await fetch('zigbee2mqtt-eb/restart', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    controllerID: selectedServer.id
                })
            });
            
            const result = await response.json();
            
            if (result.result === 'ok') {
                print('✔ Restart requested', COLORS.success);
            } else {
                print('❌ Restart failed', COLORS.error);
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function permitJoin(enable = true, time = 180) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const response = await fetch('zigbee2mqtt-eb/setPermitJoin?' + new URLSearchParams({
                controllerID: selectedServer.id,
                permit_join: enable.toString(),
                time: time.toString()
            }));
            
            const result = await response.json();
            
            if (result.result === 'ok') {
                if (enable) {
                    print(`✔ Permit Join ENABLED for ${time}s`, COLORS.success);
                } else {
                    print('✔ Permit Join DISABLED', COLORS.success);
                }
            } else {
                print('❌ Command failed', COLORS.error);
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function setLogLevel(level) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        const validLevels = ['info', 'debug', 'warning', 'error'];
        if (!validLevels.includes(level)) {
            print(`❌ Invalid level. Use: ${validLevels.join(', ')}`, COLORS.error);
            return;
        }
        
        try {
            const response = await fetch('zigbee2mqtt-eb/setLogLevel?' + new URLSearchParams({
                controllerID: selectedServer.id,
                log_level: level
            }));
            
            const result = await response.json();
            
            if (result.result === 'ok') {
                print(`✔ Log level set to: ${level}`, COLORS.success);
            } else {
                print('❌ Command failed', COLORS.error);
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    // ========================================================================
    // 📱 DEVICE MANAGEMENT
    // ========================================================================
    
    async function listDevices(forceRefresh = false) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected. Use Z2MDebug.selectServer(id) first', COLORS.error);
            return;
        }
        
        if (forceRefresh) {
            printBox('REFRESHING DEVICES...');
        } else {
            printBox('LOADING DEVICES...');
        }
        
        try {
            const [devices, groups] = await getDevicesAndGroups(selectedServer, forceRefresh);
            
            printBox('DEVICES LIST');
            
            // ✅ FIX: Mostrar TODOS os devices (incluindo Coordinator se quiser)
            console.table(devices.map(d => ({
                'Friendly Name': d.friendly_name,
                'IEEE': d.ieee_address.substring(0, 16) + '...',
                'Model': d.definition?.model || 'Unknown',
                'Vendor': d.definition?.vendor || 'Unknown',
                'Type': d.type,
                'Power': d.power_source || 'Unknown'
            })));
            
            print('', '');
            print(`✔ Total: ${devices.length} devices`, COLORS.success);
            print('💡 Use Z2MDebug.inspect("name") to inspect', COLORS.info);
            print('💡 Use Z2MDebug.listDevices(true) to force refresh', COLORS.info);
            
        } catch (error) {
            print(`❌ Failed to load: ${error}`, COLORS.error);
        }
    }
    
    async function inspect(deviceName) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                print('', '');
                print('💡 Available devices:', COLORS.info);
                devices.forEach(d => {
                    console.log(`   - ${d.friendly_name}`);
                });
                return;
            }
            
            printBox(`DEVICE: ${device.friendly_name}`);
            
            printSection('Basic Information');
            console.log(`%c  IEEE: %c${device.ieee_address}`, COLORS.key, COLORS.value);
            console.log(`%c  Type: %c${device.type}`, COLORS.key, COLORS.value);
            console.log(`%c  Power: %c${device.power_source || 'Unknown'}`, COLORS.key, COLORS.value);
            console.log(`%c  Model: %c${device.definition?.model || 'Unknown'}`, COLORS.key, COLORS.value);
            console.log(`%c  Vendor: %c${device.definition?.vendor || 'Unknown'}`, COLORS.key, COLORS.value);
            
            if (device.current_values) {
                printSection('Current Values');
                Object.entries(device.current_values).forEach(([key, value]) => {
                    console.log(`%c  ${key}: %c${JSON.stringify(value)}`, COLORS.property, COLORS.value);
                });
            }
            
            const commands = extractCommands(device);
            if (commands.length > 0) {
                printSection(`Commands (${commands.length})`);
                console.table(commands.map(cmd => ({
                    'Property': cmd.property,
                    'Name': cmd.name,
                    'Type': cmd.type,
                    'Min': cmd.value_min ?? '-',
                    'Max': cmd.value_max ?? '-'
                })));
            }
            
            print('', '');
            print('💡 Z2MDebug.showCommands(name) - Detailed commands', COLORS.info);
            print('💡 Z2MDebug.inspectFull(name) - Full JSON', COLORS.info);
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function inspectFull(deviceName) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                return;
            }
            
            printBox(`FULL DATA: ${device.friendly_name}`);
            console.log(device);
            
            print('', '');
            print('💡 Expand the object above ▶', COLORS.info);
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function showCommands(deviceName) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                return;
            }
            
            const commands = extractCommands(device);
            
            printBox(`COMMANDS: ${device.friendly_name}`);
            
            if (commands.length === 0) {
                print('⚠️  No writable commands', COLORS.warning);
                return;
            }
            
            commands.forEach((cmd, index) => {
                console.log('');
                console.log(`%c${index + 1}. ${cmd.property}`, COLORS.command);
                console.log(`%c   Name: %c${cmd.name}`, COLORS.key, COLORS.value);
                console.log(`%c   Type: %c${cmd.type}`, COLORS.key, COLORS.value);
                
                if (cmd.values) {
                    console.log(`%c   Values: %c${cmd.values.join(', ')}`, COLORS.key, COLORS.value);
                }
                
                if (cmd.value_min !== undefined && cmd.value_max !== undefined) {
                    console.log(`%c   Range: %c${cmd.value_min} - ${cmd.value_max}${cmd.unit ? ` ${cmd.unit}` : ''}`, COLORS.key, COLORS.value);
                }
                
                if (device.current_values && cmd.property in device.current_values) {
                    console.log(`%c   Current: %c${JSON.stringify(device.current_values[cmd.property])}`, COLORS.property, COLORS.success);
                }
            });
            
            print('', '');
            print(`✔ ${commands.length} command(s)`, COLORS.success);
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function showValues(deviceName) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                return;
            }
            
            printBox(`VALUES: ${device.friendly_name}`);
            
            if (!device.current_values) {
                print('⚠️  No values available', COLORS.warning);
                return;
            }
            
            Object.entries(device.current_values).forEach(([key, value]) => {
                console.log(`%c  ${key}: %c${JSON.stringify(value, null, 2)}`, COLORS.property, COLORS.value);
            });
            
            print('', '');
            print(`✔ ${Object.keys(device.current_values).length} value(s)`, COLORS.success);
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function renameDevice(deviceName, newName) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                return;
            }
            
            const response = await fetch('zigbee2mqtt-eb/renameDevice?' + new URLSearchParams({
                controllerID: selectedServer.id,
                ieee_address: device.ieee_address,
                newName: newName
            }));
            
            const result = await response.json();
            
            if (result.error) {
                print(`❌ ${result.description}`, COLORS.error);
            } else {
                print(`✔ Renamed: ${deviceName} → ${newName}`, COLORS.success);
                devicesCache = null; // Invalidar cache
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function removeDevice(deviceName) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        if (!confirm(`⚠️  Remove device "${deviceName}"?`)) {
            print('Cancelled', COLORS.warning);
            return;
        }
        
        try {
            const [devices] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                return;
            }
            
            const response = await fetch('zigbee2mqtt-eb/removeDevice?' + new URLSearchParams({
                controllerID: selectedServer.id,
                id: device.ieee_address
            }));
            
            const result = await response.json();
            
            if (result.error) {
                print(`❌ ${result.description}`, COLORS.error);
            } else {
                print(`✔ Device removed: ${deviceName}`, COLORS.success);
                devicesCache = null;
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    // ========================================================================
    // 👥 GROUP MANAGEMENT
    // ========================================================================
    
    async function listGroups() {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices, groups] = await getDevicesAndGroups(selectedServer);
            
            printBox('GROUPS LIST');
            
            if (groups.length === 0) {
                print('⚠️  No groups found', COLORS.warning);
                return;
            }
            
            console.table(groups.map(g => ({
                'ID': g.id,
                'Friendly Name': g.friendly_name,
                'Members': g.members ? g.members.length : 0
            })));
            
            print('', '');
            print(`✔ Total: ${groups.length} groups`, COLORS.success);
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function createGroup(name) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const response = await fetch('zigbee2mqtt-eb/addGroup?' + new URLSearchParams({
                controllerID: selectedServer.id,
                name: name
            }));
            
            const result = await response.json();
            
            if (result.error) {
                print(`❌ ${result.description}`, COLORS.error);
            } else {
                print(`✔ Group created: ${name}`, COLORS.success);
                groupsCache = null;
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function renameGroup(groupId, newName) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const response = await fetch('zigbee2mqtt-eb/renameGroup?' + new URLSearchParams({
                controllerID: selectedServer.id,
                id: groupId,
                newName: newName
            }));
            
            const result = await response.json();
            
            if (result.error) {
                print(`❌ ${result.description}`, COLORS.error);
            } else {
                print(`✔ Group renamed: ${groupId} → ${newName}`, COLORS.success);
                groupsCache = null;
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }
    
    async function removeGroup(groupId) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        if (!confirm(`⚠️  Remove group "${groupId}"?`)) {
            print('Cancelled', COLORS.warning);
            return;
        }
        
        try {
                const response = await fetch('zigbee2mqtt-eb/removeGroup?' + new URLSearchParams({
                    controllerID: selectedServer.id,
                    id: groupId
                }));
                
                const result = await response.json();
                
                if (result.error) {
                    print(`❌ ${result.description}`, COLORS.error);
                } else if (result.error) {
                    print(`❌ ${result.description}`, COLORS.error);
                } else {
                    print(`✔ Group removed: ${groupId}`, COLORS.success);
                    groupsCache = null;
                }
            } catch (error) {
                    print(`❌ Error: ${error}`, COLORS.error);
                }
    }

    async function addDeviceToGroup(deviceName, groupId) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices, groups] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                return;
            }
            
            const response = await fetch('zigbee2mqtt-eb/addDeviceToGroup?' + new URLSearchParams({
                controllerID: selectedServer.id,
                deviceId: device.ieee_address,
                groupId: groupId
            }));
            
            const result = await response.json();
            
            if (result.error) {
                print(`❌ ${result.description}`, COLORS.error);
            } else {
                print(`✔ Added ${deviceName} to group ${groupId}`, COLORS.success);
                groupsCache = null;
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }

    async function removeDeviceFromGroup(deviceName, groupId) {
        if (!DEBUG) 
            return;
        
        if (!selectedServer) {
            print('❌ No server selected', COLORS.error);
            return;
        }
        
        try {
            const [devices] = await getDevicesAndGroups(selectedServer);
            const device = findDevice(devices, deviceName);
            
            if (!device) {
                print(`❌ Device not found: ${deviceName}`, COLORS.error);
                return;
            }
            
            const response = await fetch('zigbee2mqtt-eb/removeDeviceFromGroup?' + new URLSearchParams({
                controllerID: selectedServer.id,
                deviceId: device.ieee_address,
                groupId: groupId
            }));
            
            const result = await response.json();
            
            if (result.error) {
                print(`❌ ${result.description}`, COLORS.error);
            } else {
                print(`✔ Removed ${deviceName} from group ${groupId}`, COLORS.success);
                groupsCache = null;
            }
            
        } catch (error) {
            print(`❌ Error: ${error}`, COLORS.error);
        }
    }

    // ========================================================================
    // 🔬 TYPEDINPUT DIAGNOSTIC
    // ========================================================================

    function debugTypedInput() {
        if (!DEBUG) 
            return;
        
        printBox('TYPEDINPUT DIAGNOSTIC');
        
        function inspectTypedInput(selector, name) {
            const $elem = $(selector);
            
            console.log(`%c📦 ${name}:`, COLORS.subtitle);
            console.log('  - Exists:', $elem.length > 0);
            // 🔥 FIX: Deteção via classes do DOM (mais fiável no HA Ingress)
            const hasWidget = $elem.parent().hasClass('red-ui-typedInput-container') || 
                              !!($elem.data('typedInput') || $elem.data('red-ui-typedInput'));
            console.log('  - Has TypedInput:', hasWidget);
            
            if (hasWidget) {
                try {
                    const type = $elem.typedInput('type');
                    const value = $elem.typedInput('value');
                    
                    console.log('  - type:', type);
                    console.log('  - value:', value);
                    console.log('  - value type:', typeof value);
                    console.log('  - widget structure:', $elem.parent().find('.red-ui-typedInput-container').length > 0 ? 'DOM OK' : 'DOM MISSING');
                    
                    if (value && typeof value === 'object') {
                        console.log('  - value keys:', Object.keys(value));
                        if ('value' in value) {
                            console.log('  - value.value:', value.value);
                        }
                    }
                } catch(e) {
                    console.error('  - Read error:', e.message);
                }
            }
            console.log('');
        }
        
        inspectTypedInput('#node-input-command', 'Command Input');
        inspectTypedInput('#node-input-payload', 'Payload Input');
        inspectTypedInput('#node-input-optionsValue', 'Options Input');
        
        print('✅ Diagnostic complete', COLORS.success);
    }
    
    function diagnoseTriggers() {
        if (!DEBUG) 
            return;
        
        if ($('#node-input-server').length === 0) {
            console.error('%c[Z2M Debug] ❌ Editor window is CLOSED. Open a node to diagnose triggers.', COLORS.error);
            return;
        }
 
        printBox('Z2M TRIGGER DIAGNOSTIC');
        const elements = {
            'Server': '#node-input-server',
            'Device': '#node-input-device_id',
            'Command': '#node-input-command',
            'Payload': '#node-input-payload'
        };
 
        Object.entries(elements).forEach(([name, selector]) => {
            const $el = $(selector);
            if ($el.length === 0) {
                console.log(`%c🎯 ${name} (${selector}): %cNOT FOUND IN DOM`, COLORS.subtitle, COLORS.error);
                return;
            }
            const events = $._data($el[0], "events");
            console.log(`%c🎯 ${name} (${selector}):`, COLORS.subtitle);
            if (events && events.change) {
                console.log(`  ✅ Change events found: ${events.change.length}`);
                events.change.forEach((ev, i) => {
                    console.log(`    [${i}] Namespace: ${ev.namespace || 'none'}`, ev.handler);
                });
            } else {
                console.log('  ❌ NO CHANGE EVENTS ATTACHED');
            }
        });
    }
    
    /**
     * Inspeciona a instância viva do Editor para detetar bloqueios
     */
    function traceEditor() {
        if (!DEBUG) 
            return;
        
        printBox('Z2M EDITOR INSTANCE TRACE');
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        const editors = window.Z2M_EDITORS || {};
        
        if (instances.length === 0) {
            print('❌ No active instances in Z2M_EDITOR_INSTANCES', COLORS.error);
            return;
        }
 
        const instance = instances[instances.length - 1];
        console.log('%c🔍 Instance State:', COLORS.subtitle);
        console.table({
            'Initializing': instance.initializing,
            'Mode': instance.config.mode,
            'NodeID': instance.node.id,
            'DeviceID': instance.device_id,
            'Command': instance.node.command,
            'Payload': instance.node.payload,
            'Registered in EDITORS': !!editors[instance.node.id]
        });
 
        printSection('Build History');
        if (instance._traceLog) {
            instance._traceLog.forEach(t => console.log(`[%c${t.time}%c] ${t.msg}`, 'color: #888', 'color: #333'));
        }
    }
    /**
     * Inspeciona o nó
     */
    function inspectNode() {
        if (!DEBUG) 
            return;
        
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        if (instances.length === 0) return console.error('No editor instance found');
        const instance = instances[instances.length - 1];
        
        printBox('NODE VS UI STATE (DEEP CHECK)');
        
        // 🔥 FIX: Deteção via classes do DOM (mais fiável no HA Ingress)
        const $pay = $('#node-input-payload');
        const hasPayWidget = $pay.parent().hasClass('red-ui-typedInput-container') || 
                              $pay.closest('.red-ui-typedInput-container').length > 0 ||
                              $pay.parent().find('.red-ui-typedInput-type-select').length > 0 ||
                              !!($pay.data('typedInput') || $pay.data('red-ui-typedInput'));
 
 
        console.log('%c[1. INTERNAL NODE (Last Saved)]', COLORS.subtitle);
        console.table({
            'command': instance.node.command,
            'payload': instance.node.payload,
            'payloadType': instance.node.payloadType
        });
        
        console.log('%c[2. UI WIDGET (Current Screen)]', COLORS.subtitle);
        let widgetVal = 'N/A';
        try { if(hasPayWidget) widgetVal = $pay.typedInput('value'); } catch(e) {}
        
        console.table({
            'Command Selected': $('#node-input-command').val(),
            'Command Internal': instance._lastBuiltCommand,
            'Payload TypedInput': widgetVal,
            'Payload HTML Raw': $pay.val(),
            'Has Active Widget': hasPayWidget,
            'Initializing': instance.initializing
        });
    }
    /**
     * Valida se Command TypedInput está sincronizado com o node
     */
    function validateCommandSync () {
        if (!DEBUG) return;
        
        printBox('COMMAND SYNC VALIDATION');
        
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        if (instances.length === 0) {
            print('❌ No editor instance found', COLORS.error);
            return;
        }
        
        const instance = instances[instances.length - 1];
        const $cmd = $('#node-input-command');
        
        if (!$cmd.length) {
            print('❌ Command input not found', COLORS.error);
            return;
        }
        
        // ══════════════════════════════════════════════════════════════════════════
        // LER TODOS OS VALORES
        // ══════════════════════════════════════════════════════════════════════════
        
        // 1. Node interno
        const nodeCommand = instance.node.command;
        const nodeType = instance.node.commandType;
        
        // 2. Cache interno
        const cachedCommand = instance._lastBuiltCommand;
        const cachedDevice = instance._lastBuiltDevice;
        
        // 3. TypedInput widget
        let widgetType = 'N/A';
        let widgetValue = 'N/A';
        
        // 🔥 FIX: Deteção melhorada do TypedInput
        const hasTypedInput = !!($cmd.data('typedInput') || 
                                $cmd.data('red-ui-typedInput') ||
                                $cmd.parent().hasClass('red-ui-typedInput-container'));
        
        if (hasTypedInput) {
            try {
                // Tentar ler do widget
                widgetType = $cmd.typedInput('type');
                widgetValue = $cmd.typedInput('value');
                
                if (widgetValue && typeof widgetValue === 'object' && widgetValue.value) {
                    widgetValue = widgetValue.value;
                }
            } catch(e) {
                // Se falhar, tentar ler do HTML como fallback
                widgetValue = 'ERROR: ' + e.message;
                
                // 🔥 FALLBACK: Ler do HTML se TypedInput falhar
                const htmlVal = $cmd.val();
                if (htmlVal && htmlVal !== '') {
                    widgetValue = htmlVal + ' (from HTML)';
                    widgetType = $('#node-input-commandType').val() + ' (from HTML)';
                }
            }
        } else {
            // TypedInput não existe - ler direto do HTML
            const htmlVal = $cmd.val();
            const htmlType = $('#node-input-commandType').val();
            
            if (htmlVal && htmlVal !== '') {
                widgetValue = htmlVal + ' (HTML only)';
                widgetType = htmlType + ' (HTML only)';
            }
        }
        
        // 4. HTML input direto
        const htmlValue = $cmd.val();
        const htmlType = $('#node-input-commandType').val();
        
        // 5. Select oculto (lista de comandos)
        const $cmdList = $('#node-input-command-list');
        const availableCommands = [];
        $cmdList.find('option').each(function() {
            availableCommands.push($(this).val());
        });
        
        // ══════════════════════════════════════════════════════════════════════════
        // ANÁLISE
        // ══════════════════════════════════════════════════════════════════════════
        
        printSection('Current Values');
        console.log('%c  Node Command:      %c' + nodeCommand, COLORS.key, COLORS.value);
        console.log('%c  Node Type:         %c' + nodeType, COLORS.key, COLORS.value);
        console.log('%c  Cached Command:    %c' + cachedCommand, COLORS.key, COLORS.value);
        console.log('%c  Cached Device:     %c' + cachedDevice, COLORS.key, COLORS.value);
        console.log('%c  Widget Command:    %c' + widgetValue, COLORS.key, COLORS.value);
        console.log('%c  Widget Type:       %c' + widgetType, COLORS.key, COLORS.value);
        console.log('%c  HTML Command:      %c' + htmlValue, COLORS.key, COLORS.value);
        console.log('%c  HTML Type:         %c' + htmlType, COLORS.key, COLORS.value);
        console.log('%c  Has TypedInput:    %c' + hasTypedInput, COLORS.key, COLORS.value);
        
        printSection('Available Commands');
        console.log('%c  Count: %c' + availableCommands.length, COLORS.key, COLORS.value);
        availableCommands.forEach((cmd, i) => {
            console.log('%c    [' + i + '] %c' + cmd, COLORS.property, COLORS.value);
        });
        
        printSection('Validation');
        
        // ✅ VERIFICAÇÕES
        let hasErrors = false;
        
        // ══════════════════════════════════════════════════════════════════════════
        // 🔥 FIX: VALIDAÇÃO INTELIGENTE
        // ══════════════════════════════════════════════════════════════════════════
        
        // 1. Node vs Widget/HTML
        const widgetIsNA = widgetValue === 'N/A' || widgetValue.startsWith('ERROR');
        const widgetIsHTMLOnly = String(widgetValue).includes('(HTML only)');
        const htmlMatches = htmlValue === nodeCommand;
        
        if (widgetIsHTMLOnly) {
            // 🔥 FIX: Se widget é "(HTML only)", validar apenas Node vs HTML
            if (htmlMatches) {
                console.log('%c  ✅ Node ↔ HTML: SYNCED (TypedInput not initialized)', COLORS.success);
            } else {
                console.log('%c  ❌ MISMATCH: Node vs HTML', COLORS.error);
                console.log('%c     Node:   %c' + nodeCommand, COLORS.key, COLORS.value);
                console.log('%c     HTML:   %c' + htmlValue, COLORS.key, COLORS.value);
                hasErrors = true;
            }
            
        } else if (!widgetIsNA && nodeCommand !== widgetValue) {
            // Widget inicializado mas não corresponde
            console.log('%c  ❌ MISMATCH: Node vs Widget', COLORS.error);
            console.log('%c     Node:   %c' + nodeCommand, COLORS.key, COLORS.value);
            console.log('%c     Widget: %c' + widgetValue, COLORS.key, COLORS.value);
            hasErrors = true;
            
        } else if (widgetIsNA && !htmlMatches) {
            // Widget N/A e HTML não corresponde
            console.log('%c  ❌ MISMATCH: Node vs HTML (Widget N/A)', COLORS.error);
            console.log('%c     Node:   %c' + nodeCommand, COLORS.key, COLORS.value);
            console.log('%c     HTML:   %c' + htmlValue, COLORS.key, COLORS.value);
            hasErrors = true;
            
        } else {
            console.log('%c  ✅ Node ↔ Widget/HTML: SYNCED', COLORS.success);
        }
        
        // 2. Node vs Cache
        if (nodeCommand !== cachedCommand) {
            console.log('%c  ⚠️  WARNING: Node vs Cache', COLORS.warning);
            console.log('%c     Node:   %c' + nodeCommand, COLORS.key, COLORS.value);
            console.log('%c     Cache:  %c' + cachedCommand, COLORS.key, COLORS.value);
        } else {
            console.log('%c  ✅ Node ↔ Cache: SYNCED', COLORS.success);
        }
        
        // 3. Widget vs HTML (só se Widget não for N/A ou HTML-only)
        if (!widgetIsNA && !widgetIsHTMLOnly && widgetValue !== htmlValue) {
            console.log('%c  ⚠️  WARNING: Widget vs HTML', COLORS.warning);
            console.log('%c     Widget: %c' + widgetValue, COLORS.key, COLORS.value);
            console.log('%c     HTML:   %c' + htmlValue, COLORS.key, COLORS.value);
        } else if (widgetIsNA || widgetIsHTMLOnly) {
            console.log('%c  ⚠️  Widget is N/A or HTML-only - checking HTML instead', COLORS.warning);
            if (htmlMatches) {
                console.log('%c  ✅ HTML ↔ Node: SYNCED', COLORS.success);
            }
        } else {
            console.log('%c  ✅ Widget ↔ HTML: SYNCED', COLORS.success);
        }
        
        // 4. Comando existe na lista?
        if (availableCommands.length > 0) {
            if (!availableCommands.includes(nodeCommand)) {
                console.log('%c  ❌ Node command NOT in available list!', COLORS.error);
                hasErrors = true;
            } else {
                console.log('%c  ✅ Node command EXISTS in list', COLORS.success);
            }
        }
        
        print('', '');
        
        if (hasErrors) {
            print('❌ SYNC ERRORS DETECTED!', COLORS.error);
            print('', '');
            print('💡 Try:', COLORS.info);
            print('   1. Close and reopen the node', COLORS.info);
            print('   2. Refresh the page (Ctrl+F5)', COLORS.info);
            print('   3. Check console for errors', COLORS.info);
        } else {
            print('✅ ALL SYNCED!', COLORS.success);
        }
    }


    // ════════════════════════════════════════════════════════════════════════════
    // 🔍 TYPEDINPUT LIFECYCLE MONITOR
    // ════════════════════════════════════════════════════════════════════════════

    /**
     * Sistema de monitorização do lifecycle do TypedInput
     * Detecta criações, destruições e modificações
     */
    let typedInputLog = [];
    let isMonitoring = false;

    /**
     * Ativa monitorização do TypedInput
     * @param {string} selector - Seletor CSS (default: '#node-input-command')
     */
    function monitorTypedInput(selector = '#node-input-command') {
        if (!DEBUG) return;
        
        printBox('TYPEDINPUT MONITOR STARTING');
        
        // Reset log
        typedInputLog = [];
        isMonitoring = true;
        
        const $element = $(selector);
        
        if (!$element.length) {
            print('❌ Element not found: ' + selector, COLORS.error);
            return;
        }
        
        print('✅ Monitoring: ' + selector, COLORS.success);
        
        // ────────────────────────────────────────────────────────────────────────
        // INTERCEPTAR JQUERY METHODS
        // ────────────────────────────────────────────────────────────────────────
        
        // Guardar métodos originais
        const originalTypedInput = $.fn.typedInput;
        const originalVal = $element.val;
        const originalDestroy = $element.destroy;
        
        // ════════════════════════════════════════════════════════════════════════
        // WRAPPER: typedInput()
        // ════════════════════════════════════════════════════════════════════════
        $.fn.typedInput = function(action, ...args) {
            const timestamp = new Date().toLocaleTimeString() + '.' + new Date().getMilliseconds();
            const stack = new Error().stack;
            
            // Log evento
            if (this.is(selector)) {
                const event = {
                    timestamp: timestamp,
                    selector: selector,
                    action: typeof action === 'string' ? action : 'init',
                    args: args,
                    stack: stack,
                    element: this[0]
                };
                
                typedInputLog.push(event);
                
                // Logs coloridos
                if (action === 'destroy') {
                    console.log('%c[' + timestamp + '] 🔥 DESTROY', COLORS.error, selector);
                    console.log('%c   └─ Stack:', COLORS.warning, stack.split('\n')[2]);
                } else if (typeof action === 'object' || action === undefined) {
                    console.log('%c[' + timestamp + '] 🆕 CREATE', COLORS.success, selector);
                } else if (action === 'type') {
                    console.log('%c[' + timestamp + '] 🎯 TYPE', COLORS.info, args[0]);
                } else if (action === 'value') {
                    console.log('%c[' + timestamp + '] 📝 VALUE', COLORS.info, args[0]);
                }
            }
            
            // Chamar método original
            return originalTypedInput.apply(this, [action, ...args]);
        };
        
        print('📊 Monitoring active - use Z2MDebug.showTypedInputLog()', COLORS.info);
    }

    /**
     * Mostra log completo do TypedInput
     */
    function showTypedInputLog() {
        if (!DEBUG) return;
        
        printBox('TYPEDINPUT LIFECYCLE LOG');
        
        if (typedInputLog.length === 0) {
            print('ℹ️  No events logged', COLORS.info);
            print('💡 Run Z2MDebug.monitorTypedInput() first', COLORS.info);
            return;
        }
        
        print('📊 Total Events: ' + typedInputLog.length, COLORS.title);
        print('', '');
        
        // ────────────────────────────────────────────────────────────────────────
        // ANÁLISE DE EVENTOS
        // ────────────────────────────────────────────────────────────────────────
        
        let createCount = 0;
        let destroyCount = 0;
        let typeCount = 0;
        let valueCount = 0;
        
        typedInputLog.forEach((event, index) => {
            const action = event.action;
            
            if (action === 'init') {
                createCount++;
                console.log(`%c[${event.timestamp}] 🆕 CREATE`, COLORS.success, event.selector);
            } else if (action === 'destroy') {
                destroyCount++;
                console.log(`%c[${event.timestamp}] 🔥 DESTROY`, COLORS.error, event.selector);
                
                // Extrair linha do stack
                const stackLines = event.stack.split('\n');
                const callerLine = stackLines[2] || stackLines[1];
                const match = callerLine.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/);
                
                if (match) {
                    console.log(`%c   └─ at ${match[1]} (${match[2]}:${match[3]})`, COLORS.warning);
                }
            } else if (action === 'type') {
                typeCount++;
                console.log(`%c[${event.timestamp}] 🎯 TYPE`, COLORS.info, event.args[0]);
            } else if (action === 'value') {
                valueCount++;
                console.log(`%c[${event.timestamp}] 📝 VALUE`, COLORS.info, event.args[0]);
            }
        });
        
        print('', '');
        printSection('Statistics');
        
        console.table({
            'Creates': createCount,
            'Destroys': destroyCount,
            'Types': typeCount,
            'Values': valueCount,
            'Balance': createCount - destroyCount
        });
        
        // ────────────────────────────────────────────────────────────────────────
        // VERIFICAÇÃO DE PROBLEMAS
        // ────────────────────────────────────────────────────────────────────────
        
        print('', '');
        
        if (createCount < destroyCount) {
            print('❌ PROBLEM: More destroys than creates!', COLORS.error);
            print('   Widget is being destroyed WITHOUT being created!', COLORS.error);
        } else if (createCount > destroyCount + 1) {
            print('⚠️  WARNING: Multiple creates without destroy', COLORS.warning);
            print('   Widget might be leaking memory', COLORS.warning);
        } else if (createCount === destroyCount + 1) {
            print('✅ OK: Widget created and still exists', COLORS.success);
        } else {
            print('✅ OK: Creates and destroys balanced', COLORS.success);
        }
        
        // ────────────────────────────────────────────────────────────────────────
        // LISTAR DESTROY CALLS
        // ────────────────────────────────────────────────────────────────────────
        
        if (destroyCount > 0) {
            print('', '');
            printSection('Destroy Calls');
            
            typedInputLog
                .filter(e => e.action === 'destroy')
                .forEach((event, index) => {
                    const stackLines = event.stack.split('\n');
                    const callerLine = stackLines[2] || stackLines[1];
                    const match = callerLine.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/);
                    
                    if (match) {
                        console.log(`%c  ${index + 1}. ${match[1]}`, COLORS.key);
                        console.log(`%c     ${match[2]}:${match[3]}`, COLORS.value);
                    }
                });
        }
    }

    /**
     * Limpa log do TypedInput
     */
    function clearTypedInputLog() {
        if (!DEBUG) return;
        
        typedInputLog = [];
        print('🧹 TypedInput log cleared', COLORS.success);
    }

    /**
     * Para monitorização
     */
    function stopMonitoringTypedInput() {
        if (!DEBUG) return;
        
        isMonitoring = false;
        
        // Restaurar métodos originais (se guardados)
        // (simplificado - em produção seria necessário guardar referências)
        
        print('⏹️  Monitoring stopped', COLORS.warning);
    }

    /**
     * Verifica estado ATUAL do TypedInput
     */
    function checkTypedInputState(selector = '#node-input-command') {
        if (!DEBUG) return;
        
        printBox('TYPEDINPUT STATE CHECK');
        
        const $element = $(selector);
        
        if (!$element.length) {
            print('❌ Element not found: ' + selector, COLORS.error);
            return;
        }
        
        print('🔍 Element: ' + selector, COLORS.title);
        print('', '');
        
        // ────────────────────────────────────────────────────────────────────────
        // VERIFICAÇÕES
        // ────────────────────────────────────────────────────────────────────────
        
        const checks = {
            'Element exists': $element.length > 0,
            'Has typedInput data': !!$element.data('typedInput'),
            'Has red-ui-typedInput': !!$element.data('red-ui-typedInput'),
            'Has parent': $element.parent().length > 0,
            'Parent is container': $element.parent().hasClass('red-ui-typedInput-container'),
            'Has visible input': $element.parent().find('input.red-ui-typedInput-input').length > 0,
            'Is visible': $element.is(':visible'),
            'HTML value': $element.val() || '(empty)'
        };
        
        Object.entries(checks).forEach(([key, value]) => {
            const icon = (typeof value === 'boolean') ? (value ? '✅' : '❌') : 'ℹ️';
            const color = (typeof value === 'boolean') ? (value ? COLORS.success : COLORS.error) : COLORS.info;
            
            console.log(`%c  ${icon} ${key}: %c${value}`, COLORS.key, color);
        });
        
        // ────────────────────────────────────────────────────────────────────────
        // TENTAR LER VALORES
        // ────────────────────────────────────────────────────────────────────────
        
        print('', '');
        printSection('TypedInput Values');
        
        try {
            const type = $element.typedInput('type');
            const value = $element.typedInput('value');
            
            console.log(`%c  Type: %c${type}`, COLORS.key, COLORS.success);
            console.log(`%c  Value: %c${JSON.stringify(value)}`, COLORS.key, COLORS.success);
        } catch(e) {
            console.log(`%c  ❌ Error reading: %c${e.message}`, COLORS.error, COLORS.value);
        }
    }
/*
    function inspectSaveButton() {
        if (!DEBUG) return;
        
        printBox('SAVE BUTTON INSPECTION');
        
       // 1. Encontrar o botão Save (Seletor Universal para Ingress/Temas)
        const $saveBtn = $('.red-ui-tray-footer button, .ui-dialog-buttonpane button, #node-dialog-ok, .red-ui-footer button').filter(function() {
            const t = $(this).text().trim().toLowerCase();
            return t.includes('done') || t.includes('save') || t.includes('concluir') || t.includes('ok');
        }).first();
        
        if (!$saveBtn || $saveBtn.length === 0) {
            print('❌ Save button not found', COLORS.error);
            print('💡 Open a node editor first', COLORS.info);
            return;
        }
        
        print(`✅ Found Save button: "${$saveBtn.text().trim()}"`, COLORS.success);
        print('', '');
        
        // 2. Ver eventos registados
        const events = $._data($saveBtn[0], "events");
        
        printSection('Registered Events');
        
        if (events) {
            Object.keys(events).forEach(eventType => {
                console.log(`%c  ${eventType}:`, COLORS.key);
                
                events[eventType].forEach((handler, index) => {
                    console.log(`%c    [${index}] Namespace: ${handler.namespace || 'none'}`, COLORS.value);
                    console.log('       Handler:', handler.handler);
                });
            });
        } else {
            print('  No events found', COLORS.warning);
        }
        
        print('', '');
        
        // 3. Verificar se há oneditsave definido
        printSection('Node Definition');
        
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        if (instances.length > 0) {
            const instance = instances[instances.length - 1];
            const nodeType = instance.node.type;
            
            print(`  Node Type: ${nodeType}`, COLORS.info);
            
            // Tentar obter a definição do tipo
            if (RED && RED.nodes && RED.nodes.getType) {
                const typeDef = RED.nodes.getType(nodeType);
                
                if (typeDef) {
                    print('', '');
                    print('  ✅ Type definition found', COLORS.success);
                    
                    if (typeDef.oneditsave) {
                        print('', '');
                        print('  ⚠️  oneditsave IS DEFINED!', COLORS.warning);
                        console.log('%c  oneditsave function:', COLORS.key);
                        console.log(typeDef.oneditsave);
                    } else {
                        print('  No oneditsave defined', COLORS.info);
                    }
                    
                    if (typeDef.oneditprepare) {
                        print('', '');
                        print('  ℹ️  oneditprepare IS DEFINED', COLORS.info);
                    }
                    
                    if (typeDef.oneditcancel) {
                        print('', '');
                        print('  ℹ️  oneditcancel IS DEFINED', COLORS.info);
                    }
                } else {
                    print('  Type definition not found', COLORS.error);
                }
            }
        } else {
            print('  No active editor instance', COLORS.warning);
        }
        
        print('', '');
        print('💡 To intercept Save:', COLORS.info);
        print('   Z2MDebug.interceptSave()', COLORS.info);
    }

    function interceptSave() {
        if (!DEBUG) return;
        
        printBox('SAVE INTERCEPTOR ACTIVE');
        
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        if (instances.length === 0) {
            print('❌ No active editor instance', COLORS.error);
            return;
        }
        
        const instance = instances[instances.length - 1];
        const nodeType = instance.node.type;
        
        // Hook no oneditsave
        if (RED && RED.nodes && RED.nodes.getType) {
            const typeDef = RED.nodes.getType(nodeType);
            
            if (typeDef && typeDef.oneditsave) {
                const originalSave = typeDef.oneditsave;
                
                typeDef.oneditsave = function() {
                    console.log('');
                    console.log('%c╔═══════════════════════════════════════════════╗', COLORS.info);
                    console.log('%c║ 💾 SAVE BUTTON CLICKED!                      ║', COLORS.info);
                    console.log('%c╚═══════════════════════════════════════════════╝', COLORS.info);
                    console.log('');
                    
                    // Verificar estado ANTES do save
                    console.log('%c[BEFORE SAVE] TypedInput State:', COLORS.subtitle);
                    
                    const $cmd = $('#node-input-command');
                    if ($cmd.length) {
                        const hasWidget = !!($cmd.data('typedInput') || $cmd.data('red-ui-typedInput') || $cmd.parent().hasClass('red-ui-typedInput-container'));
                        console.log('  Command TypedInput exists:', hasWidget);
                        
                        if (hasWidget) {
                            try {
                                const type = $cmd.typedInput('type');
                                const value = $cmd.typedInput('value');
                                console.log('  Command type:', type);
                                console.log('  Command value:', value);
                            } catch(e) {
                                console.warn('  [Z2M Debug] Widget logic error:', e.message);
                            }
                        } else {
                            console.log('  HTML value:', $cmd.val() || '(empty)');
                            console.log('  HTML type:', $('#node-input-commandType').val() || '(none)');
                        }
                    }
                    
                    console.log('');
                    console.log('%c[EXECUTING] Original oneditsave...', COLORS.info);
                    
                    // Executar original
                    const result = originalSave.apply(this, arguments);
                    
                    console.log('');
                    console.log('%c[AFTER SAVE] TypedInput State:', COLORS.subtitle);
                    
                    if ($cmd.length) {
                        const hasWidget = !!($cmd.data('typedInput') || $cmd.data('red-ui-typedInput'));
                        console.log('  Command TypedInput exists:', hasWidget);
                        
                        if (!hasWidget) {
                            console.log('%c  ⚠️  WIDGET WAS DESTROYED DURING SAVE!', 'color: #F44336; font-weight: bold;');
                        }
                    }
                    
                    console.log('');
                    console.log('%c╔═══════════════════════════════════════════════╗', COLORS.success);
                    console.log('%c║ ✅ SAVE COMPLETE                              ║', COLORS.success);
                    console.log('%c╚═══════════════════════════════════════════════╝', COLORS.success);
                    console.log('');
                    
                    return result;
                };
                
                print('✅ Save interceptor installed', COLORS.success);
                print('', '');
                print('💡 Now click Save and watch the console', COLORS.info);
                
            } else {
                print('⚠️  No oneditsave found to intercept', COLORS.warning);
            }
        }
    }
*/
    function inspectSaveButton() {
        if (!DEBUG) return;
        const d = createDebugger('SaveInspect');
        printBox('DEEP SAVE INSPECTION');
        
        const $saveBtn = $('.red-ui-tray-footer button, .ui-dialog-buttonpane button, #node-dialog-ok, .red-ui-footer button').filter(function() {
            const t = $(this).text().trim().toLowerCase();
            return t.includes('done') || t.includes('save') || t.includes('ok') || t.includes('concluir');
        }).first();
        
        if (!$saveBtn.length) return d.error('Save button NOT FOUND in DOM');
        
         d.log('%c✅ Found Save button: ' + $saveBtn.text().trim(), COLORS.success);
        const ev = $._data($saveBtn[0], "events");
        if (ev) {
            d.group('Click Handlers');
            ev.click?.forEach((h, i) => {
                console.log(`%c[${i}] Namespace: ${h.namespace || 'none'}`, 'font-weight:bold');
                console.log(h.handler);
            });
            d.groupEnd();
        }
 
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        if (instances.length > 0) {
            const instance = instances[instances.length - 1];
            const nodeType = instance.node.type;
            const typeDef = RED.nodes.getType(nodeType);
            
            printSection('Node Definition: ' + nodeType);
            if (typeDef) {
                if (typeDef.oneditprepare) {
                    d.info('✅ oneditprepare DEFINED. Source:');
                    console.log('%c' + typeDef.oneditprepare.toString(), 'color: #333; background: #e3f2fd; padding: 5px;');
                }
                if (typeDef.oneditsave) {
                    d.warn('⚠️  oneditsave DEFINED. Source:');
                    console.log('%c' + typeDef.oneditsave.toString(), 'color: #333; background: #fff3e0; padding: 5px;');
                } else { d.error('❌ oneditsave is MISSING in type definition'); }
                
                if (typeDef.oneditcancel) {
                    d.info('✅ oneditcancel DEFINED. Source:');
                    console.log('%c' + typeDef.oneditcancel.toString(), 'color: #333; background: #f5f5f5; padding: 5px;');
                }
            } else { d.error('❌ Type definition not found for ' + nodeType); }
        } else { d.warn('No active editor instance found in Z2M_EDITOR_INSTANCES'); }
        
        print('', '');
        print('💡 Run Z2MDebug.interceptSave() to hook into the process', COLORS.info);
    }
 
function interceptSave() {
        if (!DEBUG) return;
        const d = createDebugger('Interceptor');
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        if (instances.length === 0) return d.error('No editor instance found');
        
        const nodeType = instances[instances.length-1].node.type;
        const typeDef = RED.nodes.getType(nodeType);
        if (!typeDef || !typeDef.oneditsave) return d.error('oneditsave missing in ' + nodeType);
        if (typeDef.oneditsave.__z2m_wrapped) return d.info('Interceptor already active');
 
        typeDef.__z2m_original_save = typeDef.oneditsave;
        typeDef.oneditsave = function() {
            printBox('SAVE PROCESS START');
            const $cmd = $('#node-input-command');
            const hasWidget = !!($cmd.data('typedInput') || $cmd.data('red-ui-typedInput') || $cmd.closest('.red-ui-typedInput-container').length > 0);
            
            d.info('Executing oneditsave logic...');
            try {
                const result = typeDef.__z2m_original_save.apply(this, arguments);
                
                // Se o save não foi cancelado (result !== false)
                if (result !== false) {
                    console.log('');
                    d.success('SAVE COMPLETE! Values stored in node:');
                    
                    // Capturar apenas as propriedades interessantes do Z2M
                    const savedData = {
                        'Device ID': this.device_id,
                        'Friendly Name': this.friendly_name,
                        'Command': this.command,
                        'Command Type': this.commandType,
                        'Payload': this.payload,
                        'Payload Type': this.payloadType,
                        'Topic (final)': this.topic
                    };
                    
                    console.table(savedData);
                    
                    // Log detalhado para objetos complexos
                    d.log('Full node object:', this);
                } else {
                    d.warn('Save was CANCELLED by the oneditsave function.');
                }
                return result;
            } catch(e) {
                d.error('CRASH in original oneditsave:', e.message);
                console.log('%cFunction source:', 'font-weight:bold', typeDef.__z2m_original_save.toString());
                throw e; 
            }
        };
        typeDef.oneditsave.__z2m_wrapped = true;
        d.success('Interceptor ARMED with Data Dump for ' + nodeType);
    }
    
    function stopIntercept() {
        const d = createDebugger('Interceptor');
        const instances = window.Z2M_EDITOR_INSTANCES || [];
        if (instances.length === 0) return;
        const typeDef = RED.nodes.getType(instances[instances.length-1].node.type);
        if (typeDef && typeDef.__z2m_original_save) {
            typeDef.oneditsave = typeDef.__z2m_original_save;
            delete typeDef.__z2m_wrapped;
            delete typeDef.__z2m_original_save;
            d.warn('Interceptor DISARMED. Original function restored.');
        }
    }   
    // ========================================================================
    // 📚 HELP SYSTEM
    // ========================================================================

    function help() {
        if (!DEBUG) 
            return;
        printBox('ZIGBEE2MQTT DEBUG TOOLS');
        
        console.log('%c🔧 SYSTEM', COLORS.subtitle);
        console.log('%cZ2MDebug.enable()', COLORS.command, '- Ativar debug (reload page)');
        console.log('%cZ2MDebug.disable()', COLORS.command, '- Desativar debug (reload page)');
        console.log('%cZ2MDebug.isEnabled()', COLORS.command, '- Verificar status');
        console.log('');
        
        console.log('%c📡 SERVER', COLORS.subtitle);
        console.log('%cZ2MDebug.listServers()', COLORS.command, '- Listar servidores');
        console.log('%cZ2MDebug.selectServer(id)', COLORS.command, '- Selecionar servidor');
        console.log('%cZ2MDebug.showServerConfig()', COLORS.command, '- Ver configuração');
        console.log('%cZ2MDebug.restartServer()', COLORS.command, '- Restart Zigbee2MQTT');
        console.log('%cZ2MDebug.permitJoin(enable, time)', COLORS.command, '- Pairing mode');
        console.log('%cZ2MDebug.setLogLevel(level)', COLORS.command, '- Set log (info/debug/warning/error)');
        console.log('');
        
        console.log('%c📱 DEVICES', COLORS.subtitle);
        console.log('%cZ2MDebug.listDevices(refresh)', COLORS.command, '- Listar devices');
        console.log('%cZ2MDebug.inspect(name)', COLORS.command, '- Inspecionar device');
        console.log('%cZ2MDebug.inspectFull(name)', COLORS.command, '- JSON completo');
        console.log('%cZ2MDebug.showCommands(name)', COLORS.command, '- Comandos detalhados');
        console.log('%cZ2MDebug.showValues(name)', COLORS.command, '- Valores atuais');
        console.log('%cZ2MDebug.renameDevice(name, newName)', COLORS.command, '- Renomear');
        console.log('%cZ2MDebug.removeDevice(name)', COLORS.command, '- Remover');
        console.log('');
        
        console.log('%c💥 GROUPS', COLORS.subtitle);
        console.log('%cZ2MDebug.listGroups()', COLORS.command, '- Listar groups');
        console.log('%cZ2MDebug.createGroup(name)', COLORS.command, '- Criar group');
        console.log('%cZ2MDebug.renameGroup(id, newName)', COLORS.command, '- Renomear');
        console.log('%cZ2MDebug.removeGroup(id)', COLORS.command, '- Remover');
        console.log('%cZ2MDebug.addDeviceToGroup(device, group)', COLORS.command, '- Adicionar');
        console.log('%cZ2MDebug.removeDeviceFromGroup(device, group)', COLORS.command, '- Remover');
        console.log('');
        
        console.log('%c🔬 DIAGNOSTIC', COLORS.subtitle);
        console.log('%cZ2MDebug.typedInput()', COLORS.command, '- TypedInput diagnostic');
        console.log('%cZ2MDebug.inspectNode()', COLORS.command, '- Node vs UI state');
        console.log('%cZ2MDebug.trace()', COLORS.command, '- Editor instance trace');
        console.log('%cZ2MDebug.triggers()', COLORS.command, '- Change Events diagnostic');
        console.log('%cZ2MDebug.validateCommandSync()', COLORS.command, '- Validate sync');
        console.log('');
        
        // ════════════════════════════════════════════════════════════════════════
        // 🆕 NOVA SECÇÃO: TYPEDINPUT MONITOR
        // ════════════════════════════════════════════════════════════════════════
        console.log('%c🔍 TYPEDINPUT MONITOR', COLORS.subtitle);
        console.log('%cZ2MDebug.monitorTypedInput(selector)', COLORS.command, '- Start monitoring');
        console.log('%cZ2MDebug.showTypedInputLog()', COLORS.command, '- Show lifecycle log');
        console.log('%cZ2MDebug.checkTypedInputState(selector)', COLORS.command, '- Check current state');
        console.log('%cZ2MDebug.clearTypedInputLog()', COLORS.command, '- Clear log');
        console.log('%cZ2MDebug.stopMonitoringTypedInput()', COLORS.command, '- Stop monitoring');
        console.log('');
        
        print('─'.repeat(60), 'color: #ddd;');
        print('💡 QUICK START:', COLORS.info);
        print('   1. Z2MDebug.listServers()      → Ver servidores', COLORS.info);
        print('   2. Z2MDebug.selectServer(id)   → Escolher', COLORS.info);
        print('   3. Z2MDebug.listDevices()      → Ver devices', COLORS.info);
        print('   4. Z2MDebug.inspect("name")    → Inspecionar', COLORS.info);
        print('', '');
        print('🔍 DEBUG TYPEDINPUT:', COLORS.warning);
        print('   1. Z2MDebug.monitorTypedInput()     → Ativar monitor', COLORS.info);
        print('   2. Open node, change device         → Fazer ações', COLORS.info);
        print('   3. Z2MDebug.showTypedInputLog()     → Ver log', COLORS.info);
    }

    // ========================================================================
    // 🌍 EXPORTAR API
    // ========================================================================
    window.Z2MDebug = {
        // System
        enable: function() {
            try {
                localStorage.setItem('z2m_debug', 'true');
                DEBUG = true;
                print('[Z2M] 🛠️ Debug ENABLED - Reload page', COLORS.success);
            } catch(e) {
                print('[Z2M] Failed to enable debug', COLORS.error);
            }
        },
        disable: function() {
            try {
                localStorage.removeItem('z2m_debug');
                DEBUG = false;
                print('[Z2M] Debug DISABLED - Reload page', COLORS.warning);
            } catch(e) {
                print('[Z2M] Failed to disable debug', COLORS.error);
            }
        },
        isEnabled: () => DEBUG,
        help: help,
        
        // Server
        listServers: listServers,
        selectServer: selectServer,
        showServerConfig: showServerConfig,
        restartServer: restartServer,
        permitJoin: permitJoin,
        setLogLevel: setLogLevel,
        
        // Devices
        listDevices: listDevices,
        inspect: inspect,
        inspectFull: inspectFull,
        showCommands: showCommands,
        showValues: showValues,
        renameDevice: renameDevice,
        removeDevice: removeDevice,
        
        // Groups
        listGroups: listGroups,
        createGroup: createGroup,
        renameGroup: renameGroup,
        removeGroup: removeGroup,
        addDeviceToGroup: addDeviceToGroup,
        removeDeviceFromGroup: removeDeviceFromGroup,
        
        // Diagnostic
        typedInput: debugTypedInput,
        diagnoseTriggers: diagnoseTriggers,
        trace: traceEditor,
        
        // TypedInput Monitor
        monitorTypedInput: monitorTypedInput,
        showTypedInputLog: showTypedInputLog,
        clearTypedInputLog: clearTypedInputLog,
        stopMonitoringTypedInput: stopMonitoringTypedInput,
        checkTypedInputState: checkTypedInputState,
 
 
 
 
        inspectSaveButton: inspectSaveButton,
        interceptSave: interceptSave,
        stopIntercept: stopIntercept,
        
        // Internal
        validateCommandSync: validateCommandSync,
        inspectNode: inspectNode,
        create: createDebugger
        
    };

    // ========================================================================
    // 📢 WELCOME
    // ========================================================================
    if (DEBUG) {
        console.log('');
        console.log('%c╔═══════════════════════════════════════════════════════════╗', COLORS.info);
        console.log('%c║ 🛠️  Z2M DEBUG MODE ENABLED                               ║', COLORS.info);
        console.log('%c╚═══════════════════════════════════════════════════════════╝', COLORS.info);
        console.log('');
        console.log('%c💡 Quick start:', COLORS.info, 'Z2MDebug.help()');
        console.log('');
        console.log('[Z2M] Debug system loaded ✔');
    }
    
})(window)