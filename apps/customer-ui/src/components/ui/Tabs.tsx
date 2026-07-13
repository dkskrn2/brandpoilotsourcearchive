import { useId, useState } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultId: string;
  activeId?: string;
  onChange?: (id: string) => void;
}

export function Tabs({ items, defaultId, activeId: controlledActiveId, onChange }: TabsProps) {
  const [internalActiveId, setInternalActiveId] = useState(defaultId);
  const activeId = controlledActiveId ?? internalActiveId;
  const baseId = useId();

  function selectTab(nextId: string) {
    if (onChange) {
      onChange(nextId);
      return;
    }
    setInternalActiveId(nextId);
  }

  function move(currentId: string, direction: 1 | -1) {
    const index = items.findIndex((item) => item.id === currentId);
    const next = items[(index + direction + items.length) % items.length];
    selectTab(next.id);
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
    });
  }

  return (
    <div data-tabs>
      <div className="tabs" role="tablist">
        {items.map((item) => (
          <button
            key={item.id}
            id={`${baseId}-tab-${item.id}`}
            className="tab"
            type="button"
            role="tab"
            aria-selected={activeId === item.id}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={activeId === item.id ? 0 : -1}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(item.id, 1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(item.id, -1);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <section
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={activeId !== item.id}
        >
          {item.content}
        </section>
      ))}
    </div>
  );
}
