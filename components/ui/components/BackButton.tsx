import type { MouseEventHandler } from "react";
import Link from "next/link.js";
import { Button } from "./button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.tsx";
import { cn } from "../lib/utils.ts";

type BackButtonProps = { label: string; className?: string } & (
  | { href: string; onClick?: MouseEventHandler<HTMLAnchorElement>; disabled?: never }
  | { href?: never; onClick: MouseEventHandler<HTMLButtonElement>; disabled?: boolean }
);

export function BackButton(props: BackButtonProps) {
  const { label, className } = props;
  const buttonClassName = cn(
    "group/back self-start bg-transparent text-foreground hover:bg-transparent hover:text-primary focus-visible:text-primary active:bg-transparent active:text-primary",
    className,
  );
  const arrow = (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      className="size-5 w-7 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover/back:-translate-x-0.5 motion-safe:group-focus-visible/back:-translate-x-0.5 motion-reduce:transition-none rtl:rotate-180"
    >
      <path d="m12 19-7-7 7-7M5 12h24" />
    </svg>
  );
  const control =
    props.href !== undefined ? (
      <Button asChild aria-label={label} variant="input-icon" size="icon" className={buttonClassName}>
        <Link href={props.href} onClick={props.onClick}>
          {arrow}
        </Link>
      </Button>
    ) : (
      <Button
        type="button"
        aria-label={label}
        variant="input-icon"
        size="icon"
        disabled={props.disabled}
        onClick={props.onClick}
        className={buttonClassName}
      >
        {arrow}
      </Button>
    );
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
