import { Mail } from "lucide-react";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Mail size={17} aria-hidden />
      </span>
      <span>卖家邮局</span>
    </div>
  );
}
