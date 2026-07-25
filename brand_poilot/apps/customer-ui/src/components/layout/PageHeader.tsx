import { CircleHelp } from "lucide-react";
import { useHelp } from "../help/HelpContext";

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: React.ReactNode;
}

export function PageGuideButton() {
  const help = useHelp();
  if (!help?.currentGuide) return null;
  return <button className="button page-help-button" type="button" onClick={help.startTour}><CircleHelp size={16} /> 화면 안내</button>;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  const help = useHelp();
  return (
    <div className="page-head" data-guide="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions || help?.currentGuide ? <div className="actions">
        {actions}
        {help?.currentGuide ? <PageGuideButton /> : null}
      </div> : null}
    </div>
  );
}
