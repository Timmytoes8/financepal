import { buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import type { BuildTelegramMessageContextParams, TelegramMediaRef } from "./bot-message-context.js";

export const baseTelegramMessageContextConfig = {
  agents: { defaults: { model: "anthropic/claude-opus-4-5", workspace: "/tmp/openclaw" } },
  channels: { telegram: { dmPolicy: "open", allowFrom: ["*"] } },
  messages: { groupChat: { mentionPatterns: [] } },
} as never;

type TelegramTestSessionRuntime = NonNullable<BuildTelegramMessageContextParams["sessionRuntime"]>;

type BuildTelegramMessageContextForTestParams = {
  message: Record<string, unknown>;
  allMedia?: TelegramMediaRef[];
  options?: BuildTelegramMessageContextParams["options"];
  cfg?: Record<string, unknown>;
  accountId?: string;
  historyLimit?: number;
  groupHistories?: Map<string, import("openclaw/plugin-sdk/reply-history").HistoryEntry[]>;
  ackReactionScope?: BuildTelegramMessageContextParams["ackReactionScope"];
  botApi?: Record<string, unknown>;
  runtime?: BuildTelegramMessageContextParams["runtime"];
  sessionRuntime?: BuildTelegramMessageContextParams["sessionRuntime"] | null;
  resolveGroupActivation?: BuildTelegramMessageContextParams["resolveGroupActivation"];
  resolveGroupRequireMention?: BuildTelegramMessageContextParams["resolveGroupRequireMention"];
  resolveTelegramGroupConfig?: BuildTelegramMessageContextParams["resolveTelegramGroupConfig"];
};

const telegramMessageContextSessionRuntimeForTest = {
  buildChannelInboundEventContext,
  readSessionUpdatedAt: () => undefined,
  recordInboundSession: async () => undefined,
  resolveInboundLastRouteSessionKey: ({ route, sessionKey }) =>
    route.lastRoutePolicy === "main" ? route.mainSessionKey : sessionKey,
  resolvePinnedMainDmOwnerFromAllowlist: () => null,
  resolveStorePath: () => "/tmp/openclaw/session-store.json",
} satisfies NonNullable<BuildTelegramMessageContextParams["sessionRuntime"]>;

export async function buildTelegramMessageContextForTest(
  params: BuildTelegramMessageContextForTestParams,
): Promise<
  Awaited<ReturnType<typeof import("./bot-message-context.js").buildTelegramMessageContext>>
> {
  const { vi } = await loadVitestModule();
  const buildTelegramMessageContext = await loadBuildTelegramMessageContext();
  const sessionRuntime =
    params.sessionRuntime === null
      ? undefined
      : {
          ...telegramMessageContextSessionRuntimeForTest,
          ...params.sessionRuntime,
        };
  return await buildTelegramMessageContext({
    primaryCtx: {
      message: {
        message_id: 1,
        date: 1_700_000_000,
        text: "hello",
        from: { id: 42, first_name: "Alice" },
        ...params.message,
      },
      me: { id: 7, username: "bot" },
    } as never,
    allMedia: params.allMedia ?? [],
    storeAllowFrom: [],
    options: params.options ?? {},
    bot: {
      api: {
        sendChatAction: vi.fn(),
        setMessageReaction: vi.fn(),
        ...params.botApi,
      },
    } as never,
    cfg: (params.cfg ?? baseTelegramMessageContextConfig) as never,
    loadFreshConfig: () => (params.cfg ?? baseTelegramMessageContextConfig) as never,
    runtime: {
      recordChannelActivity: () => undefined,
      ...params.runtime,
    },
    sessionRuntime,
    account: { accountId: params.accountId ?? "default" } as never,
    historyLimit: params.historyLimit ?? 0,
    groupHistories: params.groupHistories ?? new Map(),
    dmPolicy: "open",
    allowFrom: ["*"],
    groupAllowFrom: [],
    ackReactionScope: params.ackReactionScope ?? "off",
    logger: { info: vi.fn() },
    resolveGroupActivation: params.resolveGroupActivation ?? (() => undefined),
    resolveGroupRequireMention: params.resolveGroupRequireMention ?? (() => false),
    resolveTelegramGroupConfig:
      params.resolveTelegramGroupConfig ??
      (() => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      })),
    sendChatActionHandler: { sendChatAction: vi.fn() } as never,
  });
}

let buildTelegramMessageContextLoader:
  | typeof import("./bot-message-context.js").buildTelegramMessageContext
  | undefined;
let vitestModuleLoader: Promise<typeof import("vitest")> | undefined;
let messageContextMocksInstalled = false;
let topicNameStoreTestFactoryInstalled = false;
const topicNameStoresForTest = new Map<
  string,
  Map<
    string,
    {
      name: string;
      iconColor?: number;
      iconCustomEmojiId?: string;
      closed?: boolean;
      updatedAt: number;
    }
  >
>();

async function loadBuildTelegramMessageContext() {
  await installMessageContextTestMocks();
  await installTopicNameStoreTestFactory();
  if (!buildTelegramMessageContextLoader) {
    ({ buildTelegramMessageContext: buildTelegramMessageContextLoader } =
      await import("./bot-message-context.js"));
  }
  return buildTelegramMessageContextLoader;
}

async function loadVitestModule() {
  vitestModuleLoader ??= import("vitest");
  return await vitestModuleLoader;
}

async function installTopicNameStoreTestFactory() {
  if (topicNameStoreTestFactoryInstalled) {
    return;
  }
  const { setTelegramTopicNameStoreFactoryForTest } = await import("./topic-name-cache.js");
  setTelegramTopicNameStoreFactoryForTest((namespace) => {
    let store = topicNameStoresForTest.get(namespace);
    if (!store) {
      store = new Map();
      topicNameStoresForTest.set(namespace, store);
    }
    return {
      register: async (key, value) => {
        store.set(key, value);
      },
      entries: async () => [...store.entries()].map(([key, value]) => ({ key, value })),
      delete: async (key) => store.delete(key),
      clear: async () => {
        store.clear();
      },
    };
  });
  topicNameStoreTestFactoryInstalled = true;
}

async function installMessageContextTestMocks() {
  if (messageContextMocksInstalled) {
    return;
  }
  messageContextMocksInstalled = true;
}
