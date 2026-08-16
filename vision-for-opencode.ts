// vision-for-opencode — self-contained opencode plugin: this single file is the
// whole product (the vision_describe_image tool plus the attachment
// rewrite). Copy it into your opencode plugins directory and restart —
// no config file is needed when the relay address is baked in below.
//
// Passing this file to a friend? Edit DEFAULT_SERVER_URL to your relay
// address first. A vision-for-opencode.config.jsonc file (working directory
// first, then ~/.config/vision-for-opencode/) still overrides it. Leave the
// constant empty and the plugin honestly reports "not configured" instead
// of failing with connection errors.
export const DEFAULT_SERVER_URL = ""

// The bearer token the vision relay expects on every request. When you run
// your own relay, set this to your relay's authToken.
export const AUTH_TOKEN = "f327f26533ceb0581b05eefe83287fc0087ee4fa2dd24ed6a88ad676d214a7be"

import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"
import { homedir, tmpdir } from "node:os"
import { tool, type Plugin } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"

export const SERVICE_NAME = "vision-for-opencode"
export const TOOL_NAME = "vision_describe_image"

const CAPABILITIES_TIMEOUT_MS = 5000

// --- plugin config ---

export class PluginConfigError extends Error {}

export class PluginNotConfiguredError extends PluginConfigError {}

export const CONFIG_FILENAME = "vision-for-opencode.config.jsonc"

export interface PluginConfig {
  serverUrl: string
}

export interface ReadPluginConfigOptions {
  cwd?: string
  home?: string
}

export function configFilePaths(options: ReadPluginConfigOptions = {}): string[] {
  return [
    join(options.cwd ?? process.cwd(), CONFIG_FILENAME),
    join(options.home ?? homedir(), ".config", "vision-for-opencode", CONFIG_FILENAME),
  ]
}

function stripComments(text: string): string {
  let out = ""
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1]!
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      out += "\n"
      continue
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      if (i < text.length) i++
      continue
    }
    out += ch
  }
  return out
}

function stripTrailingCommas(text: string): string {
  let out = ""
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1]!
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ",") {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      if (text[j] === "}" || text[j] === "]") continue
    }
    out += ch
  }
  return out
}

function stripJsonc(text: string): string {
  return stripTrailingCommas(stripComments(text))
}

