import debug from "debug";
import { DISCORD_API_ENDPOINT, RelationshipTypes, RPCCommand, RPCCommands, RPCEvent, RPCEvents } from "./constants";
import IPCTransport from "./transports/IPCTransport";
import { getPID, uuid4122 } from "./util";
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
type ActivityOptions = {
    state: string;
    details: string;
    instance: boolean;
    timestamps?: {
        start: number;
        end: number;
    };
    assets: {
        largeImage?: string;
        largeText?: string;
        smallImage?: string;
        smallText?: string;
    };
    party?: {
        size: number;
        id: any;
        max: number;
    };
    secrets?: {
        match?: any;
        join?: any;
        spectate?: any;
    };
}

type KNOWN_EVENT_MESSAGES = {
    MESSAGE_CREATE: {
        channel_id: string;
        message: {};
    };
    MESSAGE_UPDATE: KNOWN_EVENT_MESSAGES["MESSAGE_CREATE"];
};
type VoiceSettings = {
    automaticGainControl: unknown;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    qos: unknown;
    silenceWarning: unknown;
    deaf: boolean;
    mute: boolean;
    input?: {
        deviceId: unknown;
        volume: unknown;
    };
    output?: {
        deviceId: unknown;
        volume: unknown;
    };
    mode?: {
        mode: unknown;
        autoThreshold: unknown;
        threshold: unknown;
        shortcut: unknown;
        delay: unknown
    }
};
type UserVoiceSettings = {
    pan: any;
    volume: number;
    mute: boolean;
}
type PartialUser = {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | undefined;
}


declare interface DiscordRPCClient extends EventEmitter {
    on (event: "MESSAGE_CREATE", handler: (data: KNOWN_EVENT_MESSAGES["MESSAGE_CREATE"]) => void): this;
}


/**
 * Changes the phrasing of a key to either camel or snake case
 * For example, if "to" is set to "snake" and you pass "helloWorld", the result will be "hello_world"
 * If you set "to" to "camel" and pass "hello_there" it will return "helloThere"
 * @param {"camel" | "snake"} to
 * @param {string} text
 * @returns {string}
 */
const togglePhraseCase = (to: "camel" | "snake", text: string): string => {
    let fixedPhrase = "";

    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        let fixed = char;

        if (to === "snake") {
            if (char === char.toUpperCase()) {
                // If this character is an uppercase
                fixed = `_${char.toLowerCase()}`;
            }
        } else if (to === "camel") {
            if (char === "_") {
                fixed = "";
            } else {
                const prevChar = text.charAt(i - 1) || "";

                if (prevChar === "_") {
                    fixed = char.toUpperCase();
                }
            }
        }

        fixedPhrase += fixed;
    }

    return fixedPhrase;
};

/**
 * Goes through every entry in the object provided and turns the name into to "to" case format.
 * If an entry is an object it will call itself recursively
 * @param {"camel" | "snake"} to
 * @param {Record<any, any>} object
 * @returns {Record<any, any>}
 */
const togglePhraseInObject = (to: "camel" | "snake", object: Record<any, any>): Record<any, any> => {
    const newObject: Record<any, any> = {};

    for (const entry of Object.entries(object)) {
        const updatedEntryKey = togglePhraseCase(to, entry[0]);
        if (typeof entry[1] === "object") {
            newObject[updatedEntryKey] = togglePhraseInObject(to, entry[1]);
        } else {
            newObject[updatedEntryKey] = entry[1];
        }
    }

    return newObject;
};


class DiscordRPCClient extends EventEmitter {
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
    /**
     * The redirect URI for OAuth2
     * @type {string | null}
     */
    public redirectUri: string | null;
    /**
     * The already-retrieved access-token after a user finishes OAuth2
     * @type {string | null}
     */
    public accessToken: string | null;
    /**
     * After calling DiscordRPCClient.login() this will be available
     * @type {unknown}
     */
    public user: PartialUser | null;

