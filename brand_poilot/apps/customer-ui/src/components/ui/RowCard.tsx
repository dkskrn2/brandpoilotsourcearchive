interface RowCardProps {
  title: string;
  badge: React.ReactNode;
  meta: string;
  selected?: boolean;
}

export function RowCard({ title, badge, meta, selected = false }: RowCardProps) {
  return (
    <article className={selected ? "row-card selected" : "row-card"}>
      <div className="row-top">
        <p className="row-title">{title}</p>
        {badge}
      </div>
      <div className="row-meta">{meta}</div>
    </article>
  );
}
