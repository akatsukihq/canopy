import type { ReportModel } from "./types";
import styles from "./AssistantOutput.module.css";
import { safeLink } from "@/lib/content/links";
import { CodeBlock } from "@/components/ui/index.tsx";
import { SyntaxHighlight } from "@/components/content/SyntaxHighlight";

export function ReportView({ report }: { report: ReportModel }) {
  return (
    <div className={styles.report}>
      {report.summary && <p>{report.summary}</p>}
      {report.sections.map((section, index) =>
        section.code ? (
          <details key={index}>
            <summary className="cursor-pointer text-caption text-muted-foreground">{section.heading}</summary>
            <CodeBlock data-language={section.code.language}>
              <SyntaxHighlight language={section.code.language} code={section.code.value} />
            </CodeBlock>
          </details>
        ) : (
          <section key={index}>
            <h4>
              {section.heading}
              {section.findings?.length
                ? ` · ${section.findings.length} ${section.findings.length === 1 ? "finding" : "findings"}`
                : ""}
            </h4>
            {section.text && <p>{section.text}</p>}
            {!!section.items?.length && (
              <ul>
                {section.items.map((item, n) => (
                  <li key={n}>{item}</li>
                ))}
              </ul>
            )}
            {section.entries?.map((entry, n) => (
              <p key={n}>
                <strong>{entry.title}</strong>
                {entry.label ? ` · ${entry.label}` : ""}
                {entry.text && (
                  <>
                    <br />
                    {entry.text}
                  </>
                )}
              </p>
            ))}
            {section.findings?.map((finding, n) => (
              <div key={n} className={styles.finding}>
                <p
                  className={
                    finding.severity === "high"
                      ? styles.highPriority
                      : finding.severity === "medium"
                        ? styles.mediumPriority
                        : styles.lowPriority
                  }
                >
                  {finding.severity[0].toUpperCase() + finding.severity.slice(1)} · {finding.issue}
                </p>
                <blockquote>{finding.passage}</blockquote>
                <p>{finding.recommendation}</p>
              </div>
            ))}
            {section.links?.map((item, n) => {
              let href: string;
              try {
                href = safeLink(item.url);
              } catch {
                return <p key={n}>{item.title || item.url}</p>;
              }
              return (
                <a
                  key={n}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-words text-primary underline"
                >
                  {item.title || item.url}
                </a>
              );
            })}
          </section>
        ),
      )}
    </div>
  );
}