    /**
     * Used for debugging purposes, set DEBUG=DiscordRPCClient* to enable debugging logs
     * @type {debug.Debugger}
     */
    public debugger: debug.Debugger;

    /**
     * When doing sendCommand we expect a response from Discord with the nonce, this
     * Map will be waiting for a response from Discord with the given nonce
     * @type {Map<string, {resolve: (...args: any[]) => unknown, reject: (error: any) => unknown}>}
     */
    public pendingResponses: Map<string, { resolve: (...args: any[]) => unknown, reject: (error: any) => unknown }>;

    /**
     * If we're connecting to the socket with either IPCTransport or WebSocket this is the promise for that
     * function connecting.
     * @type {Promise<void> | null}
     * @private
     */
    private connectingPromise: Promise<void> | null;

    /**
     * Creates a new DiscordRPCClient
     * @param {DiscordRPCClientOptions} options
     */
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

        this.connectingPromise = null;
    }

    /**
     * Connects to the socket through the provided transport type
     * @returns {Promise<void>}
     */
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

    /**
     * Sends a http request
     * @param {string} method
     * @param {string} path
     * @param {{data: any, query: any}} options
     * @returns {Promise<any>}
     */
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

    /**
     * Logs in using the access token of a user through the given transport type
     * @param {string} accessToken
     * @returns {Promise<void>}
     */
    async login (accessToken?: string): Promise<PartialUser> {
        this.debugger(`Attempting to authenticate, waiting for socket to connect..`);
        await this.connect();
        this.debugger(`Socket connected, authenticating..`);
        return this.sendCommand("AUTHENTICATE", {
            access_token: accessToken || this.accessToken
        })
            .then(response => {
                this.debugger(`Authentication response: ${JSON.stringify(response)}`);
                this.user = response.user as PartialUser;
                this.emit("ready");

                return this.user;
            });
    }

    /**
     * Sends a command to the currently connected socket
     * @param {RPCCommand} command
     * @param args
     * @param {RPCEvent} event
     * @returns {Promise<unknown>}
     */
    sendCommand (command: RPCCommand, args: any, event?: RPCEvent): Promise<any> {
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

    subscribe (event: RPCEvent, args: any): Promise<void> {
        this.debugger(`Subscribing to "${event}"`);
        return this.sendCommand(RPCCommands.SUBSCRIBE, args, event)
            .then(() => {
                this.debugger(`Sent command to subscribe to event "${event}"`);
            });
    }

    getGuild (id: string, timeout?: number): Promise<unknown> {
        return this.sendCommand(RPCCommands.GET_GUILD, {
            guild_id: id,
            timeout: timeout || 10000
        });
    }

    getGuilds (timeout?: number): Promise<unknown> {
        return this.sendCommand(RPCCommands.GET_GUILDS, {
            timeout: timeout || 10000
        });
    }

    getChannel (id: string, timeout?: number): Promise<unknown> {
        return this.sendCommand(RPCCommands.GET_CHANNEL, {
            channel_id: id,
            timeout: timeout || 10000
        });
    }

    getChannels (guildId: string, timeout?: number): Promise<unknown> {
        return this.sendCommand(RPCCommands.GET_CHANNELS, {
            guild_id: guildId,
            timeout: timeout || 10000
        });
    }

    setUserVoiceSettings (userId: string, settings: UserVoiceSettings): Promise<unknown> {
        return this.sendCommand(RPCCommands.SET_USER_VOICE_SETTINGS, {
            user_id: userId,
            ...settings
        });
    }

    selectVoiceChannel (id: string, force?: boolean, timeout?: number): Promise<unknown> {
        return this.sendCommand(RPCCommands.SELECT_VOICE_CHANNEL, {
            channel_id: id,
            force: force || false,
            timeout: timeout || 10000
        });
    }

    selectTextChannel (id: string, timeout?: number): Promise<unknown> {
        return this.sendCommand(RPCCommands.SELECT_TEXT_CHANNEL, {
            channel_id: id,
            timeout: timeout || 10000
        });
    }

    sendJoinInvite (userId: string): Promise<unknown> {
        return this.sendCommand(RPCCommands.SEND_ACTIVITY_JOIN_INVITE, {
            user_id: userId
        });
    }

    sendJoinRequest (userId: string): Promise<unknown> {
        return this.sendCommand(RPCCommands.CLOSE_ACTIVITY_JOIN_REQUEST, {
            user_id: userId
        });
    }

    closeJoinRequest (userId: string): Promise<unknown> {
        return this.sendCommand(RPCCommands.CLOSE_ACTIVITY_JOIN_REQUEST, {
            user_id: userId
        });
    }

    createLobby (type: unknown, capacity: unknown, metadata: unknown): Promise<unknown> {
        return this.sendCommand(RPCCommands.CREATE_LOBBY, {
            type,
            capacity,
            metadata
        });
    }

    updateLobby (id: unknown, options: { type: unknown, owner: unknown, capacity: unknown, metadata: unknown }): Promise<unknown> {
        return this.sendCommand(RPCCommands.UPDATE_LOBBY, {
            id,
            ...options
        });
    }

    deleteLobby (id: unknown): Promise<unknown> {
        return this.sendCommand(RPCCommands.DELETE_LOBBY, {
            id
        });
    }

    connectToLobby (id: unknown, secret: string): Promise<unknown> {
        return this.sendCommand(RPCCommands.CONNECT_TO_LOBBY, {
            id,
            secret
        });
    }

    sendToLobby (id: unknown, data: unknown): Promise<unknown> {
        return this.sendCommand(RPCCommands.SEND_TO_LOBBY, {
            id,
            data
        });
    }

    disconnectFromLobby (id: unknown): Promise<unknown> {
        return this.sendCommand(RPCCommands.DISCONNECT_FROM_LOBBY, {
            id
        });
    }

    updateLobbyMember (lobbyId: unknown, userId: unknown, metadata: unknown): Promise<unknown> {
        return this.sendCommand(RPCCommands.UPDATE_LOBBY_MEMBER, {
            lobby_id: lobbyId,
            user_id: userId,
            metadata
        });
    }

    getRelationships (): Promise<unknown> {
        const types = Object.keys(RelationshipTypes);

        return this.sendCommand(RPCCommands.GET_RELATIONSHIPS, {})
            .then(response => response.relationships.map((relation: any) => ({
                ...relation,
                type: types[relation.type]
            })));
    }

    getVoiceSettings (): Promise<VoiceSettings> {
        return this.sendCommand(RPCCommands.GET_VOICE_SETTINGS, {})
            .then(result => {
                this.debugger(result);
                return togglePhraseInObject("camel", result as unknown as Record<any, any>) as VoiceSettings;
            });
    }

    setVoiceSettings (settings: VoiceSettings): Promise<unknown> {
        return this.sendCommand(RPCCommands.SET_USER_VOICE_SETTINGS, togglePhraseInObject("snake", settings));
    }

    clearActivity (pid = getPID()): Promise<unknown> {
        return this.sendCommand(RPCCommands.SET_ACTIVITY, {
            pid
        });
    }

    setActivity (activity: ActivityOptions, pid?: number): Promise<unknown> {
        return this.sendCommand(RPCCommands.SET_ACTIVITY, {
            pid: pid || getPID() || 1,
            activity: {
                state: activity.state,
                details: activity.details,
                timestamps: activity.timestamps,
                assets: togglePhraseInObject("snake", activity.assets || {}),
                party: activity.party ? {
                    id: activity.party.id,
                    size: [activity.party.size, activity.party.max]
                } : undefined,
                secrets: activity.secrets,
                instance: activity.instance
            }
        });
    }

    async destroy (): Promise<void> {
        await this.transport.close();
    }

    /**
     * Internal handling of RPC messages received
     * @param message
     * @returns {unknown}
     * @private
     */
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
            this.emit(message.evt as RPCEvent, message.data);
        }
    }
}


export default DiscordRPCClient;
