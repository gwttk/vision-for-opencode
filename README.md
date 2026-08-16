# vision-for-opencode

An [opencode](https://opencode.ai) plugin that lets models without vision see images. Paste or drag a screenshot into chat and the model can look at it through the `vision_describe_image` tool — no API key or extra software needed on your machine.

## Install — for friends

Open opencode and say one sentence:

> 去 https://github.com/gwttk/vision-for-opencode 安装 vision-for-opencode 插件,并把服务器配置为 <服务器地址>

The agent reads this README, copies the plugin file, writes the config file, and tells you to restart opencode. After a restart, paste or drag a screenshot into chat — you'll get a note, and the model can call `vision_describe_image` to see it.

## Install — exact steps for the installing agent

You will be asked to "install the vision-for-opencode plugin from <this repo> and set the server to <address>". Do exactly this:

1. **Remove conflicting plugins if present** (they provide the same `vision_describe_image` tool): delete `image-metadata.ts` from the global plugin directory (`~/.config/opencode/plugins/`, on Windows `%USERPROFILE%\.config\opencode\plugins\`) and from the project's `.opencode/plugins/` if it exists there, and remove any MCP server named `vision` from the opencode config.
2. **Copy one file from this repo** into the global plugin directory, keeping the same name:
   - `vision-for-opencode.ts` → `<plugins-dir>/vision-for-opencode.ts`
   - The plugin is self-contained: no other files are needed.
3. **Write the config file.** Create `~/.config/vision-for-opencode/vision-for-opencode.config.jsonc` (on Windows: `%USERPROFILE%\.config\vision-for-opencode\vision-for-opencode.config.jsonc`), creating the directory if needed:
   ```jsonc
   {
     "serverUrl": "<the server address you were given>"
   }
   ```
   The only key is `serverUrl`. A project-local file named `vision-for-opencode.config.jsonc` in the working directory takes precedence.
4. **Tell the user to restart opencode**, and that they can now paste screenshots and ask the model to describe images.

Do not edit `opencode.json`, do not register an MCP server, and do not run `npm install` — none of that is part of this product.

## AGENTS.md snippet

Put this in a project's `AGENTS.md` so the model reaches for the tool automatically:

```md
When you need to know what an image shows (screenshots, photos, diagrams,
UI mockups, error dialogs), use the `vision_describe_image` tool. You can
ask a specific question via its `instruction` argument.
```

## Configuration reference

| File | Location | Keys |
| ---- | -------- | ---- |
| Plugin config | `vision-for-opencode.config.jsonc` (working dir first, then `~/.config/vision-for-opencode/`) | `serverUrl` only |
