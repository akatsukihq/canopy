import type { ReactElement } from "react";
import { resolveIcon, type ResolvedIcon } from "@/lib/tool-framework/icons";

export type ToolIconProps = {
  size?: number;
} & ({ icon: ResolvedIcon } | { toolId: string; name: string; media: unknown });

export function ToolIcon(props: ToolIconProps): ReactElement {
  const { size = 24 } = props;
  const icon = "icon" in props ? props.icon : resolveIcon(props.toolId, props.name, props.media);

  if (icon.kind === "url") {
    return (
      <img
        alt=""
        // CORS mode keeps Cloudinary icons visible under /media's COEP without weakening worker isolation.
        crossOrigin="anonymous"
        height={size}
        src={icon.url}
        width={size}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon.svg }}
      style={{ display: "inline-block", height: size, lineHeight: 0, width: size }}
    />
  );
}
