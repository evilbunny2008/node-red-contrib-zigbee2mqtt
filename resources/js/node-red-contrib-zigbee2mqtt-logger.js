/**
 * ============================================================================
 * ZIGBEE2MQTT - EDITOR UTILS (módulo UMD)
 * ============================================================================
 *
 * Localização: /resources/js/node-red-contrib-zigbee2mqtt-utils.js
 *
 * Centraliza a lógica de parsing de `exposes` usada pelo editor:
 *   - Interpretação do campo `access` (bitmask: 1=PUBLISH, 2=SET, 4=GET)
 *   - Achatamento (flatten) da árvore de exposes (features/composites)
 *   - Filtragem de devices por modo do nó: 'in' (leitura) | 'out' (escrita) | 'all'
 *   - Pesquisa de um expose por property
 *   - Geração de rótulos legíveis (formatExposeLabel)
 *
 * LOGGING:
 *   Os logs originais (✅ CAN SET / ❌ READ ONLY / CAN PUBLISH ...) foram mantidos.
 *   Usam automaticamente Z2MDebug.create('Z2M Utils') quando existe (só imprimem
 *   com o debug ativo: Z2MDebug.enable()). Fora do browser (Node/testes) o módulo
 *   fica silencioso, a não ser que seja definido um logger com setLogger().
 *
 * Uso no browser:   Zigbee2MqttEditorUtils.deviceHasCommands(device)
 * Uso em Node/CJS:  const U = require('./node-red-contrib-zigbee2mqtt-utils.js');
 * Uso em AMD:       define(['.../editor-utils'], function (U) { ... });
 *
 * LOGGER NODE-RED (runtime, 4 níveis controlados pela UI):
 *   const Logger = require('../resources/js/node-red-contrib-zigbee2mqtt-logger.js').Logger;
 *   node.logger = Logger.create(node, { prefix: 'Server', getLevel: () => node.debug_level });
 */
