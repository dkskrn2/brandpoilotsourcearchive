interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </section>
  );
}
