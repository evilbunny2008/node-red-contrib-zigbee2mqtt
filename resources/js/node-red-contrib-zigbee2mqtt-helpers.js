class Zigbee2MqttEditor {
    constructor(node, config = {}) {
        this.node = node;
        this.devices = null;
        this.config = Object.assign( {
            allow_empty:false
        }, config);
        this.device_id = node.device_id||null;
        this.property = node.state||null;
        this.optionsValue = node.optionsValue||null;
        this.optionsType = node.optionsType||null;
        this.refresh = false;

        return this;
    }

    bind() {
        let that = this;
        that.getRefreshBtn().off('click').on('click', () => {
            that.refresh = true;
            that.build();
        });
        that.getServerInput().off('change').on('change', (e) => {
            // console.log('bind: getServerInput');
            that.property = null;
            that.refresh = true;
            that.build();
        });
        that.getDeviceIdInput().off('change').on('change', () => {
            that.device_id = that.getDeviceIdInput().multipleSelect('getSelects', 'value');
            if (!that.isMultiple()) { //no need to build for multiple
                // console.log('bind: getDeviceIdInput');
                that.build();
            } else {
                that.setFriendlyName();
            }
        });
        if (that.getDeviceOptionsInput()) {
            that.getDeviceOptionsInput().off('change').on('change', (event, type, value) => {
                // console.log('bind: getDeviceOptionsInput');
                that.optionsValue = value;
                that.optionsType = type;
                that.buildDeviceOptionsHelpBlock();
            });
        }
        that.getEnableMultipleCheckbox().off('change').on('change', (e) => {
            // that.property = null;
            // that.refresh = true;
            // console.log('bind: getEnableMultipleCheckbox');
            that.build();
        });
    }

    async build() {
        let that = this;
        // console.log('build : '+(this.refresh?'true':false));
        await that.buildDeviceIdInput().then(()=>{
            that.buildDevicePropertyInput();
            that.buildDeviceOptionsInput();
        });
        that.bind();
    }

    async buildDeviceIdInput() {
        let that = this;
        that.getFilterChanges().closest('.form-row').toggle(!that.isMultiple());
        // console.log('BUILD buildDeviceIdInput');

        let params = {
            single: !that.isMultiple(),
            minimumCountSelected: !that.isMultiple()?1:0,
            numberDisplayed: 1,
            maxHeight: 300,
            dropWidth: 320,
            width: 320,
            filter: true,
            formatAllSelected:function(){return RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.select_device")}
        };
        if (that.config.allow_empty && !that.isMultiple()) {
            params.formatAllSelected = function(){return RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.msg_topic")};
        }

        that.getDeviceIdInput().children().remove();
        that.getDeviceIdInput().multipleSelect('destroy').multipleSelect(params).multipleSelect('disable');

        let data = await that.getDevices();

        if (that.config.allow_empty && !that.isMultiple()) {
            that.getDeviceIdInput().html('<option value="msg.topic">msg.topic</option>');
        }

        let html = '';

        //groups
        let groups = data[1];
        groups.sort(function(a, b) {
            return (a.friendly_name || '').localeCompare(b.friendly_name || '', undefined, {sensitivity: 'base'});
        });
        if (groups.length) {
            html = $('<optgroup/>', {label: RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.groups")});
            html.appendTo(that.getDeviceIdInput());
            $.each(groups, function(index, value) {
                let text = '';
                if ("devices" in value && typeof (value.devices) != 'undefined' && value.devices.length > 0) {
                    text = ' (' + value.devices.length + ')';
                }
                $('<option value="' + value.id + '" data-friendly_name="' + value.friendly_name + '">' + value.friendly_name + text + '</option>')
                    .appendTo(html);
            });
        }

        //devices
        let devices = data[0];
        devices.sort(function(a, b) {
            return (a.friendly_name || '').localeCompare(b.friendly_name || '', undefined, {sensitivity: 'base'});
        });
        if (devices.length) {
            html = $('<optgroup/>', {label: RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.devices")});
            html.appendTo(that.getDeviceIdInput());
            $.each(devices, function(index, value) {
                var model = '';
                if ("definition" in value && value.definition && "model" in value.definition && typeof (value.definition.model) !== undefined) {
                    model = ' (' + value.definition.model + ')';
                }
                $('<option value="' + value.ieee_address + '" data-friendly_name="' + value.friendly_name + '">' + value.friendly_name + model + '</option>')
                    .appendTo(html);
            });
        }

        that.getDeviceIdInput().multipleSelect('enable');
        that.getDeviceIdInput().multipleSelect('refresh');

        that.setDeviceValue();
        that.setFriendlyName();
        return this;
    }

    async buildDevicePropertyInput() {
        let that = this;
        if (!that.getDevicePropertyInput()) return;
        that.getDevicePropertyInput().closest('.form-row').toggle(!that.isMultiple());
        if (that.isMultiple()) return;

        // console.log('BUILD buildDevicePropertyInput');

        that.getDevicePropertyInput().children().remove();
        that.getDevicePropertyInput().multipleSelect('destroy').multipleSelect({
            numberDisplayed: 1,
            dropWidth: 320,
            width: 320,
            single: false, // always allow selecting multiple attributes; no selection = complete payload
            placeholder: RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.complete_payload")
        }).multipleSelect('disable');

        let html = '';
        let device = that.getDevice();

        if (device && 'definition' in device && device.definition && 'exposes' in device.definition) {
            html = $('<optgroup/>', {label: RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.zigbee2mqtt")});
            html.appendTo(that.getDevicePropertyInput());

            $.each(device.definition.exposes, function(index, value) {
                if ('features' in value) {
                    $.each(value.features, function(index2, value2) {
                        if ('property' in value2) {
                            let endpoint = value.endpoint || value2.endpoint;
                            let label = value2.property + (value2.unit ? ', ' + value2.unit : '');
                            $('<option value="' + value2.property + '">' + label + '</option>')
                                .appendTo(html);
                        }
                    });
                } else if ('property' in value) {
                    let label = value.property + (value.unit ? ', ' + value.unit : '');
                    $('<option value="' + value.property + '">' + label + '</option>')
                        .appendTo(html);
                }
            });
        }

        if (device && 'homekit' in device && device.homekit && Object.keys(device.homekit).length) {
            html = $('<optgroup/>', {label: RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.homekit")});
            html.appendTo(that.getDevicePropertyInput());

            $.each(device.homekit, function (index, value) {
                $('<option  value="homekit_' + index + '">' + index + '</option>').appendTo(html);
            });
        }
        that.getDevicePropertyInput().multipleSelect('enable');

        // restore previously-selected properties (supports legacy single-string values too)
        let selected = that.property;
        if (typeof selected === 'string') {
            selected = selected && selected !== '0' ? [selected] : [];
        }
        if (!Array.isArray(selected)) {
            selected = [];
        }
        // drop any selections that no longer exist as options for this device
        selected = selected.filter(function(value) {
            return that.getDevicePropertyInput().find('option[value="' + value + '"]').length > 0;
        });
        that.property = selected;
        that.getDevicePropertyInput().multipleSelect('setSelects', selected);

        that.getDevicePropertyInput().multipleSelect('refresh');
    }

    buildLabel(name, property, unit) {
        let label = name + (unit ? ', ' + unit : '');
        if (property !== name) {
            // e.g. property "state_l1" vs name "state" -> suffix "l1"
            // or property "inching_control_1" vs name "inching_control" -> suffix "1"
            let suffix = property.slice(name.length).replace(/^_/, '');
            if (suffix) {
                label += ' (' + suffix + ')';
            }
       }
       return label;
    }

    buildDeviceOptionsInput() {
        let that = this;
        if (!that.getDeviceOptionsInput()) return;
        that.getDeviceOptionsTypeHelpBlock().hide().find('div').text('').closest('.form-tips').find('span').text('');
        that.getDeviceOptionsInput().closest('.form-row').toggle(!that.isMultiple());
        if (that.isMultiple()) return;

        // console.log('BUILD buildDeviceOptionsInput');
        let device = that.getDevice();
        let options = [];
        options.push({'value': 'nothing', 'label': RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.nothing"), options:['']});
        options.push('msg');
        options.push('json');
        if (device && 'definition' in device && device.definition && 'options' in device.definition) {
            $.each(device.definition.options, function(k, v) {
                options.push({'value': v.property, 'label': v.name});
            });
        }
        that.getDeviceOptionsInput().typedInput({
            default: 'nothing',
            value: that.optionsType,
            typeField: that.getDeviceOptionsTypeInput(),
        });
        that.getDeviceOptionsInput().typedInput('types', options);
        that.getDeviceOptionsInput().typedInput('type', that.optionsType || 'nothing');
        that.getDeviceOptionsInput().typedInput('value', that.optionsValue || '');
        that.buildDeviceOptionsHelpBlock();
    }

    buildDeviceOptionsHelpBlock() {
        let that = this;
        if (!that.getDeviceOptionsTypeHelpBlock()) return;

        that.getDeviceOptionsTypeHelpBlock().hide().find('div').text('').closest('.form-tips').find('span').text('');
        if (that.isMultiple()) return;

        // console.log('BUILD buildDeviceOptionsHelpBlock');

        let device = that.getDevice();
        let selectedOption = null;
        if (device && 'definition' in device && device.definition && 'options' in device.definition) {
            $.each(device.definition.options, function(k, v) {
                if ('json' === that.optionsType) {
                    let json = {};
                    $.each(device.definition.options, function(k, v2) {
                        if ('property' in v2) {
                            let defaultVal = '';
                            if ('type' in v2) {
                                if (v2.type==='numeric') {
                                    defaultVal = 0;
                                    if ('value_min' in v2) {
                                        defaultVal = v2.value_min;
                                    }
                                } else if (v2.type==='binary') {
                                    defaultVal = false;
                                }
                            }
                            json[v2.property] = defaultVal;
                        }
                    });
                    selectedOption = {'name':'JSON', 'description':JSON.stringify(json, null, 4)};
                    return false;
                }
                if (v.property === that.optionsType) {
                    selectedOption = v;
                    return false;
                }
            });
        }

        if (selectedOption && 'description' in selectedOption && selectedOption.description) {
            that.getDeviceOptionsTypeHelpBlock().show().find('div').text(selectedOption.name).closest('.form-tips').find('span').text(selectedOption.description);
        }
    }

    async getDevices() {
        let that = this;
        if (that.devices === null || that.refresh) {
            const response = await fetch('/zigbee2mqtt-eb/getDevices?' + new URLSearchParams({
                controllerID: that.getServerInput().val()
            }).toString(), {
                method: 'GET',
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            that.refresh = false;
            that.devices = await response.json();
            return that.devices;
        } else {
            return await new Promise(function(resolve, reject) {
                resolve(that.devices);
            });
        }
    }

     getDevice() {
        let that = this;
        let devices = that.devices[0];
        let device = null;

        if (devices.length && that.device_id) {
            let selectedDevice = typeof(that.device_id) === 'object' ? that.device_id[0] : that.device_id;
            $.each(devices, function (index, item) {
                if (item.ieee_address === selectedDevice) {
                    device = item;
                    return false;
                }
            });
        }
        return device;
    }

    getDeviceIdInput() {
        return $('#node-input-device_id');
    }

    getDevicePropertyInput() {
        let $elem = $('#node-input-state');
        return $elem.length?$elem:null;
    }

    getDeviceOptionsInput() {
        let $elem = $('#node-input-optionsValue');
        return $elem.length?$elem:null;
    }

    getDeviceOptionsTypeInput() {
        let $elem = $('#node-input-optionsType');
        return $elem.length?$elem:null;
    }

    getDeviceOptionsTypeHelpBlock() {
        return $('.optionsType_description');
    }

    getDeviceFriendlyNameInput() {
        return $('#node-input-friendly_name');
    }

    getServerInput() {
        return $('#node-input-server');
    }

    getRefreshBtn() {
        return $('#force-refresh');
    }

    getFilterChanges() {
        return $('#node-input-filterChanges');
    }

    getEnableMultipleCheckbox() {
        return $('#node-input-enableMultiple');
    }

    isMultiple() {
        return this.getEnableMultipleCheckbox().is(':checked');
    }

    setDeviceValue() {
        let that = this;
        if (that.isMultiple()) {
            if (typeof(that.device_id) == 'string') {
                that.device_id = [that.device_id];
            }
            if (that.device_id) {
                that.getDeviceIdInput().multipleSelect('setSelects', that.device_id);
            }
        } else if (that.device_id && that.device_id.length) {
            if (typeof(that.device_id) == 'object') {
                that.device_id = that.device_id[0]; //get the first device
            }
            if (that.getDeviceIdInput().find('option[value="'+that.device_id+'"]').length) {
                that.getDeviceIdInput().val(that.device_id);
            }
            // that.getDeviceIdInput().multipleSelect('check', that.device_id); //does not work
            that.getDeviceIdInput().multipleSelect('refresh');
        } else {
            that.device_id = null;
        }
    }

    setFriendlyName() {
        let that = this;
        if (that.isMultiple()) {
            if (typeof(that.device_id) == 'string') {
                that.device_id = [that.device_id];
            }
            if (!that.device_id) {
                that.device_id = [];
            }
            that.getDeviceFriendlyNameInput().val(that.device_id.length + ' ' + RED._("node-red-contrib-zigbee2mqtt-eb/server:editor.selected"));
        } else if (that.device_id && that.device_id.length) {
            if (typeof(that.device_id) == 'object') {
                that.device_id = that.device_id[0]; //get the first device
            }
            if (that.getDeviceIdInput().find('option[value="'+that.device_id+'"]').length) {
                that.getDeviceFriendlyNameInput().val(that.getDeviceIdInput().multipleSelect('getSelects', 'text'));
            }
        } else {
            that.getDeviceFriendlyNameInput().val('');
        }
    }
}
