/// <reference types="node" />
import { EventEmitter } from 'node:events';
import { ExtensionContext } from '../context';
export declare class RuntimeAPI extends EventEmitter {
    private ctx;
    private hostMap;
    private pendingResponses;
    private ports;
    constructor(ctx: ExtensionContext);
    private setupResponseHandler;
    private sendMessage;
    private connectNative;
    private disconnectNative;
    private sendNativeMessage;
    private openOptionsPage;
    private setupPortHandlers;
    private findBackgroundPage;
    private safeSend;
    private connect;
}
