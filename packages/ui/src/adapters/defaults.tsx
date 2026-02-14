import type React from "react";

import type { FrameworkAdapter, ImageProps, LinkProps } from "./types";

export const DefaultLink: React.FC<LinkProps> = ({
  href,
  children,
  className,
  ...props
}) => (
  <a href={href} className={className} {...props}>
    {children}
  </a>
);

export const DefaultImage: React.FC<ImageProps> = ({
  src,
  alt,
  width,
  height,
  className,
  ...props
}) => (
  <img
    src={src}
    alt={alt}
    width={width}
    height={height}
    className={className}
    {...props}
  />
);

export const defaultAdapters: FrameworkAdapter = {
  Link: DefaultLink,
  Image: DefaultImage,
};