(function (root, factory) {
    'use strict';
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Zigbee2MqttEditorUtils = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ========================================================================
    // CONSTANTES
    // ========================================================================

    /** Bits do campo `access` definido pelo Zigbee2MQTT */
    const ACCESS = Object.freeze({
        PUBLISH: 1, // 0b001 - o device publica o valor (leitura)
        SET:     2, // 0b010 - é possível escrever (/set)
        GET:     4  // 0b100 - é possível pedir o valor (/get)
    });

    const MODES = Object.freeze({ IN: 'in', OUT: 'out', ALL: 'all' });

    const DEFAULT_LABEL_OPTIONS = Object.freeze({
        style: 'auto',      // 'auto' | 'description' | 'property'
        maxLength: 48,      // descrições maiores caem para property/name
        includeUnit: true   // acrescenta ", unit" no fim
    });

    // ========================================================================
    // 🪵 LOGGING (compatível com Z2MDebug)
    // ========================================================================

    let customLogger = null;   // definido via setLogger()
    let autoDebugger = null;   // cache de Z2MDebug.create('Z2M Utils')

    /**
     * Resolve o logger a usar, de forma lazy (debug.js pode carregar depois deste módulo):
     *   1. logger definido com setLogger()
     *   2. Z2MDebug.create('Z2M Utils') se o debug.js existir
     *   3. null (silencioso)
     */
    function getDebugger() {
        if (customLogger) return customLogger;
        if (typeof Z2MDebug !== 'undefined' && Z2MDebug && typeof Z2MDebug.create === 'function') {
            if (!autoDebugger) autoDebugger = Z2MDebug.create('Z2M Utils');
            return autoDebugger;
        }
        return null;
    }

    function dlog() {
        const d = getDebugger();
        if (d && typeof d.log === 'function') d.log.apply(d, arguments);
    }

    function dwarn() {
        const d = getDebugger();
        if (d && typeof d.warn === 'function') d.warn.apply(d, arguments);
    }

    // ========================================================================
    // HELPERS INTERNOS
    // ========================================================================

    function toArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function cleanString(value) {
        return (typeof value === 'string') ? value.trim() : '';
    }

    function hasBit(access, bit) {
        return (((Number(access)) || 0) & bit) > 0;
    }

    /**
     * Devolve só a 1ª frase da description e remove o ponto final.
     * Devolve '' se o resultado for vazio ou maior que maxLength.
     */
    function shortDescription(description, maxLength) {
        const text = cleanString(description);
        if (!text) return '';
        const firstSentence = text.split(/\.\s|\r?\n/)[0].replace(/\.\s*$/, '').trim();
        if (!firstSentence || firstSentence.length > maxLength) return '';
        return firstSentence;
    }

    /**
     * Núcleo comum a deviceHasCommands / deviceHasReadableExposes.
     * Procura (nas folhas achatadas) pelo menos 1 expose com property + access
     * que passe em `test`, mantendo os logs originais.
     *
     * @param {Object}  device
     * @param {Function} test   (access) => boolean
     * @param {Object}  ctx     { fn, okLabel, koLabel, verbose }
     *                          verbose=true  -> loga também "device em falta", "sem definition",
     *                                           "sem exposes" e os exposes que NÃO passam (❌)
     *                          verbose=false -> só loga os que passam (✅), como no filtro da lista
     */
    function deviceHasExposeWith(device, test, ctx) {
        if (!device) {
            if (ctx.verbose) dlog('⚠️ [' + ctx.fn + '] No device selected');
            return false;
        }

        if (!('definition' in device) || !device.definition) {
            if (ctx.verbose) dlog('⚠️ [' + ctx.fn + '] No device.definition');
            return false;
        }

        if (!('exposes' in device.definition)) {
            if (ctx.verbose) dlog('⚠️ [' + ctx.fn + '] No device.definition.exposes');
            return false;
        }

        const name = device.friendly_name || device.ieee_address || '?';
        const exposes = Zigbee2MqttEditorUtils.flattenExposes(device.definition.exposes);

        return exposes.some(function (expose) {
            // Verificar propriedade direta
            if ('property' in expose && 'access' in expose) {
                if (test(expose.access)) {
                    dlog('  ✅ [' + name + '][' + expose.property + '] access=' + expose.access + ' → ' + ctx.okLabel);
                    return true;
                }
                if (ctx.verbose) {
                    dlog('  ❌ [' + name + '][' + expose.property + '] access=' + expose.access + ' → ' + ctx.koLabel);
                }
            }
            return false;
        });
    }

    // ========================================================================
    // 📝 LOGGER NODE-RED - 4 níveis controlados pela UI (error | warn | notice | debug)
    // ========================================================================
    //
    // Logger de SISTEMA (conectividade / falhas de sistema), usado pelos nós em runtime
    // através de `node.logger`. É INDEPENDENTE do debug de runtime acima (Z2MDebug /
    // dlog / dwarn), que continua exatamente como estava e NÃO é afetado pelo nível
    // escolhido aqui.
    //
    // O nível escolhido na UI (select "Logger Node-RED": id node-config-input-debug_level
    // no server.html / node-input-debug_level no bridge.html) é o nível MAIS verboso
    // que será mostrado:
    //
    //   error  (0)  só falhas
    //   warn   (1)  erros + avisos
    //   notice (2)  erros + avisos + eventos normais de sistema        [defeito]
    //   debug  (3)  tudo, incluindo detalhe de diagnóstico
    //
    // Uso (Node.js / runtime):
    //   const Logger = require('../resources/js/node-red-contrib-zigbee2mqtt-logger.js').Logger;
    //   node.logger = Logger.create(node, { prefix: 'Server', getLevel: () => node.debug_level });
    //   node.logger.warn('...');
    //   node.logger.throttle('warn', 'chave', 30000, '...');   // no máx. 1x / 30s por chave
    //
    // Correspondência com o logger do Node-RED:
    //   error -> node.error()   warn -> node.warn()   notice -> node.log()   debug -> node.debug()
    // (node.error() é chamado SEM `msg`, por isso nunca dispara nós "catch".)

    const LOG_LEVELS = Object.freeze({ error: 0, warn: 1, notice: 2, debug: 3 });
    const DEFAULT_LOG_LEVEL = 'notice';

    /** Opções na mesma ordem do <select> da UI */
    const LOG_LEVEL_OPTIONS = Object.freeze([
        Object.freeze({ value: 'error',  label: 'Error'   }),
        Object.freeze({ value: 'warn',   label: 'Warning' }),
        Object.freeze({ value: 'notice', label: 'Notice'  }),
        Object.freeze({ value: 'debug',  label: 'Debug'   })
    ]);

    /** true só para os 4 valores exatos usados pela UI */
    function isValidLogLevel(level) {
        return typeof level === 'string' && Object.prototype.hasOwnProperty.call(LOG_LEVELS, level);
    }

    /** Tolerante: aceita 'warning'/'info' como sinónimos; qualquer outra coisa -> defeito */
    function normalizeLogLevel(level) {
        if (typeof level !== 'string') return DEFAULT_LOG_LEVEL;
        const clean = level.trim().toLowerCase();
        if (clean === 'warning') return 'warn';
        if (clean === 'info') return 'notice';
        return isValidLogLevel(clean) ? clean : DEFAULT_LOG_LEVEL;
    }

    function formatLogArgs(args) {
        return Array.prototype.map.call(args, function (a) {
            if (a instanceof Error) return a.message;
            if (a !== null && typeof a === 'object') {
                try { return JSON.stringify(a); } catch (e) { return String(a); }
            }
            return String(a);
        }).join(' ');
    }

    /**
     * Cria um logger ligado a um nó do Node-RED.
     *
     * @param {Object} node                nó Node-RED (usa node.error/warn/log/debug)
     * @param {Object} [options]
     * @param {string}   [options.prefix]    ex.: 'Server' -> "[Server] mensagem"
     * @param {string}   [options.level]     nível fixo (se não houver getLevel)
     * @param {Function} [options.getLevel]  função chamada a CADA mensagem -> nível dinâmico
     *                                       (assim a mudança na UI aplica-se sem reiniciar)
     */
    function createLogger(node, options) {
        const opts = options || {};
        const prefix = opts.prefix ? '[' + opts.prefix + '] ' : '';
        const getLevel = (typeof opts.getLevel === 'function') ? opts.getLevel : null;
        let fixedLevel = normalizeLogLevel(opts.level);
        const lastEmit = Object.create(null);

        function currentLevel() {
            if (!getLevel) return fixedLevel;
            try { return normalizeLogLevel(getLevel()); } catch (e) { return DEFAULT_LOG_LEVEL; }
        }

        /** Filtro: a mensagem passa se o seu nível <= nível escolhido na UI */
        function enabled(name) {
            return LOG_LEVELS[name] <= LOG_LEVELS[currentLevel()];
        }

        function sink(name, text) {
            if (!node) return;
            switch (name) {
                case 'error':
                    if (typeof node.error === 'function') node.error(text);
                    break;
                case 'warn':
                    if (typeof node.warn === 'function') node.warn(text);
                    break;
                case 'notice':
                    if (typeof node.log === 'function') node.log(text);
                    break;
                default: // debug
                    if (typeof node.debug === 'function') node.debug(text);
                    else if (typeof node.log === 'function') node.log(text);
            }
        }

        function emit(name, args) {
            if (!enabled(name)) return false;
            sink(name, prefix + formatLogArgs(args));
            return true;
        }

        return {
            error:  function () { return emit('error',  arguments); },
            warn:   function () { return emit('warn',   arguments); },
            notice: function () { return emit('notice', arguments); },
            info:   function () { return emit('notice', arguments); },   // alias de notice
            debug:  function () { return emit('debug',  arguments); },

            /**
             * Como emit(), mas no máximo 1 vez por `intervalMs` para a mesma `key`.
             * Essencial em falhas de ligação (o cliente MQTT tenta reconectar a cada 5s).
             * throttle('warn', 'mqtt-close', 30000, 'mensagem', ...)
             */
            throttle: function (name, key, intervalMs) {
                const level = isValidLogLevel(name) ? name : 'notice';
                if (!enabled(level)) return false;
                const now = Date.now();
                if (lastEmit[key] && (now - lastEmit[key]) < intervalMs) return false;
                lastEmit[key] = now;
                return emit(level, Array.prototype.slice.call(arguments, 3));
            },

            isEnabled: enabled,
            getLevel: currentLevel,
            /** Só tem efeito quando o logger foi criado sem getLevel */
            setLevel: function (level) { fixedLevel = normalizeLogLevel(level); }
        };
    }

    const Logger = Object.freeze({
        LEVELS: LOG_LEVELS,
        DEFAULT_LEVEL: DEFAULT_LOG_LEVEL,
        OPTIONS: LOG_LEVEL_OPTIONS,
        isValidLevel: isValidLogLevel,
        normalizeLevel: normalizeLogLevel,
        create: createLogger
    });

    // ========================================================================
    // API PÚBLICA
    // ========================================================================

    const Zigbee2MqttEditorUtils = {

        VERSION: '1.1.0',
        ACCESS: ACCESS,
        MODES: MODES,

        // Logger Node-RED (4 níveis: error | warn | notice | debug)
        // -> ver secção "LOGGER NODE-RED" acima
        LOG_LEVELS: LOG_LEVELS,
        Logger: Logger,

        /**
         * Define um logger opcional.
         *   setLogger(console.log)                -> função única (usada em log e warn)
         *   setLogger({ log: fn, warn: fn })      -> objeto no formato Z2MDebug.create()
         *   setLogger(null)                       -> volta ao comportamento automático
         */
        setLogger: function (logger) {
            if (typeof logger === 'function') {
                customLogger = { log: logger, warn: logger };
            } else if (logger && typeof logger.log === 'function') {
                customLogger = logger;
            } else {
                customLogger = null;
            }
        },

        // --------------------------------------------------------------------
        // 🔐 ACCESS (bitmask)
        // --------------------------------------------------------------------

        /**
         * Verifica se access permite SET (escrita) - bit 2
         * @param {number} access - Valor do campo access (bitwise)
         * @returns {boolean}
         */
        hasSetAccess: function (access) {
            // Verificar se o bit SET (2) está ativo usando bitwise AND
            // Se (access & 2) > 0, então tem permissão de escrita
            return hasBit(access, ACCESS.SET);
        },

        /**
         * Verifica se access permite PUBLISH (leitura) - bit 1
         * @param {number} access - Valor do campo access (bitwise)
         * @returns {boolean}
         */
        hasPublishAccess: function (access) {
            // Verificar se o bit PUBLISH (1) está ativo usando bitwise AND
            // Se (access & 1) > 0, então device publica dados (leitura)
            return hasBit(access, ACCESS.PUBLISH);
        },

        /**
         * Verifica se access permite GET (pedir valor) - bit 4
         * @param {number} access - Valor do campo access (bitwise)
         * @returns {boolean}
         */
        hasGetAccess: function (access) {
            return hasBit(access, ACCESS.GET);
        },

        // --------------------------------------------------------------------
        // 🧩 EXPOSES
        // --------------------------------------------------------------------

        /** Devolve a lista de exposes do device (ou [] se não existir definição). */
        getDeviceExposes: function (device) {
            return (device && device.definition && Array.isArray(device.definition.exposes))
                ? device.definition.exposes
                : [];
        },

        /**
         * Achata a árvore de exposes.
         * Por defeito devolve apenas as "folhas" (sem `features`), tal como o
         * flatten original do helpers.js:
         *   arr.flatMap(e => e.features ? flatten(e.features) : [e])
         *
         * @param {Array}  exposes
         * @param {Object} [options]
         * @param {boolean} [options.includeContainers=false] inclui também nós com `features`
         *                  (light, switch, cover, composite...) além das folhas
         * @returns {Array}
         */
        flattenExposes: function (exposes, options) {
            const includeContainers = !!(options && options.includeContainers);
            const result = [];

            (function walk(list) {
                toArray(list).forEach(function (expose) {
                    if (!expose || typeof expose !== 'object') return;
                    if (Array.isArray(expose.features)) {
                        if (includeContainers) result.push(expose);
                        walk(expose.features);
                    } else {
                        result.push(expose);
                    }
                });
            })(exposes);

            return result;
        },

        /**
         * Procura um expose pela property (percorre também containers/composites).
         * Substitui as funções locais findExposeByProperty/findExpose do helpers.js.
         * @returns {Object|null}
         */
        findExposeByProperty: function (exposes, property) {
            if (!property) return null;
            const list = toArray(exposes);
            for (let i = 0; i < list.length; i++) {
                const expose = list[i];
                if (!expose || typeof expose !== 'object') continue;
                if (expose.property === property) return expose;
                if (Array.isArray(expose.features)) {
                    const found = Zigbee2MqttEditorUtils.findExposeByProperty(expose.features, property);
                    if (found) return found;
                }
            }
            return null;
        },

        /** Exposes (folhas) com property + SET -> usados pelo node-out */
        getWritableExposes: function (device) {
            const flat = Zigbee2MqttEditorUtils.flattenExposes(Zigbee2MqttEditorUtils.getDeviceExposes(device));
            return flat.filter(function (expose) {
                return 'property' in expose && 'access' in expose && Zigbee2MqttEditorUtils.hasSetAccess(expose.access);
            });
        },

        /** Exposes (folhas) com property + PUBLISH -> usados pelo node-in */
        getReadableExposes: function (device) {
            const flat = Zigbee2MqttEditorUtils.flattenExposes(Zigbee2MqttEditorUtils.getDeviceExposes(device));
            return flat.filter(function (expose) {
                return 'property' in expose && 'access' in expose && Zigbee2MqttEditorUtils.hasPublishAccess(expose.access);
            });
        },

        // --------------------------------------------------------------------
        // 🔍 FILTRAGEM DE DEVICES (node-in vs node-out)
        // --------------------------------------------------------------------

        /**
         * Verifica se um device tem comandos (propriedades com SET).
         * Origem: deviceHasCommands() + deviceHasCommandsForDevice() do helpers.js.
         *
         * @param {Object}  device
         * @param {Object}  [options]
         * @param {boolean} [options.verbose=false]
         *        false -> comportamento do filtro da lista (só loga os ✅ CAN SET)
         *        true  -> comportamento do device selecionado (loga também ❌ READ ONLY
         *                 e os avisos de "No device / No definition / No exposes")
         * @returns {boolean}
         */
        deviceHasCommands: function (device, options) {
            return deviceHasExposeWith(device, Zigbee2MqttEditorUtils.hasSetAccess, {
                fn: 'deviceHasCommands',
                okLabel: 'CAN SET',
                koLabel: 'READ ONLY',
                verbose: !!(options && options.verbose)
            });
        },

        /**
         * Verifica se um device tem exposes legíveis (PUBLISH, bit 1).
         * Origem: deviceHasReadableExposesForDevice() do helpers.js.
         *
         * @param {Object}  device
         * @param {Object}  [options]
         * @param {boolean} [options.verbose=false] ver deviceHasCommands
         * @returns {boolean}
         */
        deviceHasReadableExposes: function (device, options) {
            // Verificar se existe pelo menos 1 expose com PUBLISH (bit 1)
            return deviceHasExposeWith(device, Zigbee2MqttEditorUtils.hasPublishAccess, {
                fn: 'deviceHasReadableExposes',
                okLabel: 'CAN PUBLISH',
                koLabel: 'NOT READABLE',
                verbose: !!(options && options.verbose)
            });
        },

        /**
         * Filtra a lista de devices consoante o modo do nó.
         *  - 'out' : apenas devices com comandos (SET)
         *  - 'in'  : apenas devices com exposes legíveis (PUBLISH)
         *  - 'all' : todos (inclui Coordinator)
         *  - outro : fallback seguro -> todos exceto Coordinator
         *            (o aviso de "modo desconhecido" fica a cargo de quem chama,
         *             ex.: buildDeviceIdInput no helpers.js)
         *
         * @param {Array}  devices
         * @param {string} mode
         * @returns {Array} nova lista (não muta o original)
         */
        filterDevicesByMode: function (devices, mode) {
            const list = toArray(devices);
            switch (mode) {
                case MODES.OUT:
                    return list.filter(function (device) {
                        return Zigbee2MqttEditorUtils.deviceHasCommands(device);
                    });
                case MODES.IN:
                    return list.filter(function (device) {
                        return Zigbee2MqttEditorUtils.deviceHasReadableExposes(device);
                    });
                case MODES.ALL:
                    return list.slice();
                default:
                    return list.filter(function (device) {
                        return device && device.type !== 'Coordinator';
                    });
            }
        },

        // --------------------------------------------------------------------
        // 🏷️ LABELS
        // --------------------------------------------------------------------

        /**
         * Gera um rótulo legível para um expose, com prioridade
         * description -> property -> name.
         *
         * Estilos:
         *  - 'auto' (defeito): "Descrição curta (property), unit"
         *      Se não houver description (ou for demasiado longa) -> "property, unit"
         *      A property fica sempre visível para distinguir multi-gang (state_l1, state_l2...)
         *  - 'description': só a descrição curta (fallback property/name)
         *  - 'property':    só property (fallback name) -> aspeto antigo
         *
         * @param {Object} expose
         * @param {Object} [options] { style, maxLength, includeUnit }
         * @returns {string} '' se não for possível gerar rótulo
         */
        formatExposeLabel: function (expose, options) {
            if (!expose || typeof expose !== 'object') return '';

            const opts = Object.assign({}, DEFAULT_LABEL_OPTIONS, options);
            const id = cleanString(expose.property) || cleanString(expose.name);
            const description = shortDescription(expose.description, opts.maxLength);

            let label;
            if (opts.style === 'property') {
                label = id;
            } else if (opts.style === 'description') {
                label = description || id;
            } else {
                label = (description && id && description.toLowerCase() !== id.toLowerCase())
                    ? description + ' (' + id + ')'
                    : (description || id);
            }

            if (!label) return '';

            const unit = cleanString(expose.unit);
            if (opts.includeUnit && unit) {
                label += ', ' + unit;
            }

            dlog('🏷️ [formatExposeLabel]', expose.property || expose.name, '→', label);
            return label;
        }
    };

    return Zigbee2MqttEditorUtils;
}));