export function readPluginConfig(options: ReadPluginConfigOptions = {}): PluginConfig {
  const paths = configFilePaths(options)
  let text: string | undefined
  let foundPath: string | undefined
  for (const path of paths) {
    let candidate: string
    try {
      candidate = readFileSync(path, "utf8")
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue
      throw new PluginConfigError(`cannot read config file "${path}": ${e instanceof Error ? e.message : String(e)}`)
    }
    text = candidate
    foundPath = path
    break
  }

  if (text === undefined || foundPath === undefined) {
    throw new PluginNotConfiguredError(
      `vision-for-opencode is not configured: no ${CONFIG_FILENAME} found in ${paths.join(" or ")}. ` +
        `Create one with a "serverUrl" entry pointing at the vision relay (see the vision-for-opencode README).`,
    )
  }

  let value: unknown
  try {
    value = JSON.parse(stripJsonc(text))
  } catch (e) {
    throw new PluginConfigError(
      `invalid JSONC in "${foundPath}": ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginConfigError(`config file "${foundPath}" must contain a JSON object`)
  }

  const raw = value as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (key !== "serverUrl") {
      console.error(`[vision-for-opencode] warning: unknown config key "${key}" in "${foundPath}" (ignored)`)
    }
  }

  const serverUrl = raw.serverUrl
  if (typeof serverUrl !== "string" || serverUrl.trim() === "") {
    throw new PluginConfigError(
      `"serverUrl" in "${foundPath}" must be a non-empty string, got ${JSON.stringify(serverUrl)}`,
    )
  }
  return { serverUrl: serverUrl.trim() }
}

export function resolveServerUrl(
  options: ReadPluginConfigOptions = {},
  defaultUrl: string = DEFAULT_SERVER_URL,
): string | undefined {
  try {
    return readPluginConfig(options).serverUrl
  } catch (e) {
    if (e instanceof PluginNotConfiguredError) {
      const baked = defaultUrl.trim()
      return baked === "" ? undefined : baked
    }
    throw e
  }
}

// --- relay request ---

export interface SenderResponse {
  status: number
  text: string
}

export type VisionSender = (url: string, body: string, timeoutMs: number, authToken?: string) => Promise<SenderResponse>

export async function fetchSender(url: string, body: string, timeoutMs: number, authToken?: string): Promise<SenderResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: authToken
        ? { "content-type": "application/json", authorization: `Bearer ${authToken}` }
        : { "content-type": "application/json" },
      body,
      signal: controller.signal,
    })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

// --- vision tool ---

export const REQUEST_TIMEOUT_MS = 120_000

export interface VisionToolArgs {
  images: string[]
  instruction?: string
}

export interface VisionToolContext {
  directory?: string
}

export interface VisionToolOptions {
  sender?: VisionSender
  home?: string
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
}

function isDataUri(ref: string): boolean {
  return ref.startsWith("data:")
}

function isUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref)
}

async function refToDataUri(ref: string, directory: string): Promise<string> {
  if (isDataUri(ref) || isUrl(ref)) return ref
  const filepath = resolve(directory, ref)
  if (!existsSync(filepath)) {
    throw new Error(`image file not found: "${ref}" (resolved to ${filepath})`)
  }
  try {
    const data = await readFile(filepath)
    const mime = MIME_BY_EXT[extname(filepath).toLowerCase()] ?? "application/octet-stream"
    return `data:${mime};base64,${data.toString("base64")}`
  } catch (e) {
    throw new Error(`cannot read image file "${ref}": ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function describeViaRelay(
  args: VisionToolArgs,
  context: VisionToolContext,
  options: VisionToolOptions = {},
): Promise<string> {
  const images = args.images
  if (
    !Array.isArray(images) ||
    images.length < 1 ||
    images.length > 4 ||
    !images.every((ref) => typeof ref === "string" && ref.length > 0)
  ) {
    return `${TOOL_NAME} expects "images" to be an array of 1 to 4 image references (a local file path, a URL, or a data URI).`
  }

  let serverUrl: string | undefined
  try {
    serverUrl = resolveServerUrl({ cwd: context.directory, home: options.home })
  } catch (e) {
    if (e instanceof PluginConfigError) return e.message
    return `cannot read the vision-for-opencode config: ${e instanceof Error ? e.message : String(e)}`
  }
  if (serverUrl === undefined) {
    return (
      `vision-for-opencode is not configured: no ${CONFIG_FILENAME} with a "serverUrl" entry was found ` +
      `and no relay address is baked into the plugin file. Create a config file or edit the ` +
      `DEFAULT_SERVER_URL constant at the top of the plugin file (see the vision-for-opencode README).`
    )
  }
  serverUrl = serverUrl.replace(/\/+$/, "")

  let refs: string[]
  try {
    refs = await Promise.all(images.map((ref) => refToDataUri(ref, context.directory ?? process.cwd())))
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }

  const instruction = args.instruction?.trim()
  const sender = options.sender ?? fetchSender
  let res: SenderResponse
  try {
    res = await sender(
      serverUrl,
      JSON.stringify({ images: refs, instruction: instruction || undefined }),
      REQUEST_TIMEOUT_MS,
      AUTH_TOKEN,
    )
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return `the vision relay at ${serverUrl} did not respond within ${REQUEST_TIMEOUT_MS}ms.`
    }
    return `cannot reach the vision relay at ${serverUrl}: ${e instanceof Error ? e.message : String(e)}`
  }

  if (res.status === 200) {
    let json: { meta?: unknown; description?: unknown } | undefined
    try {
      json = JSON.parse(res.text) as typeof json
    } catch {
      json = undefined
    }
    if (json && typeof json.meta === "string" && typeof json.description === "string") {
      return `${json.meta}\n\n${json.description}`
    }
    return `the vision relay at ${serverUrl} returned an unexpected response (HTTP 200).`
  }

  let error: string | undefined
  try {
    const parsed = JSON.parse(res.text) as { error?: unknown }
    if (typeof parsed.error === "string") error = parsed.error
  } catch {
    // not JSON, fall through to the raw body
  }
  if (error !== undefined) return error
  const brief = res.text.replace(/\s+/g, " ").trim().slice(0, 300) || "no error details provided"
  return `the vision relay at ${serverUrl} returned HTTP ${res.status}: ${brief}`
}

// --- attachment rewrite ---

export interface ModelCapability {
  id?: string
  providerID?: string
  capabilities?: { input?: { image?: boolean } }
}

export interface ProviderRecord {
  models?: Record<string, ModelCapability>
}

export function parseProviderList(payload: unknown): ProviderRecord[] | undefined {
  const maybe = Array.isArray(payload)
    ? payload
    : ((payload as { data?: unknown } | null | undefined)?.data ?? payload)
  const providers = Array.isArray(maybe)
    ? maybe
    : (maybe as { providers?: unknown } | null | undefined)?.providers
  if (!Array.isArray(providers)) return undefined
  return providers as ProviderRecord[]
}

export function buildCapabilityMap(providers: ProviderRecord[]): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const provider of providers) {
    for (const model of Object.values(provider.models ?? {})) {
      if (model.providerID && model.id) {
        map.set(`${model.providerID}/${model.id}`, model.capabilities?.input?.image ?? false)
      }
    }
  }
  return map
}

