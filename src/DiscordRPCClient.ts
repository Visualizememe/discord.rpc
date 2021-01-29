import debug from "debug";
import { DISCORD_API_ENDPOINT, RPCCommand, RPCCommands, RPCEvent, RPCEvents } from "./constants";
import IPCTransport from "./transports/IPCTransport";
import { uuid4122 } from "./util";
import EventEmitter = require("events");


type DiscordScope =
    "identify"
    | "email"
    | "connections"
    | "guilds"
    | "guilds.join"
    | "gdm.join"
    | "rpc"
    | "rpc.notifications.read"
    | "bot"
    | "webhook.incoming"
    | "messages.read"
    | "applications.builds.upload"
    | "applications.build.read"
    | "applications.commands"
    | "applications.commands.update"
    | "applications.store.update"
    | "applications.entitlements"
    | "activities.read"
    | "activities.write"
    | "relationships.read"
    | string;
type DiscordRPCClientOptions = {
    clientId: string;
    transport: "ipc" | "websocket"
    clientSecret?: string;
    redirectUri?: string;
    scopes?: (DiscordScope | string)[];
    accessToken?: string;
}

export default class DiscordRPCClient extends EventEmitter {
    /**
     * The endpoint used for API requests
     * @type {string}
     */
    public apiEndpoint: string;
    /**
     * The id of the client
     * @type {string}
     */
    public clientId: string;
    /**
     * Whether to use the IPCTransport or WebSocketTransport
     * @type {DiscordRPCClientOptions["transport"]}
     */
    public transportType: DiscordRPCClientOptions["transport"];
    // | WebSocketTransport;
    /**
     * The transport used as socket
     * @type {IPCTransport}
     */
    public transport: IPCTransport;
    public scopes: (DiscordScope | string)[];
    /**
     * The client secret
     * @type {string | null}
     */
    public clientSecret: string | null;
    public redirectUri: string | null;
    public accessToken: string | null;
    public user: unknown | null;

    public debugger: debug.Debugger;

    public pendingResponses: Map<string, { resolve: (...args: any[]) => unknown, reject: (error: any) => unknown }>;
    public eventHandlers: Map<string, (...args: any[]) => void>;

    private connectingPromise: Promise<void> | null;


    constructor (options: DiscordRPCClientOptions) {
        if (options.transport !== "ipc" && options.transport !== "websocket") {
            throw new Error(`You can only use either "ipc" or "websocket" as transport!`);
        }

        super();
        this.apiEndpoint = DISCORD_API_ENDPOINT;
        this.debugger = debug("DiscordRPCClient");
        this.clientId = options.clientId;
        this.transportType = options.transport;
        this.transport = this.transportType === "ipc" ? new IPCTransport(this) : new IPCTransport(this);
        this.scopes = options.scopes || [];
        this.clientSecret = options.clientSecret || null;
        this.redirectUri = options.redirectUri ? encodeURIComponent(decodeURIComponent(options.redirectUri)) : null;
        this.accessToken = options.accessToken || null;
        this.user = null;

        this.pendingResponses = new Map();
        this.eventHandlers = new Map();

        this.connectingPromise = null;
    }

    connect (): Promise<void> {
        if (this.connectingPromise) {
            return this.connectingPromise as Promise<void>;
        }

        this.connectingPromise = new Promise<void>((resolve, reject) => {
            const defaultTimeout = setTimeout(() => reject(new Error(`RPC_CONNECTION_TIMEOUT`)), 10000);
            defaultTimeout.unref();

            const quitConnecting = (e?: Error) => {
                clearTimeout(defaultTimeout);
                if (e) {
                    return reject(e);
                }
            };

            this.once("connected", () => {
                this.debugger(`Successfully connected to socket!`);
                quitConnecting();
                resolve();
            });

            this.transport.once("error", (error: Error) => {
                this.debugger(`Encountered an error!`);
                this.debugger(error);
                throw error;
            });

            this.transport.once("close", () => {
                this.debugger(`Socket closed!`);

                quitConnecting();
                this.pendingResponses.forEach(pending => {
                    pending.reject(new Error("Connection closed"));
                });

                this.emit("disconnected");

                reject(new Error("Connection closed"));
            });

            this.debugger(`Binding received messages to DiscordRPCClient.onRPCMessage()`);
            this.transport.on("message", this.onRPCMessage.bind(this));

            this.debugger(`Attempting to connect..`);
            return this.transport.connect()
                .catch(reject);
        });

        return this.connectingPromise;
    }

