interface CardProps {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  as?: "section" | "article" | "aside";
}

export function Card({ title, badge, children, as: Element = "section" }: CardProps) {
  return (
    <Element className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {badge}
      </div>
      <div className="panel-body">{children}</div>
    </Element>
  );
}
