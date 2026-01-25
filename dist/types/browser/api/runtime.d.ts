/// <reference types="node" />
import { EventEmitter } from 'node:events';
import { ExtensionContext } from '../context';
export declare class RuntimeAPI extends EventEmitter {
    private ctx;
    private hostMap;
    private pendingResponses;
    constructor(ctx: ExtensionContext);
    private setupResponseHandler;
    private sendMessage;
    private connectNative;
    private disconnectNative;
    private sendNativeMessage;
    private openOptionsPage;
}
