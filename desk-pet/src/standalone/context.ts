/**
 * desk-pet 的伪宿主上下文（ctx）—— 宿主半边（`src/host/index.ts` 的 `apply`）跑在它上面。
 *
 * 宿主半边把路由表、配置聚合、状态仓、桌面 Helper 与 bridge 管道全写好了，对外只要求一个
 * 很小的 `ctx`：`effect`（注册 + 收集释放函数）、`on`（订阅事件）、`webServer`（注册路由、
 * 读端口）、`logger`、`agentDefaultModel` 与 `llm`。本文件把它们落成实物：
 *   - `webServer.register` 收集路由，由 `./server` 接到真正的 `node:http` 服务上；
 *   - `on` 是本地事件总线：Claude Code 的 hook 经 `./claude-code` 翻译成 `session/event`
 *     后由 `emit` 投递进来，工作状态逻辑因此只认一种事件形状；
 *   - `llm` / `model` 由调用方注入（CLI 里是 `./claude-llm` 的 `claude -p` 后端）；
 *     不注入时生成入口"迭代即失败"，碎碎念/对话得到结构化失败而不是崩溃（测试用）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** 未注入模型时 `agentDefaultModel.currentSelection()` 报出的服务商 id（model 为空 → 不调用模型） */
export const STANDALONE_PROVIDER = 'standalone';

/** 日志接口（与宿主半边对 `ctx.logger` 的使用面一致） */
export interface StandaloneLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** 宿主半边注册到 `ctx.webServer` 的一条路由（`./server` 按它匹配请求） */
export interface RegisteredRoute {
  /** `prefix`（插件当前只用这一种）或 `exact`，原样透传 */
  kind: string;
  /** 路由路径，例如 `/desk-pet`；`./server` 按它匹配，不自己硬编码前缀 */
  path: string;
  /** 真实 Node HTTP handler：自己写响应头与 body */
  handler: (req: IncomingMessage, res: ServerResponse) => unknown;
}

export interface StandaloneContextOptions {
  /** 宿主用它拼桌面 Helper 的 `DESK_PET_CONFIG_URL`；传函数可拿到"监听后才确定"的端口 */
  port: number | (() => number);
  logger: StandaloneLogger;
  /** 注入路由收集数组（CLI 先起服务拿到端口，再 `apply`，两者共用同一个数组） */
  routes?: RegisteredRoute[];
  /** `ctx.llm`（缺省 = 没有模型后端的替身）；形状见 `./claude-llm` */
  llm?: Record<string, unknown>;
  /** `agentDefaultModel.currentSelection()` 的返回值（缺省 = 未配置模型的 {@link STANDALONE_PROVIDER}） */
  model?: { provider: string; model: string };
}

export interface StandaloneContext {
  /** 交给 `apply()` 的伪 ctx */
  ctx: Record<string, unknown>;
  /** `apply()` 期间注册的路由（按注册顺序） */
  routes: RegisteredRoute[];
  /** 初始化期间被记录下来的异常（每项都已打了日志，不影响其余部分） */
  failures: string[];
  /** 向 `ctx.on(name, ...)` 的订阅者投递一条事件（单个订阅者抛错只记日志，不影响其他订阅者） */
  emit(name: string, ...args: unknown[]): void;
  /** 释放全部 effect：停桌面 Helper、清掉周期定时器 */
  dispose(): Promise<void>;
}

/** 默认日志器：直接写控制台 */
export function createStandaloneLogger(): StandaloneLogger {
  const stamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const write = (level: string, message: string): void => {
    console.log(`[desk-pet ${stamp()}] ${level} ${message}`);
  };
  return {
    info: (message) => write('INFO ', message),
    warn: (message) => write('WARN ', message),
    error: (message) => write('ERROR', message),
    debug: (message) => {
      if (process.env.DESK_PET_DEBUG === '1') write('DEBUG', message);
    },
  };
}

/**
 * 建一个伪 ctx。
 * @param options 端口（或端口取值函数）、日志器与可选的路由收集数组
 * @returns 伪 ctx、路由列表、初始化失败记录与释放函数
 */
export function createStandaloneContext(options: StandaloneContextOptions): StandaloneContext {
  const { logger } = options;
  const routes = options.routes ?? [];
  const failures: string[] = [];
  /** effect 释放函数（后注册先释放） */
  const disposers: Array<() => unknown> = [];
  let disposed = false;
  /** 事件总线：事件名 → 订阅者（插件用 `ctx.on` 订阅，调用方用 `emit` 投递） */
  const listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();

  const portOf = (): number => (typeof options.port === 'function' ? options.port() : options.port);

  const webServer = {
    /** 读取时取值：服务先监听、端口确定后才 apply，插件在 launchHelper 里读到的就是真端口 */
    get port(): number {
      return portOf();
    },
    register(spec: RegisteredRoute): () => void {
      routes.push({ kind: spec.kind, path: spec.path, handler: spec.handler });
      return () => {
        const index = routes.findIndex((route) => route.handler === spec.handler);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  };

  const context: Record<string, unknown> = {
    /**
     * 跑一次注册函数并收集它返回的释放函数。
     * 单项失败只记录 + 打日志，不让整个宿主起不来（源码形态下包内 assets 不可达时，正是这里会抛）。
     */
    effect(fn: () => unknown): unknown {
      try {
        const dispose = fn();
        if (typeof dispose === 'function') disposers.push(dispose as () => unknown);
        return dispose;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(message);
        logger.error(`初始化某项失败（已跳过）：${message}`);
        return undefined;
      }
    },
    /** 订阅事件，返回取消订阅函数；事件由 `emit` 投递（见文件头） */
    on(name: string, listener: (...args: unknown[]) => unknown): () => void {
      if (typeof listener !== 'function') return () => {};
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener);
      return () => {
        listeners.get(name)?.delete(listener);
      };
    },
    logger,
    webServer,
    agentDefaultModel: {
      currentSelection: (): { provider: string; model: string } =>
        options.model ? { ...options.model } : { provider: STANDALONE_PROVIDER, model: '' },
    },
    llm: options.llm ?? {
      listProviders: (): unknown[] => [],
      listModels: async (): Promise<unknown[]> => [],
      resolveModelInfo: async (): Promise<undefined> => undefined,
      // 必须是 AsyncIterable（调用方一律 for await 消费）：错误在首次 next() 时抛出，落进调用方的
      // try/catch。写成 `async () => { throw }` 会返回 Promise，for await 立刻 TypeError 且留下
      // 无人接管的 rejection（0.3.4 的崩溃根因）。不用 async function*：只 throw 不 yield 过不了 eslint。
      stream: (): AsyncIterable<never> => ({
        [Symbol.asyncIterator](): AsyncIterator<never> {
          return {
            next: async (): Promise<IteratorResult<never>> => {
              throw new Error('desk-pet: 未接入模型（碎碎念/对话不可用）');
            },
          };
        },
      }),
    },
  };

  return {
    ctx: context,
    routes,
    failures,
    emit(name: string, ...args: unknown[]): void {
      for (const listener of [...(listeners.get(name) ?? [])]) {
        try {
          const result = listener(...args);
          if (result instanceof Promise) {
            result.catch((error: unknown) => {
              logger.warn(`事件 ${name} 的订阅者失败：${error instanceof Error ? error.message : String(error)}`);
            });
          }
        } catch (error) {
          logger.warn(`事件 ${name} 的订阅者失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          await dispose();
        } catch (error) {
          logger.warn(`释放某项失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}
