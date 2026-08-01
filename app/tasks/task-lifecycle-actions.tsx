import {
  cancelTaskAction,
  completeTaskAction,
  deleteTaskAction,
  reopenTaskAction,
} from "@/app/actions/task-actions";
import { TaskActionButton } from "./task-action-button";

export function TaskLifecycleActions({
  taskId,
  status,
  deleteReturnTo,
  className = "flex flex-wrap justify-end gap-2",
}: {
  taskId: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  deleteReturnTo?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {status === "OPEN" ? (
        <TaskAction action={completeTaskAction} id={taskId} pendingLabel="Completing…">
          Complete
        </TaskAction>
      ) : (
        <TaskAction action={reopenTaskAction} id={taskId} pendingLabel="Reopening…">
          Reopen
        </TaskAction>
      )}
      {status === "OPEN" ? (
        <TaskAction action={cancelTaskAction} id={taskId} pendingLabel="Cancelling…">
          Cancel
        </TaskAction>
      ) : null}
      <TaskAction
        action={deleteTaskAction}
        id={taskId}
        pendingLabel="Deleting…"
        returnTo={deleteReturnTo}
      >
        Delete
      </TaskAction>
    </div>
  );
}

function TaskAction({
  action,
  id,
  pendingLabel,
  returnTo,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  pendingLabel: string;
  returnTo?: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="taskId" value={id} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <TaskActionButton label={String(children)} pendingLabel={pendingLabel} />
    </form>
  );
}
