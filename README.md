<p align="center" style="font-size: 26px">
  discord.rpc
</p>

***

<div align="center">
    <p>

[![NPM](https://img.shields.io/npm/v/discord.rpc.svg?maxAge=3600&style=flat-square)](https://npmjs.com/package/discord.rpc)
[![CircleCI](https://circleci.com/gh/Visualizememe/discord.rpc.svg?style=svg)](https://circleci.com/gh/Visualizememe/discord.rpc)
[![codecov](https://codecov.io/gh/Visualizememe/discord.rpc/branch/main/graph/badge.svg)](https://codecov.io/gh/Visualizememe/discord.rpc)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/9dee8c70dd8e402f9a2f97831b98a723)](https://www.codacy.com/gh/Visualizememe/discord.rpc/dashboard?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=Visualizememe/discord.rpc&amp;utm_campaign=Badge_Grade)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FVisualizememe%2Fdiscord.rpc.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FVisualizememe%2Fdiscord.rpc?ref=badge_shield)
[![Dependencies Status](https://status.david-dm.org/gh/Visualizememe/discord.rpc.svg)](https://david-dm.org/Visualizememe/discord.rpc)
</p>

<p>
<br/>
<a href="https://www.npmjs.com/package/discord.rpc"><img src="https://nodei.co/npm/discord.rpc.png?downloads=true&downloadRank=true&stars=true" alt="NPM Package"></a>
</p>
</div>

----

## Getting Started

discord.rpc has 3 dependencies:

- [**node-fetch**](https://www.npmjs.com/package/node-fetch) - To handle the HTTP requests
- [**ws**](https://www.npmjs.com/package/ws) - For sockets 😎
- [**tslib**](https://npmjs.com/package/tslib) Necessary with built TypeScript projects :)

Make sure you are able to install each one of these packages, as they are all vital to the functionality of this module!

### Installing

Installing discord.rpc is easy! Simply enter the following command, and you should be good to go👍

```
npm install discord.rpc --save
```

Installing the dependencies may take longer!

## Contributing

Please, before making an issue or pull request, please make sure you have done this already:

- **Made sure there are no similar issues / PRs like this** - if so, rather give them a comment!
- (Issues only) **Follow the style / template as shown in [example-issue]()** - Consistency works!

## Examples

Check out below for some examples of how to use discord.rpc!

```typescript
import { DiscordRPCClient } from "discord.rpc";

const client = new DiscordRPCClient({
    transport: "ipc",
    clientId: "abc",
    accessToken: "cba"
});

client.login()
    .then(async () => {
        await client.subscribe("MESSAGE_CREATE", {
            channel_id: "channelId"
        });
    
        client.on("MESSAGE_CREATE", data => {
            console.log(`New message: ${data.message.content}`);
        });
    });
```

---

## License

This project is licensed under the MIT License.

[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2FVisualizememe%2Fdiscord.rpc.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2FVisualizememe%2Fdiscord.rpc?ref=badge_large)
