export interface RecentEntry {
  title: string;
  when: string;
  link: string;
  meetLink: string | null;
  attendeeCount: number;
}

export default function RecentList({ items }: { items: RecentEntry[] }) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3 rounded-[10px] border border-border bg-bg-elevated p-5">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">
        Sent this session
      </h2>
      <ul className="divide-y divide-border-faint">
        {items.map((item, i) => (
          <li key={i} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{item.title}</p>
              <p className="text-xs text-ink-faint">
                {item.when}
                {item.attendeeCount > 0 &&
                  ` · ${item.attendeeCount} attendee${item.attendeeCount > 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs">
              {item.meetLink && (
                <a
                  href={item.meetLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-text hover:text-ink underline underline-offset-4"
                >
                  Join Meet
                </a>
              )}
              <a
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="text-sage hover:text-sage-dim underline underline-offset-4"
              >
                View
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
