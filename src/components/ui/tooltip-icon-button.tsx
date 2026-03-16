import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Button, type buttonVariants } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type TooltipIconButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    tooltip: string;
    asChild?: boolean;
    tooltipSide?: "top" | "right" | "bottom" | "left";
  };

function TooltipIconButton({
  tooltip,
  tooltipSide = "top",
  children,
  ...buttonProps
}: TooltipIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { TooltipIconButton };
