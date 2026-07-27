import { JobStatus, JobType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  loadSource: vi.fn(),
  prepareInput: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  conversationFind: vi.fn(),
  activeJobFind: vi.fn(),
  outsideActiveJobFind: vi.fn(),
  analysisFind: vi.fn(),
  analysisUpsert: vi.fn(),
  analysisUpdate: vi.fn(),
  latestAnalysisFind: vi.fn(),
  enqueueInTransaction: vi.fn(),
  serializeJob: vi.fn(),
  logJobEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/config", () => ({
  getConversationAnalysisConfig: mocks.getConfig,
}));
vi.mock("./prepare-input", () => ({
  loadConversationAnalysisSource: mocks.loadSource,
  prepareConversationInput: mocks.prepareInput,
}));
vi.mock("@/lib/jobs/service", () => ({
  enqueueJobInTransaction: mocks.enqueueInTransaction,
  serializeConversationAnalysisJob: mocks.serializeJob,
}));
vi.mock("@/lib/jobs/logging", () => ({
  logJobEvent: mocks.logJobEvent,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    job: { findFirst: mocks.outsideActiveJobFind },
    conversationAnalysis: { findFirst: mocks.latestAnalysisFind },
  },
}));

import {
  enqueueConversationAnalysisJob,
  latestSuccessfulConversationAnalysisAt,
  reconcileConversationAnalysisAfterTerminalFailure,
  setConversationIntelligencePreference,
} from "./job-service";

const ownerId = "owner-a";
const conversationId = "conversation-a";
const queuedAt = new Date("2026-07-27T20:00:00.000Z");

const queuedJob = {
  id: "job-a",
  ownerId,
  type: JobType.CONVERSATION_ANALYSIS,
  status: JobStatus.PENDING,
  payload: {
    conversationId,
    trigger: "GMAIL_IMPORT",
    force: false,
    analysisVersion: "conversation-v1",
  },
  result: null,
  progress: {
    phase: "QUEUED",
    processed: 0,
    message: "Analysis queued.",
  },
  attemptCount: 0,
  maxAttempts: 3,
  availableAt: queuedAt,
  lockedAt: null,
  lockedBy: null,
  heartbeatAt: null,
  startedAt: null,
  completedAt: null,
  failedAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  idempotencyKey: conversationId,
  createdAt: queuedAt,
  updatedAt: queuedAt,
};

const prepared = {
  text: "Subject: Estimate\n\nM1: Please send an estimate.",
  contentHash: "hash-current",
  inputTruncated: false,
  sourceMessageCount: 1,
  includedMessageCount: 1,
  hasMeaningfulContent: true,
};