    sendRequest (method: string, path: string, options: { data: any, query: any }) {
        return fetch(`${this.apiEndpoint}${path}${options.query ? new URLSearchParams(options.query) : ""}`, {
            method,
            body: options.data,
            headers: {
                Authorization: `Bearer ${this.accessToken}`
            }
        })
            .then(async response => {
                const parsedBody = await response.json();

                if (!response.ok) {
                    throw new Error(`Error sending request to ${path}: Status ${response.status} - ${response.statusText || "N/A"}.`);
                }

                return parsedBody;
            });
    }

    async login (accessToken?: string) {
        this.debugger(`Attempting to authenticate, waiting for socket to connect..`);
        await this.connect();
        this.debugger(`Socket connected, authenticating..`);
        return this.sendCommand("AUTHENTICATE", {
            access_token: accessToken || this.accessToken
        })
            .then(response => {
                this.debugger(`Authentication response: ${JSON.stringify(response)}`);
                this.emit("ready");
            });
    }

    sendCommand (command: RPCCommand, args: any, event?: RPCEvent) {
        this.debugger(`Send Command: ${command}, args: ${JSON.stringify(args)}, event: ${event}`);

        return new Promise((resolve, reject) => {
            const generatedNonce = uuid4122();

            this.transport.send({
                cmd: command,
                args,
                evt: event || undefined,
                nonce: generatedNonce
            });

            this.pendingResponses.set(generatedNonce, {
                resolve,
                reject
            });
        });
    }

    subscribe (event: RPCEvent, args: any, handler: (...args: any) => void): Promise<{ unsubscribe: () => void }> {
        return this.sendCommand(RPCCommands.SUBSCRIBE, args, event)
            .then(() => {
                const eventSubscriptionKey = `${event}${JSON.stringify(args)}`;
                this.eventHandlers.set(eventSubscriptionKey, handler);

                return {
                    unsubscribe: () => {
                        this.sendCommand(RPCCommands.UNSUBSCRIBE, args, event)
                            .then(() => {
                                this.eventHandlers.delete(eventSubscriptionKey);
                            });
                    }
                };
            });
    }

    public createEventKey (event: string, args: any) {
        return `${event}${JSON.stringify(args)}`;
    }

    private onRPCMessage (message: any) {
        if (message.cmd === RPCCommands.DISPATCH && message.evt === RPCEvents.READY) {
            if (message.data && message.data.user) {
                this.user = message.data.user;
            }

            // We're connected :)
            this.emit("connected");
        } else if (this.pendingResponses.has(message.nonce)) {
            this.debugger(`Incoming message had pending response handler, nonce: ${message.nonce}`);
            const foundResponseHandler = this.pendingResponses.get(message.nonce);

            if (message.evt === "ERROR") {
                const createdError = new Error(message.data.message);

                return foundResponseHandler!.reject(createdError);
            }

            foundResponseHandler!.resolve(message.data);
        } else {
            const eventSubscriptionKey = `${message.evt}${JSON.stringify(message.args)}`;

            if (!this.eventHandlers.has(eventSubscriptionKey)) {
                this.debugger(`No event handler for event key: ${eventSubscriptionKey}`);
                return;
            }

            this.eventHandlers.get(eventSubscriptionKey)!(message.data);
        }
    }
}
