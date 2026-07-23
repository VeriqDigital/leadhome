import { SquareCheckBig } from "lucide-react";
import { tasks } from "../data";
import { TaskRow } from "../components";
import { SectionPage } from "../section-page";

export default function TasksPage() {
  return (
    <SectionPage
      title="Tasks"
      description="Keep the next action for every lead in view."
      icon={SquareCheckBig}
    >
      <div className="max-w-3xl">
        <ul>
          {tasks.map((task) => (
            <TaskRow key={task.title} {...task} />
          ))}
        </ul>
      </div>
    </SectionPage>
  );
}
