import ServiceElectron, { IPCMessages as IPCElectronMessages } from '../services/service.electron';
import Logger from '../tools/env.logger';

const CSettings = {
    notificationDelayOnStream: 500,             // ms, Delay for sending notifications about stream's update to render (client) via IPC, when stream is blocked
    maxPostponedNotificationMessages: 500,      // How many IPC messages to render (client) should be postponed via timer
};

export default class ProgressState {

    private _streamId: string;
    private _names: Map<string, string> = new Map();
    private _progress: number = 0;
    private _timer: any;
    private _postponed: number = 0;
    private _started: number = 0;
    private _logger: Logger;

    constructor(streamId: string) {
        this._streamId = streamId;
        this._logger = new Logger(`ProgressState: ${this._streamId}`);
    }

    public destroy() {
        clearTimeout(this._timer);
        this._names.clear();
        this._send();
    }

    public add(id: string, name: string) {
        if (this._names.has(id)) {
            return;
        }
        if (this._started === 0) {
            this._started = Date.now();
        }
        this._names.set(id, name);
    }

    public remove(id: string) {
        const pipe = this._names.get(id);
        if (pipe === undefined) {
            return;
        }
        this._names.delete(id);
        if (this._names.size === 0) {
            this._progress = 0;
            this._logger.env(`All pipes done in: ${((Date.now() - this._started) / 1000).toFixed(2)}s`);
            this._started = 0;
        }
        this._send();
    }

    public next(progress: number) {
        if (this._names.size === 0) {
            return;
        }
        if (this._progress === progress) {
            return;
        }
        if (progress < 0 || progress > 1) {
            return;
        }
        this._progress = progress;
        this._notify();
    }

    private _send() {
        clearTimeout(this._timer);
        ServiceElectron.IPC.send(new IPCElectronMessages.StreamProgressState({
            streamId: this._streamId,
            progress: this._progress,
            items: Array.from(this._names.values()),
        }));
    }

    private _notify() {
        clearTimeout(this._timer);
        if (this._postponed < CSettings.maxPostponedNotificationMessages) {
            this._postponed += 1;
            this._timer = setTimeout(() => {
                this._send();
            }, CSettings.notificationDelayOnStream);
        } else {
            this._postponed = 0;
            this._send();
        }
    }

}
