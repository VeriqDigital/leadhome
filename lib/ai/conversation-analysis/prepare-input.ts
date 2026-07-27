import "server-only";

import { createHash } from "node:crypto";
import type { MessageDirection } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ConversationAnalysisSource = {
  subject: string | null;
  leadId: string | null;
  messages: Array<{
    direction: MessageDirection;
    sender: string;
    recipients: unknown;
    bodyText: string | null;
    bodyHtml: string | null;
    receivedAt: Date;
  }>;
};

export type PreparedConversationInput = {
  text: string;
  contentHash: string;
  inputTruncated: boolean;
  sourceMessageCount: number;
  includedMessageCount: number;
  hasMeaningfulContent: boolean;
};

const normalizeSpace = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(code, 16), 0x10ffff)));
}

export function htmlToAnalysisText(html: string) {
  return normalizeSpace(decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|head|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ));
}

export function normalizeAnalysisBody(
  bodyText: string | null,
  bodyHtml: string | null,
) {
  const source = bodyText?.trim() || (bodyHtml ? htmlToAnalysisText(bodyHtml) : "");
  return normalizeSpace(
    source
      .split("\n")
      // Quoted lines are already represented by earlier stored messages. This
      // conservative rule avoids broad "On ... wrote" heuristics.
      .filter((line) => !/^\s*>/.test(line))
      .join("\n"),
  );
}

function identity(value: string) {
  const normalized = normalizeSpace(value).slice(0, 320);
  const bracketed = normalized.match(/^(.*?)\s*<([^<>]+)>$/);
  return bracketed
    ? {
        displayName: bracketed[1].replace(/^["']|["']$/g, "").trim() || null,
        email: bracketed[2].trim().toLowerCase(),
      }
    : {
        displayName: normalized.includes("@") ? null : normalized || null,
        email: normalized.includes("@") ? normalized.toLowerCase() : null,
      };
}

function recipientValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function participantLine(source: ConversationAnalysisSource) {
  const seen = new Set<string>();
  const participants = source.messages
    .flatMap((message) => [
      message.sender,
      ...recipientValues(message.recipients),
    ])
    .map(identity)
    .filter((participant) => {
      const key = `${participant.displayName ?? ""}|${participant.email ?? ""}`;
      if (!key.replace("|", "") || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50)
    .map((participant) =>
      participant.displayName && participant.email
        ? `${participant.displayName} <${participant.email}>`
        : participant.email ?? participant.displayName ?? "")
    .filter(Boolean);
  return participants.join(", ").slice(0, 1_200) || "Not available";
}

type MeaningfulMessage = {
  direction: MessageDirection;
  sender: string;
  recipients: string[];
  receivedAt: Date;
  body: string;
};

function renderMessage(
  message: MeaningfulMessage,
  ordinal: number,
  maximumBodyChars = Number.POSITIVE_INFINITY,
) {
  const body = message.body.slice(0, maximumBodyChars);
  return [
    `M${ordinal}`,
    `Direction: ${message.direction}`,
    `Timestamp: ${message.receivedAt.toISOString()}`,
    `From: ${message.sender.slice(0, 320)}`,
    `To: ${message.recipients.join(", ").slice(0, 1_000) || "Not available"}`,
    "Body:",
    body,
  ].join("\n");
}

export function prepareConversationInput({
  source,
  analysisVersion,
  maxInputChars,
}: {
  source: ConversationAnalysisSource;
  analysisVersion: string;
  maxInputChars: number;
}): PreparedConversationInput {
  const boundedMaximum = Math.max(4_000, Math.min(maxInputChars, 200_000));
  const ordered = [...source.messages].sort(
    (left, right) => left.receivedAt.getTime() - right.receivedAt.getTime(),
  );
  const meaningful: MeaningfulMessage[] = ordered.flatMap((message) => {
    const body = normalizeAnalysisBody(message.bodyText, message.bodyHtml);
    return body
      ? [{
          direction: message.direction,
          sender: normalizeSpace(message.sender),
          recipients: recipientValues(message.recipients).map(normalizeSpace),
          receivedAt: message.receivedAt,
          body,
        }]
      : [];
  });
  const header = [
    `Analysis input version: ${analysisVersion}`,
    `Subject: ${normalizeSpace(source.subject ?? "").slice(0, 800) || "No subject"}`,
    `Participants: ${participantLine(source)}`,
  ].join("\n");
  const fullMessages = meaningful.map((message, index) =>
    renderMessage(message, index + 1));
  const fullText = [header, ...fullMessages].join("\n\n");

  let text = fullText;
  let includedMessageCount = meaningful.length;
  const inputTruncated = fullText.length > boundedMaximum;
  if (inputTruncated && meaningful.length) {
    const available = Math.max(0, boundedMaximum - header.length - 4);
    if (meaningful.length === 1) {
      const fixed = renderMessage(meaningful[0], 1, 0).length;
      text = `${header}\n\n${renderMessage(
        meaningful[0],
        1,
        Math.max(0, available - fixed),
      )}`;
      includedMessageCount = 1;
    } else {
      const firstFixed = renderMessage(meaningful[0], 1, 0).length;
      const lastFixed = renderMessage(
        meaningful[meaningful.length - 1],
        2,
        0,
      ).length;
      const bodyBudget = Math.max(0, available - firstFixed - lastFixed - 2);
      const firstBudget = Math.floor(bodyBudget * 0.4);
      const lastBudget = bodyBudget - firstBudget;
      text = [
        header,
        renderMessage(meaningful[0], 1, firstBudget),
        renderMessage(
          meaningful[meaningful.length - 1],
          2,
          lastBudget,
        ),
      ].join("\n\n");
      includedMessageCount = 2;
    }
    // Header fields are bounded above, so this final defensive bound cannot
    // consume the preserved newest-message allocation.
    text = text.slice(0, boundedMaximum);
  }

  const contentHash = createHash("sha256")
    // Hash the complete normalized canonical content, not only the bounded
    // provider text. A newly imported out-of-order message must invalidate the
    // analysis even when deterministic truncation omits that middle message.
    .update(`${analysisVersion}\n${fullText}`, "utf8")
    .digest("hex");
  return {
    text,
    contentHash,
    inputTruncated,
    sourceMessageCount: ordered.length,
    includedMessageCount,
    hasMeaningfulContent: meaningful.length > 0,
  };
}

export async function loadConversationAnalysisSource(
  ownerId: string,
  conversationId: string,
) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: {
      subject: true,
      leadId: true,
      messages: {
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        select: {
          direction: true,
          sender: true,
          recipients: true,
          bodyText: true,
          bodyHtml: true,
          receivedAt: true,
        },
      },
    },
  });
}
