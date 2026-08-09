# Forked
This was forked from [andreypopov/node-red-contrib-zigbee2mqtt](https://github.com/andreypopov/node-red-contrib-zigbee2mqtt) but that repo was last updated more than 18 months ago and the dependencies were horribly out of date and wouldn't cleanly install for me.

I've made other improvements, such as more state options to support ZigBee devices I own. [I submitted a PR](https://github.com/andreypopov/node-red-contrib-zigbee2mqtt/pull/154) for the changes but given all the unmerged PRs, I don't expect my PR will be merged.

# @evilbunny/node-red-contrib-zigbee2mqtt
[![platform](https://img.shields.io/badge/platform-Node--RED-red?logo=nodered)](https://nodered.org)
[![Min Node Version](https://img.shields.io/node/v/@evilbunny/node-red-contrib-zigbee2mqtt.svg)](https://nodejs.org/en/)
[![GitHub version](https://img.shields.io/github/package-json/v/evilbunny2008/node-red-contrib-zigbee2mqtt?logo=npm)](https://www.npmjs.com/package/node-red-contrib-zigbee2mqtt)
[![GitHub stars](https://img.shields.io/github/stars/evilbunny2008/node-red-contrib-zigbee2mqtt)](https://github.com/evilbunny2008/node-red-contrib-zigbee2mqtt/stargazers)
[![Package Quality](https://packagequality.com/shield/@evilbunny/node-red-contrib-zigbee2mqtt.svg)](https://packagequality.com/#?package=node-red-contrib-zigbee2mqtt)

[![issues](https://img.shields.io/github/issues/evilbunny2008/node-red-contrib-zigbee2mqtt?logo=github)](https://github.com/evilbunny2008/node-red-contrib-zigbee2mqtt/issues)
![GitHub last commit](https://img.shields.io/github/last-commit/evilbunny2008/node-red-contrib-zigbee2mqtt)
![NPM Total Downloads](https://img.shields.io/npm/dt/@evilbunny/node-red-contrib-zigbee2mqtt.svg)
![NPM Downloads per month](https://img.shields.io/npm/dm/@evilbunny/node-red-contrib-zigbee2mqtt)
![Repo size](https://img.shields.io/github/repo-size/evilbunny2008/node-red-contrib-zigbee2mqtt)

Node-Red Nodes for Zigbee2mqtt connectivity.

# Install
You can install this by going to the hamburger menu in Node Red, then go to "Manage palette". Click on the "Palette" tab on the left side, then click on the "Install" tab then search for "@evilbunny/node-red-contrib-zigbee2mqtt" then click "install"

# Available nodes
* zigbee2mqtt-eb-in: listen to device
* zigbee2mqtt-eb-get: get current value of device
* zigbee2mqtt-eb-out: send command to device
* zigbee2mqtt-eb-bridge: logs, options, other events

Extra features:
* groups support
* network map generation

<img src="https://github.com/evilbunny2008/node-red-contrib-zigbee2mqtt/blob/main/readme/1.png?raw=true">
<img src="https://github.com/evilbunny2008/node-red-contrib-zigbee2mqtt/blob/main/readme/2.png?raw=true">
<img src="https://github.com/evilbunny2008/node-red-contrib-zigbee2mqtt/blob/main/readme/3.png?raw=true">
<img src="https://github.com/evilbunny2008/node-red-contrib-zigbee2mqtt/blob/main/readme/4.png?raw=true">
<img src="https://github.com/evilbunny2008/node-red-contrib-zigbee2mqtt/blob/main/readme/5.png?raw=true">
