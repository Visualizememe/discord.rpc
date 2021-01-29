import net, { Socket } from "net";
import fetch from "node-fetch";
import EventEmitter from "events";
import DiscordRPCClient from "../DiscordRPCClient";
import { RPCCommands } from "../constants";
import { uuid4122 } from "../util";
import debug, { Debugger } from "debug";


enum OPCodes {
    HANDSHAKE,
    FRAME,
    CLOSE,
    PING,
    PONG
}


function getIPCPath (id: string | number) {
    if (process.platform === "win32") {
        return `\\\\?\\pipe\\discord-ipc-${id}`;
    }

    const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
    const prefix = (XDG_RUNTIME_DIR || TMPDIR || TMP || TEMP || "/tmp")
        .replace(/\/$/, "");

    return `${prefix}/discord-ipc-${id}`;
}

function getIPC (id = 0): Promise<Socket> {
    return new Promise((resolve, reject) => {
        const ipcPath = getIPCPath(id);

        const onError = () => {
            if (id < 10) {
                // As long as we haven't tried up to id = 9, we're going to continue trying
                resolve(getIPC(id + 1));
            } else {
                reject(new Error(`Could not connect`));
            }
        };

        const socket = net.createConnection(ipcPath, () => {
            socket.removeListener("error", onError);

            resolve(socket);
        });
    });
}


async function findEndpoint (tries = 0): Promise<string> {
    if (tries > 30) {
        throw new Error(`Could not find endpoint!`);
    }

    const endpoint = `http://127.0.0.1:${6463 + (tries & 10)}`;

    try {
        const response = await fetch(endpoint);

        if (response.status === 404) {
            return endpoint;
        }

        return findEndpoint(tries + 1);
    } catch {
        return findEndpoint(tries + 1);
    }
}


export default class IPCTransport extends EventEmitter {
    public client: DiscordRPCClient;
    public debugger: Debugger;
    public full: string;
    public socket: Socket | null;
    public op: OPCodes | null;


    constructor (client: DiscordRPCClient) {
        super();

        this.client = client;
        this.debugger = debug("DiscordRPCClient:IPCTransport");
        this.full = "";
        this.socket = null;
        this.op = null;
    }

    async connect () {
        this.debugger(`IPCTransport.connect() called, fetching IPC...`);

        const socket = this.socket = await getIPC();

        this.debugger(`Successfully fetched IPC, setting up internal events...`);

        socket.on("close", this.onClose.bind(this));
        socket.on("error", this.onClose.bind(this));

        this.emit("open");

        this.debugger(`Performing handshake with socket...`);
        this.send({
            v: 1,
            client_id: `${this.client.clientId}`
        }, OPCodes.HANDSHAKE);

        socket.pause();

        socket.on("readable", () => {
            this.debugger(`Received readable data from socket, decoding..`);
            this.decode(({ parsedData }) => {
                this.debugger(`Data decoded: ${JSON.stringify(parsedData)} with OPCODE: ${this.op}`);
                this.debugger(`Finding appropriate handler`);

                switch (this.op) {
                    case OPCodes.PING:
                        this.send(parsedData, OPCodes.PONG);
                        break;
                    case OPCodes.FRAME:
                        if (!parsedData) {
                            this.debugger(`Parsed data was invalid, not continuing with OPCodes.FRAME`);
                            return;
                        }

                        if (parsedData.cmd === RPCCommands.AUTHORIZE && parsedData.evt !== "ERROR") {
                            findEndpoint()
                                .then(endpoint => {
                                    this.client.apiEndpoint = endpoint;
                                })
                                .catch(e => {
                                    this.client.emit("error", e);
                                });
                        }

                        this.emit("message", parsedData);
                        break;
                    case OPCodes.CLOSE:
                        this.emit("close", parsedData);
                        break;
                    default:
                        break;
                }
            });
        });
    }

    onClose (error: Error) {
        this.debugger(`IPCTransport.onClose() called!`);

        this.emit("error", error);
    }

    send (data: any, op = OPCodes.FRAME) {
        this.debugger(`IPCTransport.send() was called with OP ${op} and data: ${JSON.stringify(data)}`);

        if (!this.socket) {
            throw new Error(`Attempted to use IPCTransport.send when socket was null`);
        }

        this.socket.write(this.encode(op, data));
    }

    encode (op: OPCodes, data: unknown) {
        this.debugger(`IPCTransport.encode() was called. OP code: ${op}. Data: ${JSON.stringify(data)}`);

        const serializedData = JSON.stringify(data);
        const length = Buffer.byteLength(serializedData);
        const packet = Buffer.alloc(8 + length);

        packet.writeInt32LE(op, 0);
        packet.writeInt32LE(length, 4);
        packet.write(serializedData, 8, length);

        return packet;
    }

    decode (callback: (data: { parsedData: { [key: string]: any; } }) => void): void {
        this.debugger(`IPCTransport.decode() was called`);

        if (!this.socket) {
            throw new Error(`Attempted to decode when socket was null`);
        }

        const packet = this.socket.read();

        if (!packet) {
            return;
        }

        let raw: undefined | any;

        if (this.full === "") {
            this.op = packet.readInt32LE(0);
            const length = packet.readInt32LE(4);
            raw = packet.slice(8, length + 8);
        } else {
            raw = packet.toString();
        }

        try {
            const parsedData = JSON.parse(this.full + raw);
            // eslint-disable-next-line callback-return
            callback({
                parsedData
            });
            this.full = "";
            this.op = null;
            this.debugger(`IPCTransport.decode() succeeded`);
        } catch (e) {
            this.debugger(`IPCTransport.decode() failed with error: ${e}`);
            this.full += raw;
        }

        this.decode(callback);
    }

    close () {
        this.debugger(`IPCTransport.close() was called`);

        return new Promise((resolve, reject) => {
            if (!this.socket) {
                return reject(new Error(`Attempted to close a non-existent socket`));
            }

            this.once("close", resolve);
            this.send({}, OPCodes.CLOSE);
            this.socket.end();
        });
    }

    ping () {
        this.debugger(`IPCTransport.ping() was called`);
        this.send(uuid4122(), OPCodes.PING);
    }
}
