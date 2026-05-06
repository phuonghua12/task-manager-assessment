import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { supabase } from './lib/supabase';
import './App.css';

type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: 'low' | 'normal' | 'high';
  due_date: string | null;
  user_id: string;
  created_at: string;
};

const columns: { id: TaskStatus; title: string }[] = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'in_review', title: 'In Review' },
  { id: 'done', title: 'Done' },
];

function getDueDateClass(dueDate: string | null) {
  if (!dueDate) return '';

  const today = new Date();
  const due = new Date(`${dueDate}T00:00:00`);

  today.setHours(0, 0, 0, 0);

  const differenceInDays = Math.ceil(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (differenceInDays < 0) return 'due-overdue';
  if (differenceInDays <= 2) return 'due-soon';
  return 'due-later';
}

function formatDueDate(dueDate: string) {
  const date = new Date(`${dueDate}T00:00:00`);

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function TaskCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      className="task-card"
      style={style}
      {...listeners}
      {...attributes}
    >
      <p>{task.title}</p>

{task.description && <small>{task.description}</small>}

<div className="task-meta">
  <span className={`priority-badge priority-${task.priority}`}>
    {task.priority}
  </span>

  {task.due_date && (
  <span className={`due-date ${getDueDateClass(task.due_date)}`}>
    Due {formatDueDate(task.due_date)}
  </span>
)}
</div>
    </div>
  );
}

function BoardColumn({
  id,
  title,
  tasks,
}: {
  id: TaskStatus;
  title: string;
  tasks: Task[];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  return (
    <article className={`column ${isOver ? 'column-over' : ''}`} ref={setNodeRef}>
      <div className="column-header">
        <h2>{title}</h2>
        <span>{tasks.length}</span>
      </div>

      <div className="task-list">
        {tasks.length === 0 ? (
          <p className="empty-state">Drop tasks here.</p>
        ) : (
          tasks.map((task) => <TaskCard task={task} key={task.id} />)
        )}
      </div>
    </article>
  );
}

function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'low' | 'normal' | 'high'>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  async function loadTasks() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setTasks(data ?? []);
  }

  useEffect(() => {
    async function startGuestSession() {
      setLoading(true);
      setErrorMessage('');

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        setErrorMessage(sessionError.message);
        setLoading(false);
        return;
      }

      if (session?.user) {
        setUserId(session.user.id);
        await loadTasks();
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInAnonymously();

      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }

      setUserId(data.user?.id ?? null);
      await loadTasks();
      setLoading(false);
    }

    startGuestSession();
  }, []);

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (!newTaskTitle.trim() || !userId) {
    return;
  }

  setSaving(true);
  setErrorMessage('');

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim() || null,
      status: 'todo',
      priority: newTaskPriority,
      due_date: newTaskDueDate || null,
      user_id: userId,
    })
    .select()
    .single();

  if (error) {
    setErrorMessage(error.message);
    setSaving(false);
    return;
  }

  setTasks((currentTasks) => [...currentTasks, data]);
  setNewTaskTitle('');
  setNewTaskDescription('');
  setNewTaskPriority('normal');
  setNewTaskDueDate('');
  setSaving(false);
}

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over) {
      return;
    }

    const taskId = String(active.id);
    const newStatus = String(over.id) as TaskStatus;

    if (!columns.some((column) => column.id === newStatus)) {
      return;
    }

    const taskToMove = tasks.find((task) => task.id === taskId);

    if (!taskToMove || taskToMove.status === newStatus) {
      return;
    }

    setErrorMessage('');

    setTasks((currentTasks) =>
      currentTasks.map((task) =>
        task.id === taskId ? { ...task, status: newStatus } : task
      )
    );

    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId);

    if (error) {
      setErrorMessage(error.message);

      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === taskId ? { ...task, status: taskToMove.status } : task
        )
      );
    }
  }

const visibleTasks = useMemo(() => {
  return tasks.filter((task) => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description ?? '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesPriority =
      priorityFilter === 'all' || task.priority === priorityFilter;

    return matchesSearch && matchesPriority;
  });
}, [tasks, searchQuery, priorityFilter]);

  const tasksByStatus = useMemo(() => {
  return columns.reduce<Record<TaskStatus, Task[]>>(
    (groups, column) => {
      groups[column.id] = visibleTasks.filter((task) => task.status === column.id);
      return groups;
    },
    {
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    }
  );
}, [visibleTasks]);
  const boardStats = useMemo(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const completed = tasks.filter((task) => task.status === 'done').length;

  const overdue = tasks.filter((task) => {
    if (!task.due_date || task.status === 'done') return false;

    const due = new Date(`${task.due_date}T00:00:00`);
    return due < today;
  }).length;

  return {
    total: tasks.length,
    completed,
    overdue,
  };
}, [visibleTasks]);

  if (loading) {
    return (
      <main className="app-shell">
        <p className="eyebrow">Next Play Games Assessment</p>
        <h1>Loading your task board...</h1>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Next Play Games Assessment</p>
          <h1>Task Board</h1>
          <p className="subtitle">A guest workspace for planning and tracking tasks.</p>
        </div>
      </header>
      
      <section className="summary-grid">
  <div className="summary-card">
    <span>Total Tasks</span>
    <strong>{boardStats.total}</strong>
  </div>

  <div className="summary-card">
    <span>Completed</span>
    <strong>{boardStats.completed}</strong>
  </div>

  <div className="summary-card">
    <span>Overdue</span>
    <strong>{boardStats.overdue}</strong>
  </div>
</section>

<section className="filter-bar">
  <input
    value={searchQuery}
    onChange={(event) => setSearchQuery(event.target.value)}
    placeholder="Search tasks..."
  />

  <select
    value={priorityFilter}
    onChange={(event) =>
      setPriorityFilter(event.target.value as 'all' | 'low' | 'normal' | 'high')
    }
  >
    <option value="all">All priorities</option>
    <option value="low">Low priority</option>
    <option value="normal">Normal priority</option>
    <option value="high">High priority</option>
  </select>
</section>

<form className="task-form" onSubmit={createTask}>
  <div className="task-form-grid">
    <input
      value={newTaskTitle}
      onChange={(event) => setNewTaskTitle(event.target.value)}
      placeholder="Add a task, e.g. Design task card states"
    />

    <input
      value={newTaskDescription}
      onChange={(event) => setNewTaskDescription(event.target.value)}
      placeholder="Optional description"
    />

    <select
      value={newTaskPriority}
      onChange={(event) =>
        setNewTaskPriority(event.target.value as 'low' | 'normal' | 'high')
      }
    >
      <option value="low">Low priority</option>
      <option value="normal">Normal priority</option>
      <option value="high">High priority</option>
    </select>

    <input
      type="date"
      value={newTaskDueDate}
      onChange={(event) => setNewTaskDueDate(event.target.value)}
    />
  </div>

  <button type="submit" disabled={saving}>
    {saving ? 'Adding...' : 'Add Task'}
  </button>
</form>

      {errorMessage && <p className="error-message">{errorMessage}</p>}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <section className="board">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              id={column.id}
              title={column.title}
              tasks={tasksByStatus[column.id]}
            />
          ))}
        </section>
      </DndContext>
    </main>
  );
}

export default App;