function transactionClient() {
  return {
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
    user: {
      findUnique: mocks.userFind,
      updateMany: mocks.userUpdate,
    },
    conversation: { findFirst: mocks.conversationFind },
    job: { findFirst: mocks.activeJobFind },
    conversationAnalysis: {
      findUnique: mocks.analysisFind,
      upsert: mocks.analysisUpsert,
      updateMany: mocks.analysisUpdate,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockReturnValue({
    apiKey: "configured",
    model: "configured-model",
    maxInputChars: 60_000,
    requestTimeoutMs: 45_000,
    analysisVersion: "conversation-v1",
  });
  mocks.loadSource.mockResolvedValue({
    subject: "Estimate",
    leadId: "lead-a",
    messages: [],
  });
  mocks.prepareInput.mockReturnValue(prepared);
  mocks.executeRaw.mockResolvedValue(1);
  mocks.queryRaw.mockResolvedValue([]);
  mocks.userFind.mockResolvedValue({
    conversationIntelligenceEnabled: true,
  });
  mocks.userUpdate.mockResolvedValue({ count: 1 });
  mocks.conversationFind.mockResolvedValue({
    id: conversationId,
    leadId: "lead-a",
  });
  mocks.activeJobFind.mockResolvedValue(null);
  mocks.outsideActiveJobFind.mockResolvedValue(null);
  mocks.analysisFind.mockResolvedValue(null);
  mocks.analysisUpsert.mockResolvedValue({ id: "analysis-a" });
  mocks.analysisUpdate.mockResolvedValue({ count: 0 });
  mocks.latestAnalysisFind.mockResolvedValue(null);
  mocks.enqueueInTransaction.mockResolvedValue({
    kind: "queued",
    job: queuedJob,
  });
  mocks.serializeJob.mockImplementation((job) => ({
    id: job.id,
    type: "CONVERSATION_ANALYSIS",
    status: job.status,
    active: true,
  }));
  mocks.transaction.mockImplementation(async (operation) =>
    operation(transactionClient()),
  );
});

describe("conversation analysis eligibility and owner isolation", () => {
  it("short-circuits when the owner preference is disabled", async () => {
    mocks.userFind.mockResolvedValueOnce({
      conversationIntelligenceEnabled: false,
    });

    await expect(
      enqueueConversationAnalysisJob({
        ownerId,
        conversationId,
        trigger: "GMAIL_IMPORT",
      }),
    ).resolves.toEqual({ kind: "disabled" });

    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();
    expect(mocks.analysisUpsert).not.toHaveBeenCalled();
  });

  it("does not backfill or enqueue work merely because the preference is enabled", async () => {
    await expect(
      setConversationIntelligencePreference(ownerId, true, queuedAt),
    ).resolves.toEqual({
      enabled: true,
      cancelled: 0,
      cancellationRequested: 0,
    });

    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: ownerId },
      data: { conversationIntelligenceEnabled: true },
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();
    expect(mocks.conversationFind).not.toHaveBeenCalled();
  });

  it("skips an unlinked automatic analysis but permits explicit manual analysis", async () => {
    mocks.conversationFind.mockResolvedValue({
      id: conversationId,
      leadId: null,
    });

    await expect(
      enqueueConversationAnalysisJob({
        ownerId,
        conversationId,
        trigger: "GMAIL_IMPORT",
      }),
    ).resolves.toEqual({ kind: "unlinked" });
    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();

    await expect(
      enqueueConversationAnalysisJob({
        ownerId,
        conversationId,
        trigger: "MANUAL_REANALYSIS",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "queued",
        job: expect.objectContaining({ id: queuedJob.id }),
      }),
    );
    expect(mocks.enqueueInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        payload: expect.objectContaining({
          conversationId,
          trigger: "MANUAL_REANALYSIS",
          force: true,
        }),
      }),
      expect.any(Object),
    );
  });

  it("returns not-found before queueing for a foreign or missing conversation", async () => {
    mocks.loadSource.mockResolvedValueOnce(null);

    await expect(
      enqueueConversationAnalysisJob({
        ownerId,
        conversationId: "foreign-conversation",
        trigger: "MANUAL_REANALYSIS",
      }),
    ).resolves.toEqual({ kind: "not-found" });

    expect(mocks.loadSource).toHaveBeenCalledWith(
      ownerId,
      "foreign-conversation",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it("rechecks conversation ownership inside the enqueue transaction", async () => {
    mocks.conversationFind.mockResolvedValueOnce(null);

    await expect(
      enqueueConversationAnalysisJob({
        ownerId,
        conversationId,
        trigger: "MANUAL_REANALYSIS",
      }),
    ).resolves.toEqual({ kind: "not-found" });

    expect(mocks.conversationFind).toHaveBeenCalledWith({
      where: { id: conversationId, ownerId },
      select: { id: true, leadId: true },
    });
    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();
  });
});

describe("conversation analysis idempotency", () => {
  it("reuses an existing active job before checking unchanged content", async () => {
    mocks.activeJobFind.mockResolvedValueOnce({
      ...queuedJob,
      status: JobStatus.RUNNING,
    });
    mocks.analysisFind.mockResolvedValueOnce({
      status: "COMPLETED",
      contentHash: prepared.contentHash,
      analysisVersion: "conversation-v1",
    });

    const result = await enqueueConversationAnalysisJob({
      ownerId,
      conversationId,
      trigger: "MANUAL_REANALYSIS",
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "existing",
        job: expect.objectContaining({ id: queuedJob.id }),
      }),
    );
    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it("repeated manual clicks reuse the one active job", async () => {
    mocks.activeJobFind
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...queuedJob,
        status: JobStatus.PENDING,
      });

    const first = await enqueueConversationAnalysisJob({
      ownerId,
      conversationId,
      trigger: "MANUAL_REANALYSIS",
    });
    const second = await enqueueConversationAnalysisJob({
      ownerId,
      conversationId,
      trigger: "MANUAL_REANALYSIS",
    });

    expect(first.kind).toBe("queued");
    expect(second.kind).toBe("existing");
    expect(mocks.enqueueInTransaction).toHaveBeenCalledTimes(1);
  });

  it("skips unchanged automatic content with the same analysis version", async () => {
    mocks.analysisFind.mockResolvedValueOnce({
      status: "COMPLETED",
      contentHash: prepared.contentHash,
      analysisVersion: "conversation-v1",
    });

    await expect(
      enqueueConversationAnalysisJob({
        ownerId,
        conversationId,
        trigger: "GMAIL_IMPORT",
      }),
    ).resolves.toEqual({ kind: "unchanged" });

    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "changed content",
      current: {
        status: "COMPLETED",
        contentHash: "hash-before-change",
        analysisVersion: "conversation-v1",
      },
      trigger: "GMAIL_IMPORT" as const,
      force: false,
    },
    {
      name: "a new analysis version",
      current: {
        status: "COMPLETED",
        contentHash: prepared.contentHash,
        analysisVersion: "conversation-v0",
      },
      trigger: "GMAIL_IMPORT" as const,
      force: false,
    },
    {
      name: "forced manual reanalysis",
      current: {
        status: "COMPLETED",
        contentHash: prepared.contentHash,
        analysisVersion: "conversation-v1",
      },
      trigger: "MANUAL_REANALYSIS" as const,
      force: true,
    },
  ])("queues $name", async ({ current, trigger, force }) => {
    mocks.analysisFind.mockResolvedValueOnce(current);

    const result = await enqueueConversationAnalysisJob({
      ownerId,
      conversationId,
      trigger,
      force,
    });

    expect(result.kind).toBe("queued");
    expect(mocks.enqueueInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: conversationId,
        payload: {
          conversationId,
          trigger,
          force,
          analysisVersion: "conversation-v1",
        },
      }),
      expect.any(Object),
    );
  });

  it("stores a bounded skipped state and creates no job for empty content", async () => {
    mocks.prepareInput.mockReturnValueOnce({
      ...prepared,
      text: "",
      contentHash: "empty-hash",
      sourceMessageCount: 2,
      includedMessageCount: 0,
      hasMeaningfulContent: false,
    });

    await expect(
      enqueueConversationAnalysisJob({
        ownerId,
        conversationId,
        trigger: "GMAIL_IMPORT",
      }),
    ).resolves.toEqual({ kind: "no-content" });

    expect(mocks.enqueueInTransaction).not.toHaveBeenCalled();
    expect(mocks.analysisUpsert).toHaveBeenCalledWith({
      where: {
        conversationId_ownerId: { conversationId, ownerId },
      },
      create: expect.objectContaining({
        ownerId,
        conversationId,
        status: "SKIPPED",
        contentHash: "empty-hash",
        analysisVersion: "conversation-v1",
        lastErrorCode: "AI_NO_CONTENT",
      }),
      update: expect.objectContaining({
        status: "SKIPPED",
        lastErrorCode: "AI_NO_CONTENT",
      }),
    });
  });

  it("queues a successor only when content changed during a terminally failed job", async () => {
    await expect(
      reconcileConversationAnalysisAfterTerminalFailure(
        ownerId,
        conversationId,
        prepared.contentHash,
      ),
    ).resolves.toEqual({ kind: "unchanged" });
    expect(mocks.transaction).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const changed = {
      ...prepared,
      contentHash: "hash-after-new-message",
    };
    mocks.getConfig.mockReturnValue({
      apiKey: "configured",
      model: "configured-model",
      maxInputChars: 60_000,
      requestTimeoutMs: 45_000,
      analysisVersion: "conversation-v1",
    });
    mocks.loadSource.mockResolvedValue({
      subject: "Estimate",
      leadId: "lead-a",
      messages: [],
    });
    mocks.prepareInput.mockReturnValue(changed);
    mocks.executeRaw.mockResolvedValue(1);
    mocks.userFind.mockResolvedValue({
      conversationIntelligenceEnabled: true,
    });
    mocks.conversationFind.mockResolvedValue({
      id: conversationId,
      leadId: "lead-a",
    });
    mocks.activeJobFind.mockResolvedValue(null);
    mocks.analysisFind.mockResolvedValue({
      status: "FAILED",
      contentHash: prepared.contentHash,
      analysisVersion: "conversation-v1",
    });
    mocks.analysisUpsert.mockResolvedValue({ id: "analysis-a" });
    mocks.enqueueInTransaction.mockResolvedValue({
      kind: "queued",
      job: queuedJob,
    });
    mocks.serializeJob.mockImplementation((job) => ({
      id: job.id,
      type: "CONVERSATION_ANALYSIS",
      status: job.status,
      active: true,
    }));
    mocks.transaction.mockImplementation(async (operation) =>
      operation(transactionClient()),
    );

    await expect(
      reconcileConversationAnalysisAfterTerminalFailure(
        ownerId,
        conversationId,
        prepared.contentHash,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ kind: "queued" }),
    );
    expect(mocks.enqueueInTransaction).toHaveBeenCalledOnce();
  });
});

