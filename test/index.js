const rpc = require("../dist");

const client = new rpc.default({
    transport: "ipc",
    clientId: "609314057199288320",
    clientSecret: "_eD4ZX8jz_MGnOwbp2PqUnQZJq15a7P-",
    redirectUri: "http://localhost:6969/authorize",
    scopes: ["rpc", "rpc.api", "messages.read", "identify", "email", "connections", "guilds", "guilds.join", "gdm.join", "rpc.notifications.read"],
    accessToken: "dg38I8zRUv5BrH78v7NBFqtrlDOoSH"
});


console.log(client);

(async () => {
    client.on("ready", () => {
        console.log(`LOGGED IN!`);
    });

    await client.login("dg38I8zRUv5BrH78v7NBFqtrlDOoSH")
        .then(data => {
            console.log("Logged in!");

            client.subscribe("MESSAGE_UPDATE", {
                channel_id: "150074202727251969"
            }, message => {
                console.log(message);
            });
        });
})();