export interface ImagePartInfo {
  filename?: string
  mime: string
}

export interface RewriteDecision {
  canSeeImages: boolean | undefined
  toolAvailable: boolean
  toolName: string
}

export async function planImageRewrite(
  part: ImagePartInfo,
  decision: RewriteDecision,
  resolveFilepath: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (decision.canSeeImages !== false) return undefined

  const filepath = await resolveFilepath()
  const filename = part.filename ?? "image"
  const reference = filepath ? ` at ${filepath}` : ""
  const instruction = filepath
    ? decision.toolAvailable
      ? ` To see what this image shows, call the ${decision.toolName} tool with images: ["${filepath}"]`
      : ` No image-description tool is available in this project, so you cannot view this image. You may still use the file path if needed.`
    : ""

  return `[Attached image: "${filename}" (${part.mime})${reference}]${instruction}`
}

// --- data URI materialization ---

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
}

export interface DataUriFilePart {
  type: string
  url?: string
  mime?: string
  filename?: string
  id?: string
}

export interface MaterializeOptions {
  dir?: string
}

export async function materializeTemp(
  part: DataUriFilePart,
  messageID: string,
  options: MaterializeOptions = {},
): Promise<string | undefined> {
  if (part.type !== "file") return undefined
  const match = /^data:([^;]+);base64,(.*)$/s.exec(part.url ?? "")
  if (!match) return undefined
  const data = match[2]
  if (data === undefined) return undefined

  const ext =
    MIME_EXT[part.mime ?? ""] ??
    (part.filename ? extname(part.filename).replace(/^\./, "") : undefined) ??
    "bin"
  const dir = options.dir ?? join(tmpdir(), "opencode-vision")
  await mkdir(dir, { recursive: true })
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_")
  const filepath = join(dir, `${safe(messageID)}-${safe(part.id ?? "")}.${ext}`)
  if (!existsSync(filepath)) {
    await writeFile(filepath, Buffer.from(data, "base64"))
  }
  return filepath
}

// --- the plugin ---

export type VisionForOpencodeOptions = ReadPluginConfigOptions

