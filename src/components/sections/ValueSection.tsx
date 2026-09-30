import { SectionHeading } from "@/components/ui/SectionHeading";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/types";
import { cx } from "@/lib/cx";
import styles from "./ValueSection.module.css";

interface ValueItem {
  icon: IconName;
  title: string;
  description: string;
}

const VALUES: ValueItem[] = [
  {
    icon: "production",
    title: "Production-ready resources",
    description:
      "Resources are built for real projects — structured, documented, and ready to integrate instead of throwaway snippets.",
  },
  {
    icon: "reuse",
    title: "Reusable systems",
    description:
      "Modular code and assets designed to drop into your place and adapt to your project, not fight against it.",
  },
  {
    icon: "quality",
    title: "Quality assets",
    description:
      "Clean hierarchies, sensible naming, and optimized budgets so everything you buy stays easy to work with.",
  },
  {
    icon: "docs",
    title: "Documentation and faster development",
    description:
      "Every resource ships with clear docs and examples, so you spend less time deciphering and more time building.",
  },
];

/** Homepage value proposition section for developers. */
export function ValueSection() {
  return (
    <section
      className={cx("section", styles.section)}
      aria-labelledby="value-heading"
    >
      <div className="container">
        <SectionHeading
          id="value-heading"
          eyebrow="Why devKitCat"
          title="Built for developers who ship"
          description="Resources that respect your time, your codebase, and your players."
        />
        <ul className={styles.grid}>
          {VALUES.map((value) => (
            <li key={value.title} className={styles.card}>
              <span className={styles.iconWrap}>
                <Icon name={value.icon} size={22} />
              </span>
              <h3 className={styles.cardTitle}>{value.title}</h3>
              <p className={styles.cardDescription}>{value.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
