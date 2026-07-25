import { SquareCheckBig } from "lucide-react";
import { demoTasks } from "../demo-fixtures";
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
          {demoTasks.map((task) => (
            <TaskRow key={task.title} {...task} />
          ))}
        </ul>
      </div>
    </SectionPage>
  );
}
