import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import * as _ from 'lodash';

// Providers
import { BwcProvider } from '../bwc/bwc';
import { Logger } from '../logger/logger';
import { PersistenceProvider } from '../persistence/persistence';
import { PopupProvider } from '../popup/popup';

@Injectable()
export class KeyProvider {
  private isDirty: boolean;
  private Key = this.bwcProvider.getKey();
  private keys: any[];
  public activeWGKey: string;

  constructor(
    private logger: Logger,
    private bwcProvider: BwcProvider,
    private popupProvider: PopupProvider,
    private persistenceProvider: PersistenceProvider,
    private translate: TranslateService
  ) {
    this.logger.debug('KeyProvider initialized');
    this.isDirty = false;
  }

  public load(): Promise<any> {
    return this.persistenceProvider.getKeys().then(async keys => {
      this.keys = [];
      keys = keys ? keys : [];
      keys.forEach(k => this.keys.push(this.Key.fromObj(k)));
      await this.loadActiveWGKey();
      return Promise.resolve();
    });
  }

  public async loadActiveWGKey() {
    const defaultKeyId = this.keys && this.keys[0] ? this.keys[0].id : null;
    this.activeWGKey =
      (await this.persistenceProvider.getActiveWGKey()) || defaultKeyId;
  }

  public setActiveWGKey(keyId: string) {
    this.activeWGKey = keyId;
    return this.persistenceProvider.setActiveWGKey(keyId);
  }

  public async removeActiveWGKey() {
    await this.persistenceProvider.removeActiveWGKey();
  }

  private storeKeysIfDirty(): Promise<any> {
    if (!this.isDirty) {
      this.logger.debug('The keys have not been saved. Not dirty');
      return Promise.resolve();
    }

    const keysToAdd = [];
    this.keys.forEach(k => {
      keysToAdd.push(k.toObj(k));
    });
    return this.persistenceProvider.setKeys(keysToAdd).then(() => {
      this.isDirty = false;
      return Promise.resolve();
    });
  }

  public addKey(keyToAdd): Promise<any> {
    if (!keyToAdd) return Promise.resolve();
    const keyIndex = this.keys.findIndex(k => this.Key.match(keyToAdd, k));

    if (keyIndex >= 0) {
      this.keys.splice(keyIndex, 1, this.Key.fromObj(keyToAdd));
    } else {
      this.keys.push(this.Key.fromObj(keyToAdd));
    }
    this.isDirty = true;
    return this.storeKeysIfDirty();
  }

  public addKeys(keysToAdd: any[]): Promise<any> {
    keysToAdd.forEach(keyToAdd => {
      if (!this.keys.find(k => this.Key.match(keyToAdd, k))) {
        this.keys.push(this.Key.fromObj(keyToAdd));
        this.isDirty = true;
      } else {
        this.logger.warn('Key already added');
      }
    });
    return this.storeKeysIfDirty();
  }

  public getKey(keyId: string) {
    let selectedKey = this.keys.find(k => k.id == keyId);

    if (selectedKey) {
      return selectedKey;
    } else {
      this.logger.debug('No matches for key id: ' + keyId);
      return null;
    }
  }

  public removeKey(keyId: string): Promise<any> {
    this.logger.debug('Removing key: ' + keyId);
    if (keyId === 'read-only') return Promise.resolve();

    const selectedKey = this.keys.findIndex(k => k.id == keyId);

    if (selectedKey >= 0) {
      this.keys.splice(selectedKey, 1);
      this.isDirty = true;
      return this.storeKeysIfDirty();
    } else {
      const err = 'No matches for key id: ' + keyId;
      this.logger.debug(err);
      return Promise.reject(err);
    }
  }

  // An alert dialog
  private askPassword(warnMsg: string, title: string): Promise<any> {
    const opts = {
      type: 'password',
      useDanger: true
    };
    return this.popupProvider.ionicPrompt(title, warnMsg, opts);
  }

  public encrypt(keyId): Promise<any> {
    const key = this.getKey(keyId);
    let title = this.translate.instant('Enter a new encrypt password');
    const warnMsg = this.translate.instant(
      'Your wallet key will be encrypted. The encrypt password cannot be recovered. Be sure to write it down.'
    );
    return this.askPassword(warnMsg, title).then((password: string) => {
      if (password == '' || _.isNull(password)) {
        return Promise.reject(this.translate.instant('No password'));
      }
      title = this.translate.instant('Confirm your new encrypt password');
      return this.askPassword(warnMsg, title).then((password2: string) => {
        if (password != password2 || _.isNull(password2)) {
          return Promise.reject(this.translate.instant('Password mismatch'));
        }
        try {
          this.encryptPrivateKey(key, password);
        } catch (error) {
          return Promise.reject(error);
        }
        return Promise.resolve();
      });
    });
  }

