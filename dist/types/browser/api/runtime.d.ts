/// <reference types="node" />
import { EventEmitter } from 'node:events';
import { ExtensionContext } from '../context';
export declare class RuntimeAPI extends EventEmitter {
    private ctx;
    private hostMap;
    private pendingResponses;
    private ports;
    private registeredWorkers;
    constructor(ctx: ExtensionContext);
    private setupResponseHandler;
    private sendMessage;
    private connectNative;
    private disconnectNative;
    private sendNativeMessage;
    private openOptionsPage;
    private setupPortHandlers;
    /**
     * Consolidated service worker IPC listener setup with proper tracking and cleanup.
     * This prevents listener accumulation when service workers restart.
     */
    private setupServiceWorkerListeners;
    /**
     * Periodically clean up stale ports where the sender has been destroyed.
     */
    private setupPortCleanup;
    private findBackgroundPage;
    private safeSend;
    private connect;
}
