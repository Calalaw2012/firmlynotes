export default function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const height = size === "lg" ? "h-14 md:h-16" : "h-[54px]";
  return (
    <>
      <img
        src="/logo-light.png"
        alt="Firmly Notes"
        className={`${height} w-auto dark:hidden`}
      />
      <img
        src="/logo-dark.png"
        alt="Firmly Notes"
        className={`hidden ${height} w-auto dark:inline`}
      />
    </>
  );
}
