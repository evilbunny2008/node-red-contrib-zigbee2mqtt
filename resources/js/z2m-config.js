/**
 * ============================================================================
 * ZIGBEE2MQTT - CONFIGURAÇÕES CENTRALIZADAS V2
 * ============================================================================
 * 
 * Localização: /resources/js/z2m-config.js
 * 
 * Este arquivo centraliza todas as configurações de comandos, sliders,
 * padrões regex, etc., facilitando a manutenção e expansão do sistema.
 * 
 * CHANGELOG V2:
 * - ✅ Patterns agora são strings simples (regex adicionado pelas funções)
 * - ✅ Novo: PAYLOAD_DROPLIST e SLIDER_CONFIGS_LIST para dropdown
 * - ✅ Funções helper adaptadas para nova estrutura
 */

(function(window) {
    'use strict';
    // Cache para regex compilados
    const REGEX_CACHE = {};

    // ============================================================================
    // 🌍 I18N - texto inglês (fallback) -> chave em nodes/locales/<idioma>/server.json
    // Os dados abaixo mantêm o inglês; a tradução é aplicada no momento do uso (tr()).
    // ============================================================================
    const LABEL_KEYS = {
        // composite
        'color (JSON/xy)': 'config.composite.color', 'color_rgb (r,g,b)': 'config.composite.color_rgb',
        'color_hex (#RRGGBB)': 'config.composite.color_hex', 'color_xy (x,y)': 'config.composite.color_xy',
        'color_hsb (h,s,b)': 'config.composite.color_hsb', 'color_hsv (h,s,v)': 'config.composite.color_hsv',
        'color_hue (h)': 'config.composite.color_hue', 'color_saturation (s)': 'config.composite.color_saturation',
        // cores
        '🔴 Red': 'config.colors.red', '🟢 Green': 'config.colors.green', '🔵 Blue': 'config.colors.blue',
        '🟡 Yellow': 'config.colors.yellow', '🟠 Orange': 'config.colors.orange', '🟣 Purple': 'config.colors.purple',
        '⚪ White': 'config.colors.white', '⚪ White (D65)': 'config.colors.white_d65',
        // droplists
        'Coolest (6535K)': 'config.payload.color_temp.coolest', 'Cool (4000K)': 'config.payload.color_temp.cool',
        'Neutral (2857K)': 'config.payload.color_temp.neutral', 'Warm (2203K)': 'config.payload.color_temp.warm',
        'Warmest (2000K)': 'config.payload.color_temp.warmest',
        'Off (0%)': 'config.payload.brightness.off', 'Low (25%)': 'config.payload.brightness.low',
        'Medium (50%)': 'config.payload.brightness.medium', 'High (75%)': 'config.payload.brightness.high',
        'Max (100%)': 'config.payload.brightness.max',
        'Closed (0%)': 'config.payload.position.closed', 'Quarter (25%)': 'config.payload.position.quarter',
        'Half (50%)': 'config.payload.position.half', 'Three Quarters (75%)': 'config.payload.position.three_quarters',
        'Open (100%)': 'config.payload.position.open',
        '1 minute': 'config.payload.countdown.m1', '5 minutes': 'config.payload.countdown.m5',
        '10 minutes': 'config.payload.countdown.m10', '30 minutes': 'config.payload.countdown.m30',
        '1 hour': 'config.payload.countdown.h1',
        'Very Low (0)': 'config.payload.sensitivity.very_low', 'Low (3)': 'config.payload.sensitivity.low',
        'Medium (5)': 'config.payload.sensitivity.medium', 'High (7)': 'config.payload.sensitivity.high',
        'Very High (9)': 'config.payload.sensitivity.very_high',
        '🔴 Red (0°)': 'config.payload.color_hue.red', '🟢 Green (120°)': 'config.payload.color_hue.green',
        '🔵 Blue (240°)': 'config.payload.color_hue.blue', '🟡 Yellow (60°)': 'config.payload.color_hue.yellow',
        '🟣 Magenta (300°)': 'config.payload.color_hue.magenta',
        '🎨 Full Saturation (100%)': 'config.payload.color_saturation.full',
        '🔉 Half Saturation (50%)': 'config.payload.color_saturation.half',
        '⚪ No Saturation (White)': 'config.payload.color_saturation.none',
        // sliders
        'Brightness': 'config.slider.brightness', 'Min Brightness': 'config.slider.min_brightness',
        'Max Brightness': 'config.slider.max_brightness', 'Off': 'config.slider.off', 'Max': 'config.slider.max',
        'Color Temp': 'config.slider.color_temp', '150 (Cool)': 'config.slider.cool_150', '500 (Warm)': 'config.slider.warm_500',
        'CIE X': 'config.slider.cie_x', 'CIE Y': 'config.slider.cie_y', 'Position': 'config.slider.position',
        'Closed': 'config.slider.closed', 'Open': 'config.slider.open', 'Tilt': 'config.slider.tilt',
        'Timer': 'config.slider.timer', 'Transition': 'config.slider.transition', 'Hue': 'config.slider.hue',
        'Saturation': 'config.slider.saturation', 'Value': 'config.slider.value', 'White': 'config.slider.white',
        'Color': 'config.slider.color', 'Red': 'config.slider.red', 'Green': 'config.slider.green',
        'Blue': 'config.slider.blue', 'Range': 'config.slider.range', 'Sensitivity': 'config.slider.sensitivity',
        'Low': 'config.slider.low', 'Medium': 'config.slider.medium', 'High': 'config.slider.high',
        'Pick Color': 'config.slider.pick_color'
    };

    /** Traduz um texto de dados (se houver chave e o Z2MI18n já estiver carregado); senão devolve o original */
    function tr(text) {
        const key = LABEL_KEYS[text];
        if (!key || !window.Z2MI18n) return text;
        return window.Z2MI18n.t('server:' + key, null, text);
    }

    /** Traduz label/minLabel/maxLabel de uma configuração de slider (já clonada) */
    function localizeCfg(c) {
        if (c.label) c.label = tr(c.label);
        (c.parts || []).forEach(function (p) {
            if (p.label) p.label = tr(p.label);
            if (p.minLabel) p.minLabel = tr(p.minLabel);
            if (p.maxLabel) p.maxLabel = tr(p.maxLabel);
        });
        return c;
    }
 
    // ============================================================================
    // 🔢 NUMERIC PATTERNS - Comandos que aceitam input numérico (e Sliders)
    // ============================================================================
    const NUMERIC_COMMAND_PATTERNS = [
        'brightness',
        'min_brightness',
        'max_brightness',
        'color_temp',
        'color_rgb',
        'color',
        'color_hex',
        'color_xy',
        'color_hsb',
        'color_hsv',
        'color_hue',
        'color_saturation',
        'position',
        'tilt',
        'lift',
        'x',
        'y',
        'countdown',
        'inching_time',
        'transition',
        '{any}_detection_min',
        '{any}_detection_max',
        '{any}_sensitivity',
        '{any}_delay', 
        '{any}_timeout',
        "none_delay_time"
    ];
    // ============================================================================
    // 📦 COMPOSITE EXPANSIONS - Expandir comandos compostos (ex: color)
    // ============================================================================
    const COMPOSITE_EXPANSIONS = {
        'color': [
            { value: 'color', label: 'color (JSON/xy)' },
            { value: 'color_rgb', label: 'color_rgb (r,g,b)' },
            { value: 'color_hex', label: 'color_hex (#RRGGBB)' },
            { value: 'color_xy', label: 'color_xy (x,y)' },
            { value: 'color_hsb', label: 'color_hsb (h,s,b)' },
            { value: 'color_hsv', label: 'color_hsv (h,s,v)' },
            { value: 'color_hue', label: 'color_hue (h)' },
            { value: 'color_saturation', label: 'color_saturation (s)' }
        ]
        // Podes adicionar outros composites aqui no futuro se necessário
    };
    // ============================================================================
    // 🎛️ COMPLEX INPUT CONFIGS - Definição Centralizada de UI (Sliders/Pickers)
    // ============================================================================
    const COMPLEX_INPUTS = {
    // --- Single Sliders ---
        'brightness': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 0,
                        max: 255,
                        step: 1,
                        label: 'Brightness',
                        minLabel: 'Off',
                        maxLabel: 'Max',
                        unit: '',
                        gradient: 'linear-gradient(to right, #000, #fff)' 
                    }]
        },
        'min_brightness': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 0,
                        max: 255,
                        step: 1,
                        label: 'Min Brightness',
                        minLabel: '0',
                        maxLabel: '255',
                        unit: '',
                        gradient: 'linear-gradient(to right, #000, #fff)' 
                    }]
        },
        'max_brightness': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 0,
                        max: 255,
                        step: 1,
                        label: 'Max Brightness',
                        minLabel: '0',
                        maxLabel: '255',
                        unit: '',
                        gradient: 'linear-gradient(to right, #000, #fff)' 
                    }]
        },
        'color_temp': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 150,
                        max: 500,
                        step: 1,
                        label: 'Color Temp',
                        minLabel: '150 (Cool)',
                        maxLabel: '500 (Warm)',
                        unit: 'mired',
                        gradient: 'linear-gradient(to right, #E0F7FF 0%, #FFFFFF 25%, #FFE5CC 50%, #FFD699 75%, #FFB366 100%)' 
                    }]
        },
        'color': {
            type: 'multi-slider',
            separator: ',',
            parts:  [
                { 
                    id: 'x',
                    min: 0,
                    max: 1,
                    step: 0.001,
                    label: 'CIE X',
                    minLabel: '0.0',
                    maxLabel: '1.0',
                    unit: '',
                    gradient: 'linear-gradient(to right, #0000ff, #ffffff, #ff0000)' 
                },
                { 
                    id: 'y',
                    min: 0, 
                    max: 1, 
                    step: 0.001, 
                    label: 'CIE Y', 
                    minLabel: '0.0', 
                    maxLabel: '1.0', 
                    unit: '', 
                    gradient: 'linear-gradient(to right, #ff00ff, #ffffff, #00ff00)' 
                }
            ]
        },
    // --- Coordenadas Individuais (CIE) ---
        'x': {
            type: 'slider',
            parts: [{ 
                id: 'x', min: 0, max: 1, step: 0.001, 
                label: 'CIE X', minLabel: '0.0', maxLabel: '1.0', unit: '',
                gradient: 'linear-gradient(to right, #0000ff, #ffffff, #ff0000)' 
            }]
        },
        'y': {
            type: 'slider',
            parts: [{ 
                id: 'y', min: 0, max: 1, step: 0.001, 
                label: 'CIE Y', minLabel: '0.0', maxLabel: '1.0', unit: '',
                gradient: 'linear-gradient(to right, #000000, #ffffff, #00ff00)' 
            }]
        },
    // --- Single Sliders (Motores/Estores) ---
        'position': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 0,
                        max: 100,
                        step: 1,
                        label: 'Position',
                        minLabel: 'Closed',
                        maxLabel: 'Open',
                        unit: '%',
                        gradient: 'linear-gradient(to right, #4CAF50 0%, #FFC107 50%, #F44336 100%)' 
                    }]
        },
        'tilt': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 0,
                        max: 100,
                        step: 1,
                        label: 'Tilt',
                        minLabel: '0',
                        maxLabel: '100',
                        unit: '%',
                        gradient: 'linear-gradient(to right, #ddd, #555)' 
                    }]
        },
    // --- Timers ---
        'countdown': {
            type: 'slider',
            parts: [{
                        id: 't',
                        min: 0,
                        max: 43200,
                        step: 10,
                        label: 'Timer',
                        minLabel: '0s',
                        maxLabel: '12h',
                        unit: 's',
                        gradient: 'linear-gradient(to right, #eee, #aaa)' 
                    }]
        },
        'transition': {
            type: 'slider',
            parts: [{ 
                id: 't', min: 0, max: 60, step: 0.1, 
                label: 'Transition', minLabel: '0s', maxLabel: '60s', unit: 's',
                gradient: 'linear-gradient(to right, #eee, #aaa)' 
            }]
        },
    // --- Color Sliders (Single) ---
        'color_hue': {
            type: 'slider',
            parts: [{
                        id: 'h',
                        min: 0,
                        max: 360,
                        step: 1,
                        label: 'Hue',
                        minLabel: '0°',
                        maxLabel: '360°',
                        unit: '°',
                        gradient: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' 
                    }]
        },
        'color_saturation': {
            type: 'slider',
            parts: [{
                        id: 's',
                        min: 0,
                        max: 100,
                        step: 1,
                        label: 'Saturation',
                        minLabel: 'White',
                        maxLabel: 'Color',
                        unit: '%',
                        gradient: 'linear-gradient(to right, #fff, #f00)' 
                    }]
        },
    // --- Multi Sliders ---
        'color_rgb': {
            type: 'multi-slider',
            separator: ',',
            preview: 'rgb',
            parts: [
                {
                    id: 'r',
                    min: 0,
                    max: 255,
                    step: 1,
                    label: 'Red',
                    minLabel: '0',
                    maxLabel: '255',
                    unit: '',
                    gradient: 'linear-gradient(to right, #000, #f00)'
                },
                {
                    id: 'g',
                    min: 0,
                    max: 255,
                    step: 1,
                    label: 'Green',
                    minLabel: '0',
                    maxLabel: '255',
                    unit: '',
                    gradient: 'linear-gradient(to right, #000, #0f0)' 
                },
                {
                    id: 'b',
                    min: 0,
                    max: 255,
                    step: 1,
                    label: 'Blue',
                    minLabel: '0',
                    maxLabel: '255',
                    unit: '',
                    gradient: 'linear-gradient(to right, #000, #00f)' 
                }
                    ]
                    },
        'color_xy': {
            type: 'multi-slider',
            separator: ',',
            parts: [
                {
                    id: 'x',
                    min: 0,
                    max: 1,
                    step: 0.001,
                    label: 'CIE X',
                    minLabel: '0.0',
                    maxLabel: '1.0',
                    unit: '',
                    gradient: 'linear-gradient(to right, #0000ff, #ffffff, #ff0000)'
                },
                {
                    id: 'y',
                    min: 0,
                    max: 1,
                    step: 0.001,
                    label: 'CIE Y',
                    minLabel: '0.0',
                    maxLabel: '1.0',
                    unit: '',
                    gradient: 'linear-gradient(to right, #000000, #ffffff, #00ff00)'
                }
            ]
        },
        'color_hsb': {
            type: 'multi-slider',
            separator: ',',
            preview: 'hsb',
            parts: [
                {
                    id: 'h',
                    min: 0,
                    max: 360,
                    step: 1,
                    label: 'Hue',
                    minLabel: '0',
                    maxLabel: '360',
                    unit: '°',
                    gradient: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' 
                },
                {
                    id: 's',
                    min: 0,
                    max: 100,
                    step: 1,
                    label: 'Saturation',
                    minLabel: '0',
                    maxLabel: '100',
                    unit: '%',
                    gradient: 'linear-gradient(to right, #fff, #f00)' 
                },
                {
                    id: 'b',
                    min: 0,
                    max: 100,
                    step: 1,
                    label: 'Brightness',
                    minLabel: '0',
                    maxLabel: '100',
                    unit: '%',
                    gradient: 'linear-gradient(to right, #000, #fff)' 
                }
            ]
        },
        'color_hsv': {
            type: 'multi-slider',
            separator: ',',
            preview: 'hsb',
            parts: [
                {
                    id: 'h',
                    min: 0,
                    max: 360,
                    step: 1,
                    label: 'Hue',
                    minLabel: '0',
                    maxLabel: '360',
                    unit: '°',
                    gradient: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' 
                },
                {
                    id: 's',
                    min: 0,
                    max: 100,
                    step: 1,
                    label: 'Saturation',
                    minLabel: '0',
                    maxLabel: '100',
                    unit: '%',
                    gradient: 'linear-gradient(to right, #fff, #f00)' 
                },
                {
                    id: 'v',
                    min: 0,
                    max: 100,
                    step: 1,
                    label: 'Value',
                    minLabel: '0',
                    maxLabel: '100',
                    unit: '%',
                    gradient: 'linear-gradient(to right, #000, #fff)' 
                }
            ]
        },
    // --- Color Picker ---
        'color_hex': {
                        type: 'color-picker',
                       
                        label: 'Pick Color'
                    },
    // --- Templates Genéricos ---
        '_tpl_detection': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 0,
                        max: 600,
                        step: 10,
                        label: 'Range',
                        minLabel: '0cm',
                        maxLabel: '600cm',
                        unit: 'cm',
                        gradient: 'linear-gradient(to right, #4CAF50, #F44336)' 
                    }]
        },
        '_tpl_sensitivity': {
            type: 'slider',
            parts: [{
                        id: 'val',
                        min: 0,
                        max: 9,
                        step: 1,
                        label: 'Sensitivity',
                        minLabel: 'Low',
                        maxLabel: 'High',
                        unit: '',
                        gradient: 'linear-gradient(to right, #4CAF50, #F44336)' 
                    }]
        },
        '_tpl_generic': {
            type: 'slider',
            parts: [{ 
                        id: 'val',
                        min: 0, 
                        max: 100, 
                        step: 1, 
                        label: 'Value',
                        minLabel: '0',
                        maxLabel: '100', 
                        unit: '',
                        gradient: 'linear-gradient(to right, #ddd, #999)' 
            }]
        }
    };
    // ============================================================================
    // 📋 PAYLOAD DROPDOWN - Opções para Dropdown do Payload (TypedInput)
    // ============================================================================
    const PAYLOAD_DROPLIST = {
        'color_temp': [
            { value: '153', label: 'Coolest (6535K)' },
            { value: '250', label: 'Cool (4000K)' },
            { value: '350', label: 'Neutral (2857K)' },
            { value: '454', label: 'Warm (2203K)' },
            { value: '500', label: 'Warmest (2000K)' }
        ],
        'brightness': [
            { value: '0', label: 'Off (0%)' },
            { value: '64', label: 'Low (25%)' },
            { value: '128', label: 'Medium (50%)' },
            { value: '191', label: 'High (75%)' },
            { value: '255', label: 'Max (100%)' }
        ],
        'position': [
            { value: '0', label: 'Closed (0%)' },
            { value: '25', label: 'Quarter (25%)' },
            { value: '50', label: 'Half (50%)' },
            { value: '75', label: 'Three Quarters (75%)' },
            { value: '100', label: 'Open (100%)' }
        ],
        'countdown': [
            { value: '60', label: '1 minute' },
            { value: '300', label: '5 minutes' },
            { value: '600', label: '10 minutes' },
            { value: '1800', label: '30 minutes' },
            { value: '3600', label: '1 hour' }
        ],
        'sensitivity': [
            { value: '0', label: 'Very Low (0)' },
            { value: '3', label: 'Low (3)' },
            { value: '5', label: 'Medium (5)' },
            { value: '7', label: 'High (7)' },
            { value: '9', label: 'Very High (9)' }
        ],
        'color': [
            { value: '{"x":0.701,"y":0.299}', label: '🔴 Red' },
            { value: '{"x":0.3,"y":0.6}', label: '🟢 Green' },
            { value: '{"x":0.136,"y":0.04}', label: '🔵 Blue' },
            { value: '{"x":0.432,"y":0.499}', label: '🟡 Yellow' },
            { value: '{"x":0.312,"y":0.329}', label: '⚪ White (D65)' }
        ],
        'color_rgb': [
            { value: '255,0,0', label: '🔴 Red' },
            { value: '0,255,0', label: '🟢 Green' },
            { value: '0,0,255', label: '🔵 Blue' },
            { value: '255,255,0', label: '🟡 Yellow' },
            { value: '255,165,0', label: '🟠 Orange' },
            { value: '128,0,128', label: '🟣 Purple' },
            { value: '255,255,255', label: '⚪ White' }
        ],
        'color_hex': [
            { value: '#FF0000', label: '🔴 Red' },
            { value: '#00FF00', label: '🟢 Green' },
            { value: '#0000FF', label: '🔵 Blue' },
            { value: '#FFFF00', label: '🟡 Yellow' },
            { value: '#FFA500', label: '🟠 Orange' },
            { value: '#800080', label: '🟣 Purple' },
            { value: '#FFFFFF', label: '⚪ White' }
        ],
        'color_xy': [
            { value: '0.701,0.299', label: '🔴 Red' },
            { value: '0.3,0.6', label: '🟢 Green' },
            { value: '0.136,0.04', label: '🔵 Blue' },
            { value: '0.432,0.499', label: '🟡 Yellow' },
            { value: '0.312,0.329', label: '⚪ White (D65)' }
        ],
        'color_hsb': [
            { value: '0,100,100', label: '🔴 Red' },
            { value: '120,100,100', label: '🟢 Green' },
            { value: '240,100,100', label: '🔵 Blue' },
            { value: '60,100,100', label: '🟡 Yellow' },
            { value: '0,0,100', label: '⚪ White' }
        ],
        'color_hsv': [
            { value: '0,100,100', label: '🔴 Red' },
            { value: '120,100,100', label: '🟢 Green' },
            { value: '240,100,100', label: '🔵 Blue' },
            { value: '60,100,100', label: '🟡 Yellow' },
            { value: '0,0,100', label: '⚪ White' }
        ],
        'color_hue': [
            { value: '0', label: '🔴 Red (0°)' },
            { value: '120', label: '🟢 Green (120°)' },
            { value: '240', label: '🔵 Blue (240°)' },
            { value: '60', label: '🟡 Yellow (60°)' },
            { value: '300', label: '🟣 Magenta (300°)' }
        ],
        'color_saturation': [
            { value: '100', label: '🎨 Full Saturation (100%)' },
            { value: '50', label: '🔉 Half Saturation (50%)' },
            { value: '0', label: '⚪ No Saturation (White)' }
        ]
    };
    // ============================================================================
    // 🔄 TOGGLEABLE COMMANDS
    // ============================================================================
    const TOGGLEABLE_PATTERNS = [
        'state',
        'state_l{n}',           // state_l1, state_l2, etc.
        'state_{side}',         // state_left, state_right, state_center
        'window_detection',
        'lock'
    ];
    // ============================================================================
    // 🚫 NON-TOGGLEABLE COMMANDS
    // ============================================================================
    const NON_TOGGLEABLE_PATTERNS = [
        'backlight',
        'alarm',
        'tamper',
        'occupancy',
        'presence',
        'contact',
        'water_leak',
        'battery_low',
        'ac_status',
        'led_disabled',
        'power_outage',
        'child_lock',
        'auto_{any}',           // auto_lock, auto_off, etc.
        '{any}_mode',           // eco_mode, comfort_mode, etc.
        'do_not_disturb',
        'indicator_mode',
        'power_outage_memory',
        'auto_off', 
        'reverse_direction',
        'invert_cover'
    ];
    // ============================================================================
    // 🎯 COMMAND GROUPS
    // ============================================================================
    const COMMAND_GROUPS = {
        lighting:   [               // Lighting
                    'brightness', 
                    'color_temp', 
                    'color', 
                    'color_rgb', 
                    'color_hex', 
                    'color_hsb', 
                    'color_hue', 
                    'color_saturation'
                    ],
        cover:  [                   // Cover/Blinds
                    'position', 
                    'state', 
                    'tilt'
                ],
        lock:   [                   // Lock
                    'lock',
                    'state'
                ],
        detection: [                // Detection/Motion
                    'occupancy', 
                    'presence', 
                    'move_sensitivity'
                    ],
        timer:  [                   // Timer/Countdown
                    'countdown'
                ],
        scene:  [                   // Scene
                    'scene',
                    'scene_recall'
                ]
    };
    // ============================================================================
    // 🔗 DETECTION PAIRS - Pares Min/Max de Detecção
    // ============================================================================
    const DETECTION_PAIRS = {
        'move_detection_min': {
            max: 'move_detection_max',
            unit: 'cm',
            defaultMax: 600
        },
        'move_detection_max': {
            min: 'move_detection_min',
            unit: 'cm',
            defaultMin: 0
        },
        'small_move_detection_min': {
            max: 'small_move_detection_max',
            unit: 'cm',
            defaultMax: 600
        },
        'small_move_detection_max': {
            min: 'small_move_detection_min',
            unit: 'cm',
            defaultMin: 0
        },
        'breath_detection_min': {
            max: 'breath_detection_max',
            unit: 'cm',
            defaultMax: 600
        },
        'breath_detection_max': {
            min: 'breath_detection_min',
            unit: 'cm',
            defaultMin: 0
        },
        'min_brightness': {
            max: 'max_brightness',
            unit: '',
            defaultMax: 255
        },
        'max_brightness': {
            min: 'min_brightness',
            unit: '',
            defaultMin: 0
        }
    };
    // ============================================================================
    // 🛠️ HELPER FUNCTIONS
    // ============================================================================
    /**
     * Converte pattern string para regex
     * @param {string} pattern - Pattern string ('state', 'state_l{n}', etc.)
     * @returns {RegExp}
     */
    function patternToRegex(pattern) {              // Converte pattern string para regex
        if (REGEX_CACHE[pattern]) 
            return REGEX_CACHE[pattern];
        
        // Otimização: Evitar replace em cadeia se não houver placeholders
        if (!pattern.includes('{')) {
             const regex = new RegExp(`^${pattern}$`, 'i');
             REGEX_CACHE[pattern] = regex;
             return regex;
        }
        
        let regexStr = pattern
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\\{n\\\}/g, '\\d+')
            .replace(/\\\{any\\\}/g, '.+')
            .replace(/\\\{side\\\}/g, '(left|right|center)');
 
        // Add start/end anchors only if not present to avoid double anchoring
        if (!regexStr.startsWith('^')) 
            regexStr = '^' + regexStr;
        if (!regexStr.endsWith('$')) 
            regexStr = regexStr + '$';
 
        const regex = new RegExp(regexStr, 'i');
        REGEX_CACHE[pattern] = regex;
        return regex;
    }
    /**
     * Verifica se comando match um pattern
     * @param {string} command - Comando a verificar
     * @param {string} pattern - Pattern string
     * @returns {boolean}
     */
    function matchesPattern(command, pattern) {     // Verifica se comando match um pattern
        if (!command || !pattern) return false;
        const regex = patternToRegex(pattern);
        return regex.test(command);
    }
    /**
     * Verifica se um comando é toggleable (aceita TOGGLE)
     * @param {string} command - Nome do comando
     * @returns {boolean}
     */
    function isToggleable(command) {                // Verifica se um comando é toggleable
        if (!command) return false;

        // Verificar se está na lista de NON-toggleable primeiro
        for (let pattern of NON_TOGGLEABLE_PATTERNS) {
            if (matchesPattern(command, pattern)) {
                return false;
            }
        }

        // Verificar se está na lista de toggleable
        for (let pattern of TOGGLEABLE_PATTERNS) {
            if (matchesPattern(command, pattern)) {
                return true;
            }
        }

        return false;
    }
    /**
     * Verifica se um comando aceita valores numéricos
     * @param {string} command - Nome do comando
     * @returns {boolean}
     */
    function isNumericCommand(command) {            // Verifica se um comando aceita valores numéricos
        if (!command) return false;
        const cmdLower = command.toLowerCase();
        // Limpa apenas os sufixos de instância (_l1, _1, _left) para a comparação base
        const baseName = cmdLower.replace(/(_l\d+|_?\d+|_(left|right|center|top|bottom))$/, '');
 
        for (let pattern of NUMERIC_COMMAND_PATTERNS) {
            // Verifica match total (ex: move_detection_min) OU match na raiz (ex: countdown_l1 -> countdown)
            if (matchesPattern(cmdLower, pattern) || matchesPattern(baseName, pattern)) {
                return true;
            }
        }
        return false;
    }
    /**
     * Obtém opções de dropdown para um comando
     * @param {string} command - Nome do comando
     * @returns {Array|null} - Array de opções ou null
     */
    function getPayloadDroplist(command) {          // Obtém opções de dropdown para um comando
        if (!command) return null;
        
        const cmdLower = command.toLowerCase();
        
        // Busca exata
        if (PAYLOAD_DROPLIST[cmdLower]) {
            return PAYLOAD_DROPLIST[cmdLower].map(i => Object.assign({}, i, { label: tr(i.label) }));
        }
        
        // Busca por padrão
        // Sensitivity variants
        if (/_sensitivity$/i.test(cmdLower)) {
            return PAYLOAD_DROPLIST.sensitivity.map(i => Object.assign({}, i, { label: tr(i.label) }));
        }
        
        return null;
    }
    /**
     * Obtém o par min/max de um comando de detecção
     * @param {string} command - Nome do comando
     * @returns {Object|null} - Info do par ou null
     */
    function getDetectionPair(command) {            // Obtém o par min/max de um comando de detecção
        if (!command) return null;
        return DETECTION_PAIRS[command.toLowerCase()] || null;
    }
    /**
     * Obtém grupo de um comando
     * @param {string} command - Nome do comando
     * @returns {string|null} - Nome do grupo ou null
     */
    function getCommandGroup(command) {             // Obtém grupo de um comando
        if (!command) return null;

        const cmdLower = command.toLowerCase();

        for (let [groupName, commands] of Object.entries(COMMAND_GROUPS)) {
            if (commands.includes(cmdLower)) {
                return groupName;
            }
        }
        return null;
    }
    /**
     * Formata segundos para formato legível (1h 30m 45s)
     * @param {number} seconds - Segundos
     * @returns {string}
     */
    function formatTime(seconds) {                  // Formata segundos para formato legível (1h 30m 45s)
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        let parts = [];
        if (hours > 0) parts.push(hours + 'h');
        if (minutes > 0) parts.push(minutes + 'm');
        if (secs > 0 || parts.length === 0) parts.push(secs + 's');

        return parts.join(' ');
    }
    /**
     * Formata valor do slider baseado no comando
     * @param {string} command - Nome do comando
     * @param {number} value - Valor do slider
     * @param {Object} sliderAttrs - Atributos do slider (min, max)
     * @returns {string}
     */
    function formatSliderValue(command, value, sliderAttrs = {}) {  // Formata valor do slider baseado no comando
        if (!command) return String(value);

        const cmdLower = command.toLowerCase();

        // Color Temperature: mired + Kelvin
        if (cmdLower.includes('color_temp')) {
            const kelvin = Math.round(1000000 / value);
            return `${value} mired (${kelvin}K)`;
        }

        // X/Y: apenas valor decimal
        if (cmdLower === 'x' || cmdLower === 'y') {
            return parseFloat(value).toFixed(3);
        }

        // Detection: cm + metros
        if (cmdLower.match(/(move|small_move|breath)_detection_(min|max)/)) {
            const meters = (value / 100).toFixed(2);
            return `${value} cm (${meters} m)`;
        }

        // Sensitivity: valor + percentagem + label
        if (cmdLower.includes('_sensitivity')) {
            const min = parseInt(sliderAttrs.min) || 0;
            const max = parseInt(sliderAttrs.max) || 9;
            const percentage = Math.round(((value - min) / (max - min)) * 100);

            let label = tr('Low');
            if (percentage > 66) label = tr('High');
            else if (percentage > 33) label = tr('Medium');

            return `${value} (${label} - ${percentage}%)`;
        }

        // Countdown: segundos + tempo formatado
        if (cmdLower.includes('countdown')) {
            return `${value}s (${formatTime(value)})`;
        }

        // Brightness: valor + percentagem
        if (cmdLower.includes('brightness')) {
            const percentage = Math.round((value / 255) * 100);
            return `${value} (${percentage}%)`;
        }

        // Default: apenas o valor
        return String(value);
    }
    /**
     * Obtém comandos virtuais para uma propriedade composite
     * @param {string} property - Nome da propriedade (ex: 'color')
     * @returns {Array|null} - Array de objetos {value, label} ou null
     */
    function getCompositeExpansions(property) {             // Obtém comandos virtuais para uma propriedade composite
        if (!property) return null;
        const list = COMPOSITE_EXPANSIONS[property.toLowerCase()];
        return list ? list.map(i => Object.assign({}, i, { label: tr(i.label) })) : null;
    }

    function getComplexInputConfig(command) {
            if (!command) return null;
            const cmdLower = command.toLowerCase();
            const baseName = cmdLower.replace(/(_l\d+|_?\d+|_(left|right|center|top|bottom))$/, '');
            
            // 1. Validar se deve ter UI (Numérico ou Config Direta como color_hex)
            const hasDirectConfig = !!(COMPLEX_INPUTS[cmdLower] || COMPLEX_INPUTS[baseName]);
            if (!isNumericCommand(command) && !hasDirectConfig) return null;
 
            // 2. Procura Directa com Proteção contra campos inexistentes (Fix color_hex)
            const visualKey = COMPLEX_INPUTS[cmdLower] ? cmdLower : (COMPLEX_INPUTS[baseName] ? baseName : null);
            if (visualKey) {
                const cfg = JSON.parse(JSON.stringify(COMPLEX_INPUTS[visualKey]));
                if (cfg.parts && cfg.parts[0]) cfg.parts[0].label = command;
                else cfg.label = command;
                return localizeCfg(cfg);
            }
 
            // 3. Resolvedor por Palavras-Chave (Suporta prefixos e sufixos)
            if (/detection/i.test(cmdLower)) return getTpl('_tpl_detection', command);
            if (/sensitivity/i.test(cmdLower)) return getTpl('_tpl_sensitivity', command);
            if (/time|delay|timeout|countdown/i.test(cmdLower)) return getTpl('countdown', command);
 
            return getTpl('_tpl_generic', command);
 
            function getTpl(id, label) {
                const tpl = JSON.parse(JSON.stringify(COMPLEX_INPUTS[id]));
                if (tpl.parts && tpl.parts[0]) tpl.parts[0].label = label;
                else tpl.label = label;
                return localizeCfg(tpl);
            }
        }
        
    // ============================================================================
    // 🌍 EXPORTS
    // ============================================================================
    if (!window.Z2MConfig) window.Z2MConfig = {};

    window.Z2MConfig = {
        COMPLEX_INPUTS,
        PAYLOAD_DROPLIST,
        COMPOSITE_EXPANSIONS,
        NUMERIC_COMMAND_PATTERNS,
        
        TOGGLEABLE_PATTERNS,
        NON_TOGGLEABLE_PATTERNS,
        
        COMMAND_GROUPS,
        DETECTION_PAIRS,
        
        getComplexInputConfig,
        getPayloadDroplist,
        getCompositeExpansions,
        getDetectionPair,
        getCommandGroup,
        
        isNumericCommand,
        isToggleable,
        matchesPattern,
        patternToRegex,
        
        formatTime,
        formatSliderValue
    };

    if (window.Z2MDebug && window.Z2MDebug.isEnabled()) console.log('[Z2M Config] ✅ Loaded successfully');

})(window);