  public encryptNewKey(key): Promise<any> {
    let title = this.translate.instant(
      'Enter a password to encrypt your wallet'
    );
    const warnMsg = this.translate.instant(
      'This password is only for this device, and it cannot be recovered. To avoid losing funds, write your password down.'
    );
    return this.askPassword(warnMsg, title).then((password: string) => {
      if (!password) {
        return this.showWarningNoEncrypt().then(res => {
          if (res) return Promise.resolve();
          return this.encryptNewKey(key);
        });
      } else {
        title = this.translate.instant(
          'Enter your encrypt password again to confirm'
        );
        return this.askPassword(warnMsg, title).then((password2: string) => {
          if (!password2 || password != password2) {
            return this.encryptNewKey(key);
          } else {
            try {
              this.encryptPrivateKey(key, password);
            } catch (error) {
              return Promise.reject(error);
            }
            return Promise.resolve();
          }
        });
      }
    });
  }

  public showWarningNoEncrypt(): Promise<any> {
    const title = this.translate.instant('Are you sure?');
    const msg = this.translate.instant(
      'Without encryption, a thief or another application on this device may be able to access your funds.'
    );
    const okText = this.translate.instant("I'm sure");
    const cancelText = this.translate.instant('Go Back');
    return this.popupProvider.ionicConfirm(title, msg, okText, cancelText);
  }

  public decrypt(keyId: string): Promise<any> {
    const key = this.getKey(keyId);
    return this.askPassword(
      null,
      this.translate.instant('Enter encrypt password')
    ).then((password: string) => {
      if (password == '' || _.isNull(password)) {
        return Promise.reject(this.translate.instant('No password'));
      }
      try {
        this.decryptPrivateKey(key, password);
      } catch (e) {
        return Promise.reject(this.translate.instant('Wrong password'));
      }
      return Promise.resolve();
    });
  }

  public handleEncryptedWallet(keyId: string): Promise<any> {
    if (!keyId) {
      return Promise.resolve();
    }
    const key = this.getKey(keyId);
    const isPrivKeyEncrypted = this.isPrivKeyEncrypted(keyId);

    if (!isPrivKeyEncrypted) return Promise.resolve();
    return this.askPassword(
      null,
      this.translate.instant('Enter encrypt password')
    ).then((password: string) => {
      if (_.isNull(password)) {
        return Promise.reject(new Error('PASSWORD_CANCELLED'));
      } else if (password == '') {
        return Promise.reject(new Error('NO_PASSWORD'));
      } else if (!key.checkPassword(password)) {
        return Promise.reject(new Error('WRONG_PASSWORD'));
      } else {
        return Promise.resolve(password);
      }
    });
  }

  public isPrivKeyEncrypted(keyId: string) {
    if (!keyId) return false;
    const key = this.getKey(keyId);

    return key ? key.isPrivKeyEncrypted() : undefined;
  }

  public isDeletedSeed(keyId: string): boolean {
    if (!keyId) return true;
    const key = this.getKey(keyId);
    return !key || (!key.mnemonic && !key.mnemonicEncrypted);
  }

  public mnemonicHasPassphrase(keyId: string): boolean {
    if (!keyId) return false;
    const key = this.getKey(keyId);
    return key.mnemonicHasPassphrase;
  }

  public get(keyId: string, password: string) {
    const key = this.getKey(keyId);
    return key.get(password);
  }

  public getBaseAddressDerivationPath(keyId, opts): string {
    const key = this.getKey(keyId);
    return key.getBaseAddressDerivationPath(opts);
  }

  public encryptPrivateKey(key, password: string) {
    key.encrypt(password);
  }

  public decryptPrivateKey(key, password: string) {
    key.decrypt(password);
  }

  public sign(keyId: string, rootPath: string, txp, password: string) {
    if (!keyId) {
      this.logger.warn("Can't sign. No key provided");
      return;
    }

    const key = this.getKey(keyId);

    return key.sign(rootPath, txp, password);
  }
}