export const VisionForOpencodePlugin: Plugin = async ({ client }, options?: VisionForOpencodeOptions) => {
  let imageCapable: Map<string, boolean> | undefined
  let toolAvailable = await isConfigured()

  async function isConfigured(): Promise<boolean> {
    try {
      return resolveServerUrl({ cwd: options?.cwd, home: options?.home }) !== undefined
    } catch {
      return false
    }
  }

  async function log(message: string, extra?: Record<string, unknown>) {
    try {
      await client.app.log({
        body: {
          service: SERVICE_NAME,
          level: "info",
          message,
          extra,
        },
      })
    } catch {}
  }

  async function loadCapabilities(): Promise<void> {
    try {
      const response = (await Promise.race([
        client.config.providers(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("provider list timed out")), CAPABILITIES_TIMEOUT_MS),
        ),
      ])) as unknown
      const providers = parseProviderList(response)
      if (!providers) {
        throw new Error("unexpected provider list shape")
      }
      imageCapable = buildCapabilityMap(providers)
      await log(`capabilities loaded: ${imageCapable.size} models`)
    } catch (error) {
      imageCapable = undefined
      await log("capabilities load failed", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    config: async () => {
      toolAvailable = await isConfigured()
    },
    tool: {
      [TOOL_NAME]: tool({
        description:
          "Describe one or more images using a vision model. Use this whenever you need to know what " +
          "an image shows — screenshots, photos, diagrams, UI mockups, error dialogs — because you " +
          "cannot view images yourself. Accepts local file paths, http(s) URLs, or base64 data URIs. " +
          "Returns image metadata (dimensions and name) followed by a detailed prose description. " +
          "Optionally pass an instruction to ask a specific question about the image(s).",
        args: {
          images: tool.schema
            .array(tool.schema.string())
            .min(1)
            .max(4)
            .describe("One to four image references: a local file path, an http(s) URL, or a base64 data URI."),
          instruction: tool.schema
            .string()
            .optional()
            .describe("Optional request or question to answer about the image(s)."),
        },
        execute: async (args, context) => {
          return describeViaRelay(args, { directory: context.directory }, { home: options?.home })
        },
      }),
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      const candidates: Array<{ msg: (typeof output.messages)[number]; info: { providerID: string; modelID: string }; id: string; indices: number[] }> = []
      for (const msg of output.messages) {
        const info = msg.info
        if (info.role !== "user" || !("model" in info) || !info.model) continue
        const indices: number[] = []
        msg.parts.forEach((part, i) => {
          if (part.type === "file" && part.mime.startsWith("image/")) indices.push(i)
        })
        if (indices.length > 0) candidates.push({ msg, info: info.model, id: info.id, indices })
      }
      if (candidates.length === 0) return

      if (imageCapable === undefined) {
        await loadCapabilities()
      }
      const capableMap = imageCapable
      if (capableMap === undefined) {
        await log("no capabilities, skipping")
        return
      }

      try {
        for (const { msg, info, id, indices } of candidates) {
          const key = `${info.providerID}/${info.modelID}`
          const capable = capableMap.get(key)

          for (const i of indices) {
            const part = msg.parts[i]
            if (!part || part.type !== "file") continue

            const text = await planImageRewrite(
              { filename: part.filename, mime: part.mime },
              { canSeeImages: capable, toolAvailable, toolName: TOOL_NAME },
              async () => {
                let filepath: string | undefined =
                  part.source?.type === "file" && part.source.path ? part.source.path : undefined
                if (!filepath || !existsSync(filepath)) {
                  filepath = await materializeTemp(part as Part, id)
                }
                return filepath
              },
            )
            if (text === undefined) continue

            msg.parts[i] = {
              id: part.id,
              sessionID: part.sessionID,
              messageID: part.messageID,
              type: "text",
              synthetic: true,
              text,
            }
          }
        }
      } catch (error) {
        await log("transform failed", { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

// opencode's loader requires a V1 default export (an object with `server`);
// named exports like DEFAULT_SERVER_URL would otherwise fail the legacy
// loader with "Plugin export is not a function".
export default {
  id: "vision-for-opencode",
  server: VisionForOpencodePlugin,
}