describe("Conversation Intelligence preference cancellation", () => {
  it("cancels pending, retry, and running work without clearing canonical output", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { id: "job-pending", previousStatus: JobStatus.PENDING },
      { id: "job-retry", previousStatus: JobStatus.RETRY_SCHEDULED },
      { id: "job-running", previousStatus: JobStatus.RUNNING },
    ]);

    await expect(
      setConversationIntelligencePreference(ownerId, false, queuedAt),
    ).resolves.toEqual({
      enabled: false,
      cancelled: 2,
      cancellationRequested: 1,
    });

    const query = mocks.queryRaw.mock.calls[0][0] as {
      strings?: readonly string[];
      values?: unknown[];
    };
    const sql = query.strings?.join("?") ?? "";
    expect(sql).toContain('"ownerId" = ?');
    expect(sql).toContain("'CONVERSATION_ANALYSIS'::\"JobType\"");
    expect(sql).toContain("'PENDING'::\"JobStatus\"");
    expect(sql).toContain("'RUNNING'::\"JobStatus\"");
    expect(sql).toContain("'RETRY_SCHEDULED'::\"JobStatus\"");
    expect(query.values).toContain(ownerId);
    expect(mocks.analysisUpdate).toHaveBeenCalledWith({
      where: {
        ownerId,
        latestJobId: {
          in: ["job-pending", "job-retry", "job-running"],
        },
      },
      data: {
        status: "CANCELLED",
        lastErrorCode: "AI_PREFERENCE_DISABLED",
        lastErrorMessage: "Conversation Intelligence was disabled.",
      },
    });
    const update = mocks.analysisUpdate.mock.calls[0][0].data;
    expect(update).not.toHaveProperty("summary");
    expect(update).not.toHaveProperty("structuredData");
    expect(update).not.toHaveProperty("contentHash");
    expect(update).not.toHaveProperty("completedAt");
  });

  it("owner-scopes the latest successful analysis lookup", async () => {
    const completedAt = new Date("2026-07-27T19:30:00.000Z");
    mocks.latestAnalysisFind.mockResolvedValueOnce({ completedAt });

    await expect(
      latestSuccessfulConversationAnalysisAt(ownerId),
    ).resolves.toEqual(completedAt);
    expect(mocks.latestAnalysisFind).toHaveBeenCalledWith({
      where: { ownerId, completedAt: { not: null } },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      select: { completedAt: true },
    });
  });
});
