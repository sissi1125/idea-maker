import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEAT_200_DDL_BLOCKS } from "../schema";

const poolMock = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  connect: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    constructor(config: Record<string, unknown>) {
      poolMock.configs.push(config);
    }

    connect = poolMock.connect;
    end = poolMock.end;
    on = poolMock.on;
  },
}));

import { DbService } from "../db.service";

describe("DbService pg.Pool", () => {
  const originalEnv = { ...process.env };
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };

  beforeEach(() => {
    vi.clearAllMocks();
    poolMock.configs.length = 0;
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_POOL_IDLE_TIMEOUT_MS;
    delete process.env.DB_POOL_CONNECTION_TIMEOUT_MS;
    delete process.env.DB_APPLICATION_NAME;
    query.mockResolvedValue({ rows: [] });
    poolMock.connect.mockResolvedValue(client);
    poolMock.end.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("多个请求只创建一个 Pool，并在每次查询后归还连接", async () => {
    const db = new DbService();

    await db.withClient((pg) => pg.query("SELECT 1"));
    await db.withClient((pg) => pg.query("SELECT 2"));

    expect(poolMock.configs).toHaveLength(1);
    expect(poolMock.connect).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(poolMock.end).not.toHaveBeenCalled();

    await db.onModuleDestroy();
    expect(poolMock.end).toHaveBeenCalledTimes(1);
  });

  it("并发首请求共享同一次 DDL 初始化", async () => {
    const db = new DbService();

    await Promise.all([
      db.withClient((pg) => pg.query("SELECT 'a'")),
      db.withClient((pg) => pg.query("SELECT 'b'")),
    ]);

    // vector extension + 每个 DDL block 只跑一次，之后才执行两个业务查询。
    expect(query).toHaveBeenCalledTimes(FEAT_200_DDL_BLOCKS.length + 3);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("业务查询失败也会归还连接", async () => {
    const db = new DbService();
    const failure = new Error("query failed");

    await expect(
      db.withClient(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("queryClient 每条查询独立借还连接，长流程不会占住 Pool slot", async () => {
    const db = new DbService();
    const shared = db.queryClient();

    await shared.query("SELECT 1");
    await shared.query("SELECT 2");

    expect(poolMock.connect).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("读取连接池环境变量并对非法值使用安全默认值", async () => {
    process.env.DB_POOL_MAX = "6";
    process.env.DB_POOL_IDLE_TIMEOUT_MS = "invalid";
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS = "2500";
    process.env.DB_APPLICATION_NAME = "idea-maker-test";
    const db = new DbService();

    await db.withClient((pg) => pg.query("SELECT 1"));

    expect(poolMock.configs[0]).toMatchObject({
      max: 6,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_500,
      application_name: "idea-maker-test",
    });
  });

  it("DATABASE_URL 缺失时不创建 Pool", async () => {
    delete process.env.DATABASE_URL;
    const db = new DbService();

    await expect(db.withClient((pg) => pg.query("SELECT 1"))).rejects.toThrow(
      "数据库未配置",
    );
    expect(poolMock.configs).toHaveLength(0);
  });
});
