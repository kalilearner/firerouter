/*    Copyright 2021 Firewalla Inc
 *
 *    This program is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU Affero General Public License, version 3,
 *    as published by the Free Software Foundation.
 *
 *    This program is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU Affero General Public License for more details.
 *
 *    You should have received a copy of the GNU Affero General Public License
 *    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

const InterfaceBasePlugin = require('./intf_base_plugin.js');

const exec = require('child-process-promise').exec;
const pl = require('../plugin_loader.js');
const r = require('../../util/firerouter.js');
const fs = require('fs');
const Promise = require('bluebird');
Promise.promisifyAll(fs);

const wpaSupplicantServiceFileTemplate = `${r.getFireRouterHome()}/scripts/firerouter_wpa_supplicant@.template.service`;
const wpaSupplicantScript = `${r.getFireRouterHome()}/scripts/wpa_supplicant.sh`;

class WLANInterfacePlugin extends InterfaceBasePlugin {

  static async preparePlugin() {
    await this.createDirectories();
    await this.installWpaSupplicantScript();
    await this.installSystemService();
  }

  static async createDirectories() {
    await exec(`mkdir -p ${r.getUserConfigFolder()}/wpa_supplicant`).catch((err) => {});
    await exec(`mkdir -p ${r.getRuntimeFolder()}/wpa_supplicant`).catch((err) => {});
    await exec(`mkdir -p ${r.getTempFolder()}`).catch((err) => {});
  } 

  static async installSystemService() {
    let content = await fs.readFileAsync(wpaSupplicantServiceFileTemplate, {encoding: 'utf8'});
    content = content.replace(/%WPA_SUPPLICANT_DIRECTORY%/g, r.getTempFolder());
    const targetFile = r.getTempFolder() + "/firerouter_wpa_supplicant@.service";
    await fs.writeFileAsync(targetFile, content);
    await exec(`sudo cp ${targetFile} /etc/systemd/system`);
    await exec("sudo systemctl daemon-reload");
  }

  static async installWpaSupplicantScript() {
    await exec(`cp ${wpaSupplicantScript} ${r.getTempFolder()}/wpa_supplicant.sh`);
  }

  async flush() {
    await super.flush();

    if (this.networkConfig && this.networkConfig.baseIntf) {
      await exec(`sudo iw dev ${this.name} del`).catch((err) => {});
    }

    if (this.networkConfig && this.networkConfig.wpaSupplicant) {
      await exec(`sudo systemctl stop firerouter_wpa_supplicant@${this.name}`).catch((err) => {});
      await fs.unlinkAsync(this._getWpaSupplicantConfigPath()).catch((err) => {});
    }
  }

  _getWpaSupplicantConfigPath() {
    return `${r.getUserConfigFolder()}/wpa_supplicant/${this.name}.conf`;
  }

  async createInterface() {
    if (this.networkConfig.baseIntf) {
      const baseIntf = this.networkConfig.baseIntf;
      const baseIntfPlugin = pl.getPluginInstance("interface", baseIntf);
      if (baseIntfPlugin) {
        this.subscribeChangeFrom(baseIntfPlugin);
        if (await baseIntfPlugin.isInterfacePresent() === false) {
          this.log.warn(`Base interface ${baseIntf} is not present yet`);
          return false;
        }
      } else {
        this.fatal(`Lower interface plugin not found ${baseIntf}`);
      }
      const type = this.networkConfig.type || "managed";
      await exec(`sudo iw dev ${baseIntf} interface add ${this.name} type ${type}`);
    }
    
    if (this.networkConfig.wpaSupplicant) {
      const entries = [];
      entries.push(`ctrl_interface=DIR=${r.getRuntimeFolder()}/wpa_supplicant/${this.name}`);
      const networks = this.networkConfig.wpaSupplicant.networks || [];
      for (const network of networks) {
        entries.push("network={");
        for (const key of Object.keys(network)) {
          entries.push(`\t${key}="${network[key]}"`);
        }
        entries.push("}");
        entries.push('\n');
      }
      await fs.writeFileAsync(this._getWpaSupplicantConfigPath(), entries.join('\n'));

      if (this.networkConfig.enabled) {
        await exec(`sudo systemctl start firerouter_wpa_supplicant@${this.name}`).catch((err) => {
          this.log.error(`Failed to start firerouter_wpa_supplicant on $${this.name}`, err.message);
        });
      } else {
        await exec(`sudo systemctl stop firerouter_wpa_supplicant@${this.name}`).catch((err) => {});
      }
    }

    return true;
  }

}

module.exports = WLANInterfacePlugin;