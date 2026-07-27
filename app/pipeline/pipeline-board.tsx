"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { GripVertical, MessageSquareText } from "lucide-react";
import type { LeadStatus } from "@prisma/client";
import { movePipelineLeadAction } from "@/app/actions/pipeline-actions";
import { formatCurrency, sourceLabels, statusLabels, statusValues } from "@/lib/lead-format";
import type {
  PipelineCardDto,
} from "@/lib/pipeline/pipeline-query";
import {
  optimisticMoveColumns,
  rollbackOptimisticMove,
  type OptimisticBoardColumn,
} from "@/lib/pipeline/optimistic";

type BoardColumn = OptimisticBoardColumn;

const terminal = new Set<LeadStatus>(["WON", "LOST"]);

export function PipelineBoard({
  initialColumns,
}: {
  initialColumns: BoardColumn[];
}) {
  const [columns, setColumns] = useState(initialColumns);
  const columnsRef = useRef(columns);
  const [mobileStage, setMobileStage] = useState<LeadStatus>("NEW");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [dropStage, setDropStage] = useState<LeadStatus | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const pointerLead = useRef<string | null>(null);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  function move(leadId: string, destination: LeadStatus) {
    if (pendingIdsRef.current.has(leadId)) return;
    const previous = columnsRef.current;
    const source = previous.find((column) =>
      column.cards.some((card) => card.id === leadId),
    );
    const card = source?.cards.find((item) => item.id === leadId);
    if (!source || !card || source.status === destination) return;

    setError("");
    pendingIdsRef.current.add(leadId);
    setPendingIds((current) => new Set(current).add(leadId));
    const optimistic = optimisticMoveColumns(previous, leadId, destination);
    columnsRef.current = optimistic;
    setColumns(optimistic);

    startTransition(async () => {
      const rollback = () => {
        setColumns((current) => {
          const restored = rollbackOptimisticMove(
            current,
            previous,
            leadId,
            destination,
          );
          columnsRef.current = restored;
          return restored;
        });
      };
      try {
        const result = await movePipelineLeadAction({
          leadId,
          status: destination,
        });
        if (!result.success) {
          rollback();
          setError(result.message);
          return;
        }
        setColumns((current) => {
          const canonical = current.map((column) => ({
            ...column,
            cards: column.cards.map((item) =>
              item.id === leadId
                ? {
                    ...item,
                    status: result.lead.status,
                    updatedAt: new Date(result.lead.updatedAt),
                  }
                : item,
            ),
          }));
          columnsRef.current = canonical;
          return canonical;
        });
      } catch {
        rollback();
        setError("The stage change could not be saved.");
      } finally {
        pendingIdsRef.current.delete(leadId);
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(leadId);
          return next;
        });
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[data-lead-card="${leadId}"]`)
            ?.focus();
        });
      }
    });
  }

  function stageAtPoint(x: number, y: number) {
    return document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-stage]")
      ?.dataset.stage as LeadStatus | undefined;
  }

  return (
    <>
      <p aria-live="assertive" className="mb-3 min-h-5 text-sm text-red-600">
        {error}
      </p>
      <label className="mb-4 grid gap-1.5 text-sm font-semibold md:hidden">
        Pipeline stage
        <select
          value={mobileStage}
          onChange={(event) => setMobileStage(event.target.value as LeadStatus)}
          className="h-11 rounded-xl border border-black/10 bg-transparent px-3"
        >
          {statusValues.map((status) => (
            <option key={status} value={status}>{statusLabels[status]}</option>
          ))}
        </select>
      </label>
      <div className="pipeline-board flex gap-4 overflow-x-auto pb-4 md:snap-x">
        {columns.map((column) => (
          <section
            key={column.status}
            data-stage={column.status}
            onDragOver={(event) => {
              event.preventDefault();
              setDropStage(column.status);
            }}
            onDragLeave={() => setDropStage(null)}
            onDrop={(event) => {
              event.preventDefault();
              const leadId = event.dataTransfer.getData("text/lead-id");
              setDropStage(null);
              if (leadId) move(leadId, column.status);
            }}
            className={`${mobileStage === column.status ? "flex" : "hidden"} min-h-96 w-full shrink-0 snap-start flex-col rounded-2xl border p-3 md:flex md:w-76 ${
              terminal.has(column.status)
                ? "border-black/10 bg-black/[0.025] dark:bg-white/[0.025]"
                : "border-black/[0.07] bg-white dark:bg-[#1a1b20]"
            } ${dropStage === column.status ? "ring-2 ring-[#7770c8]" : ""}`}
          >
            <header className="mb-3 border-b border-black/[0.07] px-1 pb-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{statusLabels[column.status]}</h2>
                <span className="rounded-full bg-black/[0.06] px-2 py-1 text-xs font-semibold dark:bg-white/[0.08]">
                  {column.count}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#687080]">
                {formatCurrency(column.value)}
              </p>
            </header>
            <div className="grid gap-3">
              {column.cards.map((card) => (
                <PipelineCard
                  key={card.id}
                  card={card}
                  pending={pendingIds.has(card.id)}
                  move={move}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/lead-id", card.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onPointerDown={(event) => {
                    pointerLead.current = card.id;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!pointerLead.current) return;
                    setDropStage(stageAtPoint(event.clientX, event.clientY) ?? null);
                  }}
                  onPointerUp={(event) => {
                    const destination = stageAtPoint(event.clientX, event.clientY);
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    const leadId = pointerLead.current;
                    pointerLead.current = null;
                    setDropStage(null);
                    if (leadId && destination) move(leadId, destination);
                  }}
                  onPointerCancel={() => {
                    pointerLead.current = null;
                    setDropStage(null);
                  }}
                />
              ))}
              {!column.cards.length && (
                <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-black/10 px-4 text-center text-xs text-[#687080]">
                  No leads in {statusLabels[column.status]}.
                </div>
              )}
            </div>
            {column.hasMore && (
              <Link
                href={column.loadMoreHref}
                className="mt-3 rounded-xl border border-black/10 px-3 py-2.5 text-center text-xs font-semibold"
              >
                Load more
              </Link>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function PipelineCard({
  card,
  pending,
  move,
  onDragStart,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  card: PipelineCardDto;
  pending: boolean;
  move: (leadId: string, status: LeadStatus) => void;
  onDragStart: React.DragEventHandler<HTMLButtonElement>;
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerMove: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
}) {
  const followUp = card.nextFollowUpDate
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(card.nextFollowUpDate),
      )
    : "No follow-up";
  const activity = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(card.latestActivityAt ?? card.updatedAt));
  const isFollowUpOverdue =
    card.nextFollowUpDate &&
    new Date(card.nextFollowUpDate) < new Date();
  const nextTask = card.nextOpenTaskAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(card.nextOpenTaskAt),
      )
    : null;
  return (
    <article
      data-lead-card={card.id}
      tabIndex={-1}
      aria-busy={pending}
      className={`relative rounded-xl border border-black/[0.08] bg-white p-3 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[#7770c8] dark:bg-[#222328] ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        <Link href={`/leads/${card.id}`} className="min-w-0 flex-1 focus-visible:rounded">
          <h3 className="truncate text-sm font-semibold hover:underline">{card.name}</h3>
          <p className="mt-1 truncate text-xs text-[#687080]">
            {card.company ?? card.email ?? "No company or email"}
          </p>
        </Link>
        <button
          type="button"
          draggable={!pending}
          disabled={pending}
          aria-label={`Move ${card.name}`}
          title="Drag or touch-drag to another stage"
          onDragStart={onDragStart}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={{ touchAction: "none" }}
          className="grid size-9 shrink-0 cursor-grab place-items-center rounded-lg border border-black/10 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <span className="font-semibold">{formatCurrency(card.estimatedValue ?? 0)}</span>
        <span className={isFollowUpOverdue ? "font-semibold text-red-600" : "text-[#687080]"}>
          {isFollowUpOverdue ? `Overdue · ${followUp}` : followUp}
        </span>
        <span className="col-span-2 text-[#687080]">Latest activity {activity}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[#687080]">
        <span>{card.openTaskCount} open tasks</span>
        {card.overdueTaskCount > 0 && (
          <span className="font-semibold text-red-600">
            {card.overdueTaskCount} overdue
          </span>
        )}
        {card.dueTodayTaskCount > 0 && (
          <span>{card.dueTodayTaskCount} due today</span>
        )}
        {nextTask && <span>Next task {nextTask}</span>}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-[#687080]">
        <span>{sourceLabels[card.source]}</span>
        {card.hasConversation && (
          <span title="Attached conversation" aria-label="Attached conversation">
            <MessageSquareText className="size-3.5" />
          </span>
        )}
      </div>
      {card.status === "FOLLOW_UP" && !card.hasOpenFollowUpTask && (
        <div className="mt-3 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <p>No follow-up is scheduled.</p>
          <Link
            href={`/tasks/new?lead=${card.id}&type=FOLLOW_UP&title=${encodeURIComponent(`Follow up with ${card.name}`)}`}
            className="mt-1 inline-block font-semibold underline"
          >
            Create follow-up task
          </Link>
        </div>
      )}
      <label className="mt-3 block">
        <span className="sr-only">Move {card.name} to stage</span>
        <select
          value={card.status}
          disabled={pending}
          onChange={(event) => move(card.id, event.target.value as LeadStatus)}
          className="h-10 w-full cursor-pointer rounded-lg border border-black/10 bg-transparent px-2 text-xs"
        >
          {statusValues.map((status) => (
            <option key={status} value={status}>{statusLabels[status]}</option>
          ))}
        </select>
      </label>
      {pending && (
        <p className="mt-2 text-center text-xs font-semibold" aria-live="polite">
          Moving…
        </p>
      )}
    </article>
  );
}
