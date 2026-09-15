export default function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const text = size === "lg" ? "text-4xl md:text-5xl" : "text-2xl";
  return (
    <div className={`${text} font-light leading-[1.05] tracking-tight select-none`}>
      <div className="text-ink">firmly</div>
      <div className="text-sage">notes</div>
    </div>
  );
}
