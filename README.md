# vision-for-opencode

An [opencode](https://opencode.ai) plugin that lets models without vision (e.g. DeepSeek) see images. When the main model needs to know what an image shows, it calls the `vision_describe_image` tool, which sends the images to a **vision relay** — a small private server run by the person who gave you the relay address — which holds the API key and calls a vision model on the main model's behalf.

```
main model (no vision) ──vision_describe_image──▶ vision-for-opencode plugin ──HTTPS POST──▶ vision relay ──▶ vision model
        ▲                              (reads local files, zero deps)        (held privately by your friend)
        └──────────── metadata + prose description ◀──────────────────────────────────────────────────────────────────┘
```

**The relay is not in this repo.** This repo ships only the plugin, as a single self-contained file. The relay server lives in a private repo — ask the person who gave you the server address to host it.

## Install — for friends

Open opencode and say one sentence:

> 去 <GitHub 地址> 安装 vision-for-opencode 插件,并把服务器配置为 <服务器地址>

The agent reads this README, copies the plugin file, writes the config file, and tells you to restart opencode. After a restart, paste or drag a screenshot into chat — you'll get a note, and the model can call `vision_describe_image` to see it.

## Install — exact steps for the installing agent

You will be asked to "install the vision-for-opencode plugin from <this repo> and set the server to <address>". Do exactly this:

1. **Remove conflicting plugins if present** (they expose the same `vision_describe_image` tool): delete `image-metadata.ts` from the global plugin directory (`~/.config/opencode/plugins/`, on Windows `%USERPROFILE%\.config\opencode\plugins\`) and from the project's `.opencode/plugins/` if it exists there, and remove any MCP server named `vision` from the opencode config. Old installs also copied a `lib/` folder and `src/tool-identity.ts` — delete those leftovers too.
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

## The plugin's behavior contract (for the agent)

- The plugin hosts one tool, `vision_describe_image`, with arguments `images` (1–4 references: local file path, http(s) URL, or base64 data URI) and optional `instruction`. On success the tool result is one metadata line per image followed by a prose description. On failure — relay down, timeout, HTTP 4xx/5xx, malformed config — the result is readable text the model can relay to the user instead of inventing one.
- When a user pastes or drags an image into a non-vision session, the attachment is replaced with a note: the filename, a file path, and an instruction to call `vision_describe_image` (or a warning that no tool is available when the relay is not configured). Sessions with a vision-capable model are left untouched.

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

## For the relay owner

The `DEFAULT_SERVER_URL` constant at the top of `vision-for-opencode.ts` is empty in this public copy — **keep it that way**: never commit a real relay address to this repo. If you want to hand a friend a preconfigured file, edit the constant in a private copy and send that one file. The config file still overrides the baked-in address, so friends can re-point the plugin later without a new file.
