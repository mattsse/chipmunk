import { Observable, Subject, Subscription } from 'rxjs';
import { IService } from '../interfaces/interface.service';
import { IPCMessages } from './service.electron.ipc';

import ElectronIpcService from './service.electron.ipc';

import * as Toolkit from 'chipmunk.client.toolkit';

export interface IReleaseInfo {
    notes: string;
    version: string;
}

export class ReleaseNotesService implements IService {

    private readonly _url: string = 'https://api.github.com/repos/esrlabs/chipmunk/releases/latest';

    private _logger: Toolkit.Logger = new Toolkit.Logger('ReleaseNotesService');
    private _info: IReleaseInfo | undefined;
    private _subscriptions: { [key: string]: Subscription | Toolkit.Subscription | undefined } = { };
    private _subjects: {
        tab: Subject<void>,
    } = {
        tab: new Subject(),
    };

    constructor() {
        this._subscriptions.TabCustomRelease = ElectronIpcService.subscribe(IPCMessages.TabCustomRelease, this._onTabCustomRelease.bind(this));
    }

    public init(): Promise<void> {
        return new Promise((resolve) => {
            resolve();
        });
    }

    public getName(): string {
        return 'ReleaseNotesService';
    }

    public destroy() {
        return new Promise((resolve) => {
            resolve();
        });
    }

    public getObservable(): {
        tab: Observable<void>,
    } {
        return {
            tab: this._subjects.tab.asObservable(),
        };
    }

    public get(): Promise<IReleaseInfo> {
        return new Promise((resolve, reject) => {
            if (this._info !== undefined) {
                return resolve(this._info);
            }
            fetch(this._url).then((resoponse: Response) => {
                resoponse.json().then((value: any) => {
                    this._info = {
                        version: value.name,
                        notes: value.body,
                    };
                    resolve(this._info);
                }).catch((err: Error) => {
                    reject(new Error(this._logger.warn(`Fail to parse release notes due error: ${err.message}`)));
                });
            }).catch((err: Error) => {
                reject(new Error(this._logger.warn(`Fail to get release notes due error: ${err.message}`)));
            });
        });
    }

    private _onTabCustomRelease() {
        this.get().then(() => {
            this._subjects.tab.next();
        }).catch((err: Error) => {
            this._logger.warn(`Fail to call releases notes tab`);
        });
    }


}

export default (new ReleaseNotesService());
