export let register: any;

try {
    const { app } = require("electron");
    register = app.setAsDefaultProtocolClient.bind(app);
} catch {
    try {
        register = require("register-scheme");
        // eslint-disable-next-line no-empty
    } catch {

    }
}

export function getPID (): number | null {
    return typeof process !== "undefined" ? process.pid : null;
}

export function uuid4122 (): string {
    let createdUUID = "";

    for (let i = 0; i < 32; i += 1) {
        if (i === 8 || i === 12 || i === 20) {
            createdUUID += "-";
        }

        let n: undefined | number;

        if (i === 12) {
            n = 4;
        } else {
            const random = Math.random() * 16 | 0;

            if (i === 16) {
                n = (random & 3) | 0;
            } else {
                n = random;
            }
        }

        createdUUID += n.toString(16);
    }

    return createdUUID;
}
