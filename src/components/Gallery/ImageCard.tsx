import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

type ImageCardProps = {
  src: string;
  alt: string;
  className?: string;
  widthHint?: number;
  eager?: boolean;
};

function canOptimize(src: string): boolean {
  const value = (src || "").trim().toLowerCase();
  if (!value) return false;
  return !value.startsWith("data:") && !value.startsWith("blob:");
}

function withTransform(src: string, format: "webp" | "auto", widthHint: number): string {
  if (!canOptimize(src)) return src;
  try {
    const base = window.location.origin || "http://localhost";
    const url = new URL(src, base);
    url.searchParams.set("format", format);
    if (widthHint > 0) url.searchParams.set("w", String(widthHint));
    url.searchParams.set("fit", "cover");
    return url.toString();
  } catch {
    return src;
  }
}

export default function ImageCard({
  src,
  alt,
  className,
  widthHint = 960,
  eager = false,
}: ImageCardProps) {
  const [broken, setBroken] = useState(false);

  const original = (src || "").trim();
  const canUsePicture = canOptimize(original);
  const webpSrc = useMemo(() => withTransform(original, "webp", widthHint), [original, widthHint]);
  const optimizedSrc = useMemo(() => withTransform(original, "auto", widthHint), [original, widthHint]);
  const finalSrc = broken ? original : optimizedSrc;

  if (!canUsePicture) {
    return (
      <img
        src={original}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={cn("w-full object-cover", className)}
      />
    );
  }

  return (
    <picture>
      <source srcSet={webpSrc} type="image/webp" />
      <img
        src={finalSrc}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
        className={cn("w-full object-cover", className)}
        onError={() => setBroken(true)}
      />
    </picture>
  );
}
