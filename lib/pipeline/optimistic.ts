import type { LeadStatus } from "@prisma/client";
import type {
  PipelineCardDto,
  PipelineColumnDto,
} from "./pipeline-query";

export type OptimisticBoardColumn = PipelineColumnDto & {
  loadMoreHref: string;
};

export function optimisticMoveColumns(
  columns: OptimisticBoardColumn[],
  leadId: string,
  destination: LeadStatus,
) {
  const source = columns.find((column) =>
    column.cards.some((card) => card.id === leadId),
  );
  const card: PipelineCardDto | undefined = source?.cards.find(
    (item) => item.id === leadId,
  );
  if (!source || !card || source.status === destination) return columns;
  return columns.map((column) => {
    if (column.status === source.status) {
      return {
        ...column,
        count: Math.max(0, column.count - 1),
        value: String(
          Math.max(0, Number(column.value) - Number(card.estimatedValue ?? 0)),
        ),
        cards: column.cards.filter((item) => item.id !== leadId),
      };
    }
    if (column.status === destination) {
      return {
        ...column,
        count: column.count + 1,
        value: String(
          Number(column.value) + Number(card.estimatedValue ?? 0),
        ),
        cards: [{ ...card, status: destination }, ...column.cards],
      };
    }
    return column;
  });
}

export function rollbackOptimisticMove(
  current: OptimisticBoardColumn[],
  previous: OptimisticBoardColumn[],
  leadId: string,
  destination: LeadStatus,
) {
  const source = previous.find((column) =>
    column.cards.some((card) => card.id === leadId),
  );
  const card = source?.cards.find((item) => item.id === leadId);
  const originalIndex = source?.cards.findIndex((item) => item.id === leadId);
  const destinationHasCard = current
    .find((column) => column.status === destination)
    ?.cards.some((item) => item.id === leadId);
  if (
    !source ||
    !card ||
    originalIndex === undefined ||
    originalIndex < 0 ||
    !destinationHasCard
  ) {
    return current;
  }
  const value = Number(card.estimatedValue ?? 0);
  return current.map((column) => {
    if (column.status === destination) {
      return {
        ...column,
        count: Math.max(0, column.count - 1),
        value: String(Math.max(0, Number(column.value) - value)),
        cards: column.cards.filter((item) => item.id !== leadId),
      };
    }
    if (column.status === source.status) {
      const cards = [...column.cards];
      cards.splice(Math.min(originalIndex, cards.length), 0, {
        ...card,
        status: source.status,
      });
      return {
        ...column,
        count: column.count + 1,
        value: String(Number(column.value) + value),
        cards,
      };
    }
    return column;
  });
}
