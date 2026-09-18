export default function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const text = size === "lg" ? "text-4xl md:text-5xl" : "text-2xl";
  return (
    <div className={`${text} font-logo leading-[1.05] tracking-tight select-none`}>
      <div className="font-light text-ink">firmly</div>
      {/* Offset to the right and bolded, the way firmlyresearch.com stacks
          its own two-line wordmark -- an em-based margin so the stagger
          scales with the text size instead of needing separate values for
          the header's small logo and the sign-in page's large one. */}
      <div className="ml-[2.6em] font-bold text-sage">notes</div>
    </div>
  );
}
