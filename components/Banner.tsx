import type { ReactNode } from "react";

type Variant = "success" | "danger" | "info";

const styles: Record<Variant, string> = {
  success: "bg-success/10 border-success/40 text-success",
  danger: "bg-danger-bg border-danger-border text-danger",
  info: "bg-indigo-bg/60 border-indigo-border/50 text-indigo-text",
};

export default function Banner({
  variant,
  children,
}: {
  variant: Variant;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${styles[variant]}`}>
      {children}
    </div>
  );
}
