import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13.2 13.2 3.8 3.8" />
  </Base>
);

export const AccountIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="10" cy="7" r="3.25" />
    <path d="M3.5 17c.8-3.2 3.4-4.75 6.5-4.75S15.700 13.8 16.5 17" />
  </Base>
);

export const BagIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 6.5h12l-.8 10.5H4.8L4 6.500Z" />
    <path d="M7.250 6.500V5.500a2.750 2.750 0 0 1 5.500 0v1" />
  </Base>
);

export const HeartIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M10 16.500S3.500 12.600 3.500 8a3.300 3.300 0 0 1 6.500-1 3.300 3.300 0 0 1 6.500 1c0 4.600-6.500 8.500-6.500 8.500Z" />
  </Base>
);

export const ArrowIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3.500 10h13M12 5.500l4.500 4.500-4.500 4.500" />
  </Base>
);

export const MinusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 10h10" />
  </Base>
);

export const PlusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 10h10M10 5v10" />
  </Base>
);
